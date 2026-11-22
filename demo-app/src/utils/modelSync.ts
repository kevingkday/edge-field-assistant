import {
  DEFAULT_MODEL_CONFIG,
  buildStatelessTurnPrompt,
  extractJsonObject,
  normalizeStepResult,
  type ChecklistItemState,
  type CustomModelEntry,
  type FieldAppSchema,
  type ModelConfig,
  type StepEvaluationResult,
} from '@edge-field-assistant/core';
import type { SchemaSyncStatus } from './schemaSync';

export const DEFAULT_BUILTIN_MODEL_ID = 'default-gemma4-e2b';
export const CUSTOM_MODELS_STORAGE_KEY = 'edge_field_assistant_custom_models_v1';
export const ACTIVE_MODEL_ID_STORAGE_KEY = 'edge_field_assistant_active_model_v1';

export const BUILTIN_MODEL_ENTRY: CustomModelEntry = {
  id: DEFAULT_BUILTIN_MODEL_ID,
  name: 'Gemma 4 E2B WebGPU (Built-in)',
  url: DEFAULT_MODEL_CONFIG.downloadUrl,
  size_mb: 1650,
  description: 'Default on-device LiteRT-LM WebGPU multimodal bundle hosted on Hugging Face.',
};

export function loadActiveModelId(): string {
  try {
    return localStorage.getItem(ACTIVE_MODEL_ID_STORAGE_KEY) || DEFAULT_BUILTIN_MODEL_ID;
  } catch {
    return DEFAULT_BUILTIN_MODEL_ID;
  }
}

export function saveActiveModelId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_MODEL_ID_STORAGE_KEY, id || DEFAULT_BUILTIN_MODEL_ID);
  } catch {
    // ignore storage errors
  }
}

function readCachedModels(): CustomModelEntry[] {
  try {
    const raw = localStorage.getItem(CUSTOM_MODELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomModelEntry[]) : [];
  } catch {
    return [];
  }
}

function writeCachedModels(models: CustomModelEntry[]): void {
  try {
    localStorage.setItem(CUSTOM_MODELS_STORAGE_KEY, JSON.stringify(models));
  } catch {
    // ignore quota errors
  }
}

export function toModelConfig(model?: CustomModelEntry | null): ModelConfig {
  if (!model || model.id === DEFAULT_BUILTIN_MODEL_ID) {
    return { ...DEFAULT_MODEL_CONFIG };
  }
  let filename = `${model.id}.litertlm`;
  try {
    const pathname = new URL(model.url).pathname;
    const base = pathname.split('/').pop();
    if (base && base.trim()) {
      filename = base.trim();
    }
  } catch {
    // fallback to id-based filename
  }

  return {
    filename,
    downloadUrl: model.url,
    minValidBytes: 5 * 1024 * 1024,
    minMemoryGb: DEFAULT_MODEL_CONFIG.minMemoryGb,
  };
}

export async function loadAndSyncModels(): Promise<{
  models: CustomModelEntry[];
  syncStatus: SchemaSyncStatus;
}> {
  const byId = new Map<string, CustomModelEntry>();
  for (const cached of readCachedModels()) {
    if (cached?.id) byId.set(cached.id, cached);
  }

  let syncStatus: SchemaSyncStatus =
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline_local' : 'idle';

  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      const resp = await fetch('/api/models');
      if (resp.ok) {
        const rows = (await resp.json()) as CustomModelEntry[];
        const storageMode = resp.headers.get('X-Model-Storage');
        if (storageMode === 'd1' || storageMode === 'kv') {
          byId.clear();
          for (const row of rows) {
            if (row?.id && row?.url) {
              byId.set(row.id, row);
            }
          }
          syncStatus = 'synced';
        }
      }
    } catch {
      syncStatus = 'offline_local';
    }
  }

  const merged = Array.from(byId.values());
  writeCachedModels(merged);
  return { models: merged, syncStatus };
}

export async function persistCustomModel(
  model: CustomModelEntry,
  allModels: CustomModelEntry[],
  adminToken: string
): Promise<{ models: CustomModelEntry[]; syncStatus: SchemaSyncStatus }> {
  const withTimestamp: CustomModelEntry = {
    ...model,
    updated_at: new Date().toISOString(),
  };
  const next = [withTimestamp, ...allModels.filter((m) => m.id !== model.id)];
  writeCachedModels(next);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { models: next, syncStatus: 'offline_local' };
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (adminToken.trim()) {
      headers.Authorization = `Bearer ${adminToken.trim()}`;
    }

    const resp = await fetch('/api/models', {
      method: 'POST',
      headers,
      body: JSON.stringify(model),
    });

    if (resp.status === 401 || resp.status === 403) {
      return { models: next, syncStatus: 'auth_required' };
    }
    if (resp.ok) {
      return { models: next, syncStatus: 'synced' };
    }
    return { models: next, syncStatus: 'offline_local' };
  } catch {
    return { models: next, syncStatus: 'offline_local' };
  }
}

export async function removeCustomModel(
  modelId: string,
  allModels: CustomModelEntry[],
  adminToken: string
): Promise<{ models: CustomModelEntry[]; syncStatus: SchemaSyncStatus }> {
  const next = allModels.filter((m) => m.id !== modelId);
  writeCachedModels(next);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { models: next, syncStatus: 'offline_local' };
  }

  try {
    const headers: Record<string, string> = {};
    if (adminToken.trim()) {
      headers.Authorization = `Bearer ${adminToken.trim()}`;
    }

    const resp = await fetch(`/api/models?id=${encodeURIComponent(modelId)}`, {
      method: 'DELETE',
      headers,
    });

    if (resp.status === 401 || resp.status === 403) {
      return { models: next, syncStatus: 'auth_required' };
    }
    if (resp.ok) {
      return { models: next, syncStatus: 'synced' };
    }
    return { models: next, syncStatus: 'offline_local' };
  } catch {
    return { models: next, syncStatus: 'offline_local' };
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read image for Ollama'));
    reader.readAsDataURL(blob);
  });
}

export async function evaluateWithOllama(options: {
  baseUrl: string;
  modelName: string;
  schema: FieldAppSchema;
  checklist: ChecklistItemState[];
  transcript: string;
  imageBlob?: Blob | null;
}): Promise<StepEvaluationResult> {
  const startedAt = performance.now();
  const cleanBase = options.baseUrl.trim().replace(/\/+$/, '');
  const prompt = buildStatelessTurnPrompt(options.schema, options.checklist, options.transcript);
  const images = options.imageBlob ? [await blobToBase64(options.imageBlob)] : undefined;

  const resp = await fetch(`${cleanBase}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.modelName.trim() || 'gemma3:4b',
      prompt,
      ...(images ? { images } : {}),
      stream: false,
      format: 'json',
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Ollama error (${resp.status}): ${text || resp.statusText}`);
  }

  const data = (await resp.json()) as { response?: string };
  const parsed = extractJsonObject(data.response || '');
  const latencyMs = performance.now() - startedAt;

  return normalizeStepResult(
    parsed,
    options.checklist,
    `Ollama (${options.modelName.trim() || 'gemma3:4b'})`,
    'remote_vision',
    latencyMs
  );
}
