import { normalizeStepResult } from './checklistEngine.js';
import { DEFAULT_MODEL_CONFIG, detectDeviceCapability } from './modelManager.js';
import type {
  DeviceCapability,
  ModelConfig,
  StepEvaluationInput,
  StepEvaluationResult,
} from './types.js';

export interface FallbackRouterOptions {
  /** Base path where self-hosted @litert-lm/core WASM assets are served. Defaults to '/wasm/'. */
  wasmBaseUrl?: string;
  /** Optional model config override. */
  modelConfig?: Partial<ModelConfig>;
  /** Optional remote vision fallback endpoint (e.g. MicroNode / FastAPI / Worker). */
  remoteEndpointUrl?: string;
  /** Optional headers for remote endpoint calls (e.g. Authorization). */
  remoteHeaders?: Record<string, string>;
  /** Bypass navigator.deviceMemory threshold when WebGPU + OPFS are present. */
  forceLocalWebGpu?: boolean;
  /** Custom worker factory for bundlers (Vite, Webpack) that require explicit `new Worker(new URL(...))`. */
  createWorker?: () => Worker;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * Routes multimodal field evaluation steps between:
 *   1. Local on-device WebGPU worker (when OPFS model is cached)
 *   2. Optional remote vision HTTP endpoint (when unsupported, not yet downloaded, or local fails while online)
 */
export class FieldAssistantRouter {
  private readonly wasmBaseUrl: string;
  private modelConfig: ModelConfig;
  private remoteEndpointUrl?: string;
  private remoteHeaders: Record<string, string>;
  private forceLocalWebGpu: boolean;
  private readonly createWorker: () => Worker;

  private worker: Worker | null = null;
  private requestIdSeq = 0;
  private pending = new Map<number, PendingRequest>();

  constructor(options: FallbackRouterOptions = {}) {
    this.wasmBaseUrl = options.wasmBaseUrl || '/wasm/';
    this.modelConfig = { ...DEFAULT_MODEL_CONFIG, ...options.modelConfig };
    this.remoteEndpointUrl = options.remoteEndpointUrl;
    this.remoteHeaders = options.remoteHeaders || {};
    this.forceLocalWebGpu = Boolean(options.forceLocalWebGpu);
    this.createWorker =
      options.createWorker ||
      (() =>
        new Worker(new URL('./inferenceWorker.js', import.meta.url), {
          type: 'module',
        }));
  }

  setForceLocalWebGpu(force: boolean): void {
    this.forceLocalWebGpu = force;
  }

  setModelConfig(config: Partial<ModelConfig>): void {
    const next = { ...DEFAULT_MODEL_CONFIG, ...config };
    if (next.filename !== this.modelConfig.filename && this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.pending.clear();
    }
    this.modelConfig = next;
  }

  setRemoteEndpoint(url?: string, headers?: Record<string, string>): void {
    this.remoteEndpointUrl = url;
    if (headers) {
      this.remoteHeaders = headers;
    }
  }

  async getCapability(): Promise<DeviceCapability> {
    return detectDeviceCapability(this.modelConfig, {
      forceLocalWebGpu: this.forceLocalWebGpu,
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (ev: MessageEvent) => {
      const { requestId, ok, result, error } = ev.data || {};
      const entry = this.pending.get(requestId);
      if (!entry) return;
      this.pending.delete(requestId);
      if (ok) {
        entry.resolve(result);
      } else {
        entry.reject(new Error(error || 'WebGPU inference worker error'));
      }
    };
    worker.onerror = (ev: ErrorEvent) => {
      const err = new Error(ev.message || 'Inference worker crashed');
      for (const [, entry] of this.pending) {
        entry.reject(err);
      }
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  private postToWorker<T>(
    type: 'warmup' | 'evaluate_step',
    payload: Record<string, unknown>,
    transferables: Transferable[] = []
  ): Promise<T> {
    const worker = this.ensureWorker();
    const requestId = ++this.requestIdSeq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      worker.postMessage({ requestId, type, payload }, transferables);
    });
  }

  async warmupLocalWorker(): Promise<{ ready: boolean }> {
    return this.postToWorker<{ ready: boolean }>('warmup', {
      wasmBaseUrl: this.wasmBaseUrl,
      modelFilename: this.modelConfig.filename,
    });
  }

  async evaluateStep(input: StepEvaluationInput): Promise<StepEvaluationResult> {
    const capability = await this.getCapability();

    if (capability.state === 'opfs_cached') {
      try {
        const imageBuffer = input.imageBlob ? await input.imageBlob.arrayBuffer() : null;
        return await this.postToWorker<StepEvaluationResult>(
          'evaluate_step',
          {
            wasmBaseUrl: this.wasmBaseUrl,
            modelFilename: this.modelConfig.filename,
            schema: input.schema,
            checklist: input.checklist,
            transcript: input.transcript,
            imageBuffer,
          },
          imageBuffer ? [imageBuffer] : []
        );
      } catch (localErr) {
        if (this.remoteEndpointUrl && (typeof navigator === 'undefined' || navigator.onLine)) {
          return this.evaluateRemote(input);
        }
        throw localErr;
      }
    }

    if (this.remoteEndpointUrl) {
      return this.evaluateRemote(input);
    }

    throw new Error(
      capability.state === 'ready_to_download'
        ? 'Local model not downloaded to OPFS and no remote vision endpoint configured.'
        : 'WebGPU unavailable on this device and no remote vision endpoint configured.'
    );
  }

  private async evaluateRemote(input: StepEvaluationInput): Promise<StepEvaluationResult> {
    if (!this.remoteEndpointUrl) {
      throw new Error('Remote vision endpoint is not configured.');
    }

    const startedAt = performance.now();
    const formData = new FormData();
    formData.append('schema', JSON.stringify(input.schema));
    formData.append('checklist', JSON.stringify(input.checklist));
    formData.append('transcript', input.transcript || '');
    if (input.imageBlob) {
      formData.append('image', input.imageBlob, 'capture.jpg');
    }

    const resp = await fetch(this.remoteEndpointUrl, {
      method: 'POST',
      headers: this.remoteHeaders,
      body: formData,
    });

    if (!resp.ok) {
      throw new Error(`Remote vision endpoint returned HTTP ${resp.status}`);
    }

    const raw = (await resp.json()) as Record<string, unknown>;
    const latencyMs = performance.now() - startedAt;

    return normalizeStepResult(
      raw,
      input.checklist,
      typeof raw.engine === 'string' ? raw.engine : 'Remote Vision Endpoint',
      'remote_vision',
      latencyMs
    );
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pending.clear();
  }
}
