/**
 * Off-main-thread Web Worker running `@litert-lm/core` with a LiteRT-LM model
 * loaded from OPFS. Executes single-turn multimodal inference (downscaled
 * <=768px image + transcript + current checklist JSON) without retaining
 * historical raw images in the LLM context window.
 */
import { Backend, Engine, loadLiteRtLm, type ContentPart } from '@litert-lm/core';
import {
  buildStatelessTurnPrompt,
  extractJsonObject,
  normalizeStepResult,
} from './checklistEngine.js';
import { DEFAULT_MODEL_CONFIG } from './modelManager.js';
import type { ChecklistItemState, FieldAppSchema } from './types.js';

interface WorkerRequest {
  requestId: number;
  type: 'warmup' | 'evaluate_step';
  payload?: {
    wasmBaseUrl?: string;
    modelFilename?: string;
    maxNumTokens?: number;
    schema?: FieldAppSchema;
    checklist?: ChecklistItemState[];
    transcript?: string;
    imageBuffer?: ArrayBuffer | null;
  };
}

let wasmLoaded = false;
let enginePromise: Promise<Engine> | null = null;
let engineInstance: Engine | null = null;

async function ensureWasmLoaded(wasmBaseUrl = '/wasm/'): Promise<void> {
  if (wasmLoaded) return;

  const normalizedBase = wasmBaseUrl.endsWith('/') ? wasmBaseUrl : `${wasmBaseUrl}/`;
  const scope = self as unknown as {
    importScripts?: (...urls: string[]) => void;
    Module?: { locateFile?: (file: string) => string };
    ModuleFactory?: unknown;
  };

  // Module Web Workers forbid native importScripts(); shim it via synchronous XHR
  // + indirect eval so Emscripten's ModuleFactory attaches to globalThis, and set
  // Module.locateFile so the .wasm binary resolves from wasmBaseUrl instead of /assets/.
  const origImportScripts = scope.importScripts;
  scope.Module = {
    locateFile: (file: string) =>
      new URL(file, new URL(normalizedBase, self.location.href)).href,
  };
  scope.importScripts = (...urls: string[]) => {
    for (const rawUrl of urls) {
      const resolved = new URL(rawUrl, self.location.href).href;
      const xhr = new XMLHttpRequest();
      xhr.open('GET', resolved, false);
      xhr.send(null);
      if (xhr.status < 200 || xhr.status >= 300) {
        throw new Error(`Failed to load WASM loader script ${resolved} (HTTP ${xhr.status})`);
      }
      (0, eval)(
        `${xhr.responseText}\n;if(typeof ModuleFactory!=="undefined")globalThis.ModuleFactory=ModuleFactory;`
      );
    }
  };

  try {
    await loadLiteRtLm(normalizedBase);
    wasmLoaded = true;
  } finally {
    if (origImportScripts) {
      scope.importScripts = origImportScripts;
    }
  }
}

async function getOrCreateEngine(
  wasmBaseUrl = '/wasm/',
  modelFilename = DEFAULT_MODEL_CONFIG.filename,
  maxNumTokens = 4096
): Promise<Engine> {
  if (engineInstance) return engineInstance;
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    await ensureWasmLoaded(wasmBaseUrl);
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(modelFilename, { create: false });
    const modelFile = await fileHandle.getFile();

    try {
      engineInstance = await Engine.create({
        model: modelFile,
        backend: Backend.GPU,
        visionBackend: Backend.GPU,
        mainExecutorSettings: {
          maxNumTokens,
          maxNumImages: 1,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/vision|image|modality|signature|encoder/i.test(msg)) {
        throw new Error(
          `Loaded model "${modelFilename}" lacks GPU vision support (${msg}). Clear the OPFS cache and download gemma-4-E2B-it-gpu.litertlm.`
        );
      }
      throw err;
    }
    return engineInstance;
  })();

  try {
    return await enginePromise;
  } catch (err) {
    enginePromise = null;
    throw err;
  }
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { requestId, type, payload = {} } = event.data || {};

  if (type === 'warmup') {
    try {
      await getOrCreateEngine(
        payload.wasmBaseUrl,
        payload.modelFilename,
        payload.maxNumTokens
      );
      workerScope.postMessage({ requestId, ok: true, result: { ready: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OPFS engine init failed';
      workerScope.postMessage({ requestId, ok: false, error: message });
    }
    return;
  }

  if (type === 'evaluate_step') {
    const startedAt = performance.now();
    let conversation: Awaited<ReturnType<Engine['createConversation']>> | null = null;

    try {
      if (!payload.schema || !payload.checklist) {
        throw new Error('Missing schema or checklist in evaluate_step payload.');
      }

      const engine = await getOrCreateEngine(
        payload.wasmBaseUrl,
        payload.modelFilename,
        payload.maxNumTokens
      );

      // Single-turn fresh conversation so historical raw images never accumulate in RAM/context
      conversation = await engine.createConversation();
      const contentParts: ContentPart[] = [];
      if (payload.imageBuffer) {
        contentParts.push({ type: 'image', data: new Uint8Array(payload.imageBuffer) });
      }
      contentParts.push({
        type: 'text',
        text: buildStatelessTurnPrompt(
          payload.schema,
          payload.checklist,
          payload.transcript || ''
        ),
      });

      const responseMsg = await conversation.sendMessage({
        role: 'user',
        content: contentParts,
      });

      const rawContent = responseMsg?.content;
      const responseText = (
        typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent.map((part) => (part.type === 'text' ? part.text : '')).join('')
            : ''
      ).trim();

      const parsed = extractJsonObject(responseText);
      const latencyMs = performance.now() - startedAt;
      const result = normalizeStepResult(
        parsed,
        payload.checklist,
        'On-Device WebGPU (Gemma 4 E2B OPFS)',
        'local_webgpu',
        latencyMs
      );

      workerScope.postMessage({ requestId, ok: true, result });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'On-device WebGPU inference failed';
      const message =
        payload.imageBuffer && /vision|image|modality|unsupported/i.test(rawMessage)
          ? `Vision inference failed (${rawMessage}). Ensure the vision-capable gemma-4-E2B-it-gpu.litertlm bundle is cached in OPFS.`
          : rawMessage;
      workerScope.postMessage({ requestId, ok: false, error: message });
    } finally {
      if (conversation && typeof conversation.delete === 'function') {
        conversation.delete().catch(() => {});
      }
    }
  }
};
