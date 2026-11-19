import type {
  ChecklistItemState,
  FieldAppSchema,
  InferenceBackend,
  StepEvaluationResult,
} from './types.js';

/**
 * Initializes a fresh checklist state array from any FieldAppSchema.
 */
export function createChecklistFromSchema(schema: FieldAppSchema): ChecklistItemState[] {
  return (schema.items || []).map((item) => ({
    ...item,
    completed: false,
  }));
}

/**
 * Builds a stateless, single-turn prompt containing only the schema persona,
 * compact checklist state, and current spoken/typed note.
 * Historical raw images are never retained in context.
 */
export function buildStatelessTurnPrompt(
  schema: FieldAppSchema,
  checklist: ChecklistItemState[],
  transcript: string
): string {
  const compactChecklist = (checklist || []).map((item) => ({
    id: item.id,
    label: item.label,
    category: item.category,
    extractKeys: item.extractKeys || [],
    completed: Boolean(item.completed),
  }));

  const nextUncompleted =
    compactChecklist.find((c) => !c.completed)?.label || 'All items complete';
  const flagLabel = schema.flagLabel || 'Red Flags';

  return `You are a ${schema.persona} for the "${schema.name}" workflow.
Inspect ONLY the current image and field note against the current checklist JSON.

Current Checklist JSON:
${JSON.stringify(compactChecklist)}

Operator Field Note:
"${transcript.trim() || 'No spoken note — analyze the image only.'}"

Rules:
1. Identify detected_item and match checklist_item_id from Current Checklist JSON (or null if none matches).
2. If that checklist_item_id already has "completed": true, set "already_completed": true and set spoken_feedback to: "You already captured <item> — next up is ${nextUncompleted}."
3. Extract concrete structured key-values in extracted_data (prefer the matched item's extractKeys when applicable).
4. List any ${flagLabel.toLowerCase()}, hazards, blockers, or deficiencies in red_flags.
5. Output ONLY valid JSON matching:
{"detected_item":"string","checklist_item_id":"string|null","already_completed":false,"extracted_data":{},"red_flags":[],"spoken_feedback":"string","next_recommended_item":"string"}`;
}

/**
 * Parses a JSON object from raw LLM text output, stripping optional markdown fences.
 */
export function extractJsonObject(rawText: string): Record<string, unknown> {
  const cleaned = String(rawText || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model did not return a valid JSON object.');
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model returned JSON that is not an object.');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Normalizes a raw parsed model object into a strictly typed StepEvaluationResult.
 */
export function normalizeStepResult(
  parsed: Record<string, unknown>,
  checklist: ChecklistItemState[],
  engineLabel: string,
  backend: InferenceBackend,
  latencyMs: number
): StepEvaluationResult {
  const matchedId =
    typeof parsed.checklist_item_id === 'string' && parsed.checklist_item_id.trim()
      ? parsed.checklist_item_id.trim()
      : null;

  const matchedItem = checklist.find((c) => c.id === matchedId);
  const alreadyDone = Boolean(parsed.already_completed || matchedItem?.completed);
  const remaining = checklist.filter((c) => !c.completed && c.id !== matchedId);
  const fallbackNext = remaining[0]?.label || 'All checklist items complete — ready to export!';

  const detectedItem =
    typeof parsed.detected_item === 'string' && parsed.detected_item.trim()
      ? parsed.detected_item.trim()
      : matchedItem?.label || 'Field Observation';

  const extractedData =
    parsed.extracted_data &&
    typeof parsed.extracted_data === 'object' &&
    !Array.isArray(parsed.extracted_data)
      ? (parsed.extracted_data as Record<string, unknown>)
      : {};

  const redFlags = Array.isArray(parsed.red_flags)
    ? parsed.red_flags.map((f) => String(f)).filter(Boolean)
    : [];

  const spokenFeedback =
    typeof parsed.spoken_feedback === 'string' && parsed.spoken_feedback.trim()
      ? parsed.spoken_feedback.trim()
      : alreadyDone
        ? `You already captured ${detectedItem} — next up is ${fallbackNext}.`
        : `Captured ${detectedItem}. Next up: ${fallbackNext}.`;

  const nextRecommended =
    typeof parsed.next_recommended_item === 'string' && parsed.next_recommended_item.trim()
      ? parsed.next_recommended_item.trim()
      : fallbackNext;

  return {
    detected_item: detectedItem,
    checklist_item_id: matchedId,
    already_completed: alreadyDone,
    extracted_data: extractedData,
    red_flags: redFlags,
    spoken_feedback: spokenFeedback,
    next_recommended_item: nextRecommended,
    engine: engineLabel,
    backend,
    latencyMs: Math.max(0, Math.round(latencyMs)),
  };
}

/**
 * Pure state reducer that merges a StepEvaluationResult into the current
 * checklist, extracted key-value dictionary, and deduplicated flags list.
 */
export function mergeStepIntoChecklistState(
  prevChecklist: ChecklistItemState[],
  prevExtracted: Record<string, unknown>,
  prevFlags: string[],
  result: StepEvaluationResult,
  timestampIso = new Date().toISOString()
): {
  checklist: ChecklistItemState[];
  extractedData: Record<string, unknown>;
  flags: string[];
} {
  const checklist = prevChecklist.map((item) => {
    if (result.checklist_item_id && item.id === result.checklist_item_id) {
      return {
        ...item,
        completed: true,
        capturedAt: item.capturedAt || timestampIso,
        extractedData: {
          ...(item.extractedData || {}),
          ...(result.extracted_data || {}),
        },
      };
    }
    return item;
  });

  const extractedData = {
    ...prevExtracted,
    ...(result.extracted_data || {}),
  };

  const flags = Array.from(new Set([...prevFlags, ...(result.red_flags || [])]));

  return { checklist, extractedData, flags };
}

/**
 * Downscales a captured photo File/Blob to at most `maxEdge` pixels (default 768px)
 * on its longest edge via HTML5 Canvas so mobile RAM stays bounded and inference is fast.
 */
export async function downscaleImageToMaxEdge(
  fileOrBlob: Blob,
  maxEdge = 768
): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('Image downscaling requires a browser DOM environment.');
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(fileOrBlob);

    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxEdge || height > maxEdge) {
          if (width >= height) {
            height = Math.round((height * maxEdge) / width);
            width = maxEdge;
          } else {
            width = Math.round((width * maxEdge) / height);
            height = maxEdge;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objUrl);
          reject(new Error('Failed to acquire 2D canvas context.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objUrl);
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas image downscaling failed.'));
            }
          },
          'image/jpeg',
          0.82
        );
      } catch (err) {
        URL.revokeObjectURL(objUrl);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error('Failed to decode captured image.'));
    };

    img.src = objUrl;
  });
}
