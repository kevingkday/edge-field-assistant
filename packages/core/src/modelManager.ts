import type {
  DeviceCapability,
  ModelConfig,
  ModelDownloadProgress,
} from './types.js';

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  filename: 'gemma-4-E2B-it-gpu.litertlm',
  downloadUrl:
    'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-gpu.litertlm',
  minValidBytes: 50 * 1024 * 1024,
  minMemoryGb: 4,
};

export interface HardwareSupportResult {
  supported: boolean;
  reason: string;
  hasWebGpu: boolean;
  hasOpfs: boolean;
  deviceMemoryGb: number | null;
}

/**
 * Checks whether the current browser exposes WebGPU, OPFS, and sufficient device RAM.
 */
export async function checkWebGpuAndOpfsSupport(
  minMemoryGb = DEFAULT_MODEL_CONFIG.minMemoryGb,
  forceLocalWebGpu = false
): Promise<HardwareSupportResult> {
  const hasOpfs =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.storage && typeof navigator.storage.getDirectory === 'function');

  const navWithGpu =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & {
          gpu?: { requestAdapter: () => Promise<unknown | null> };
          deviceMemory?: number;
        })
      : undefined;
  const hasWebGpu = Boolean(navWithGpu?.gpu);
  const deviceMemoryGb =
    typeof navWithGpu?.deviceMemory === 'number' ? navWithGpu.deviceMemory : null;

  if (!hasWebGpu || !hasOpfs) {
    return {
      supported: false,
      hasWebGpu,
      hasOpfs,
      deviceMemoryGb,
      reason: !hasWebGpu
        ? 'WebGPU unavailable on this browser — remote vision fallback required.'
        : 'OPFS storage unavailable — remote vision fallback required.',
    };
  }

  if (!forceLocalWebGpu && deviceMemoryGb !== null && deviceMemoryGb < minMemoryGb) {
    return {
      supported: false,
      hasWebGpu,
      hasOpfs,
      deviceMemoryGb,
      reason: `Device memory (${deviceMemoryGb} GB) below ${minMemoryGb} GB threshold — routing to remote fallback.`,
    };
  }

  try {
    const adapter = await navWithGpu!.gpu!.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        hasWebGpu,
        hasOpfs,
        deviceMemoryGb,
        reason: 'No WebGPU hardware adapter found — routing to remote fallback.',
      };
    }
    return {
      supported: true,
      hasWebGpu,
      hasOpfs,
      deviceMemoryGb,
      reason: 'WebGPU & OPFS hardware ready.',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      supported: false,
      hasWebGpu,
      hasOpfs,
      deviceMemoryGb,
      reason: `WebGPU probe failed (${message}) — routing to remote fallback.`,
    };
  }
}

/**
 * Checks whether the configured LiteRT-LM model bundle is already cached in OPFS.
 */
export async function isModelCachedInOpfs(
  config: Partial<ModelConfig> = {}
): Promise<{ cached: boolean; sizeBytes: number }> {
  const merged = { ...DEFAULT_MODEL_CONFIG, ...config };
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      return { cached: false, sizeBytes: 0 };
    }
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(merged.filename, { create: false });
    const file = await handle.getFile();
    if (file.size >= merged.minValidBytes) {
      return { cached: true, sizeBytes: file.size };
    }
    return { cached: false, sizeBytes: file.size };
  } catch {
    return { cached: false, sizeBytes: 0 };
  }
}

/**
 * 3-State Capability Router:
 *   1. 'unsupported'       -> WebGPU/OPFS/RAM insufficient; route to remote vision if configured
 *   2. 'ready_to_download' -> Hardware ready; prompt user to stream model to OPFS over Wi-Fi
 *   3. 'opfs_cached'       -> Model cached in OPFS; run 100% locally offline via WebGPU
 */
export async function detectDeviceCapability(
  config: Partial<ModelConfig> = {},
  options: { forceLocalWebGpu?: boolean } = {}
): Promise<DeviceCapability> {
  const merged = { ...DEFAULT_MODEL_CONFIG, ...config };
  const hw = await checkWebGpuAndOpfsSupport(
    merged.minMemoryGb,
    Boolean(options.forceLocalWebGpu)
  );

  if (!hw.supported) {
    return {
      state: 'unsupported',
      reason: hw.reason,
      cachedSizeBytes: 0,
      hasWebGpu: hw.hasWebGpu,
      hasOpfs: hw.hasOpfs,
      deviceMemoryGb: hw.deviceMemoryGb,
    };
  }

  const cacheInfo = await isModelCachedInOpfs(merged);
  if (cacheInfo.cached) {
    return {
      state: 'opfs_cached',
      reason: 'Gemma 4 E2B WebGPU cached in OPFS — 100% offline-ready.',
      cachedSizeBytes: cacheInfo.sizeBytes,
      hasWebGpu: hw.hasWebGpu,
      hasOpfs: hw.hasOpfs,
      deviceMemoryGb: hw.deviceMemoryGb,
    };
  }

  return {
    state: 'ready_to_download',
    reason: 'WebGPU & OPFS ready. Download model weights for 100% offline field mode.',
    cachedSizeBytes: 0,
    hasWebGpu: hw.hasWebGpu,
    hasOpfs: hw.hasOpfs,
    deviceMemoryGb: hw.deviceMemoryGb,
  };
}

/**
 * Streams the LiteRT-LM model file from Hugging Face (or custom URL) directly into OPFS
 * with Screen Wake Lock, Range-based resume support, and real-time progress callbacks.
 */
export async function downloadModelToOpfs(
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal,
  config: Partial<ModelConfig> = {}
): Promise<boolean> {
  const merged = { ...DEFAULT_MODEL_CONFIG, ...config };
  const root = await navigator.storage.getDirectory();
  const tempName = `${merged.filename}.downloading`;
  const tempHandle = await root.getFileHandle(tempName, { create: true });

  // Acquire Screen Wake Lock so mobile devices do not sleep and kill the stream mid-download.
  let wakeLock: { release: () => Promise<void> } | null = null;
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (nav.wakeLock?.request) {
      wakeLock = await nav.wakeLock.request('screen');
    }
  } catch {
    // Wake Lock unsupported or denied; continue download
  }

  let existingBytes = 0;
  try {
    const existingFile = await tempHandle.getFile();
    existingBytes = existingFile.size;
  } catch {
    existingBytes = 0;
  }

  const fetchWithFallback = async (rangeStart: number): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (rangeStart > 0) {
      headers.Range = `bytes=${rangeStart}-`;
    }
    try {
      return await fetch(merged.downloadUrl, {
        signal,
        headers,
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
      });
    } catch (directErr) {
      if (
        typeof window !== 'undefined' &&
        /^https:\/\//i.test(merged.downloadUrl) &&
        directErr instanceof TypeError
      ) {
        const proxyUrl = `/api/model-proxy?url=${encodeURIComponent(merged.downloadUrl)}`;
        return await fetch(proxyUrl, { signal, headers });
      }
      throw directErr;
    }
  };

  let writable: FileSystemWritableFileStream | null = null;
  let wroteNewBytes = false;

  try {
    let resp = await fetchWithFallback(existingBytes);

    // If Range is invalid/unsatisfiable, restart from byte 0.
    if (resp.status === 416 && existingBytes > 0) {
      existingBytes = 0;
      resp = await fetchWithFallback(0);
    }

    if ((!resp.ok && resp.status !== 206) || !resp.body) {
      throw new Error(`Model download failed (HTTP ${resp.status})`);
    }

    const isPartial = resp.status === 206 && existingBytes > 0;
    const resumeOffset = isPartial ? existingBytes : 0;

    let totalBytes = 0;
    if (isPartial) {
      const cr = resp.headers.get('content-range') || '';
      const match = cr.match(/\/(\d+)$/);
      totalBytes = match
        ? Number(match[1])
        : resumeOffset + Number(resp.headers.get('content-length') || 0);
    } else {
      totalBytes = Number(resp.headers.get('content-length') || 0);
    }

    writable = await tempHandle.createWritable({ keepExistingData: isPartial });
    if (isPartial) {
      await writable.seek(resumeOffset);
    }

    const reader = resp.body.getReader();
    let receivedBytes = resumeOffset;

    if (resumeOffset > 0) {
      onProgress?.({
        receivedBytes,
        totalBytes,
        percent: totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0,
      });
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      wroteNewBytes = true;
      receivedBytes += value.byteLength;
      onProgress?.({
        receivedBytes,
        totalBytes,
        percent: totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0,
      });
    }

    await writable.close();
    writable = null;

    const finalHandle = await root.getFileHandle(merged.filename, { create: true });
    const finalWritable = await finalHandle.createWritable();
    const downloadedFile = await tempHandle.getFile();
    await downloadedFile.stream().pipeTo(finalWritable);
    await root.removeEntry(tempName).catch(() => {});

    onProgress?.({ receivedBytes, totalBytes: receivedBytes, percent: 100 });
    return true;
  } catch (err) {
    if (writable) {
      try {
        // Close instead of abort when bytes were written so the next attempt can resume via Range.
        if (wroteNewBytes) {
          await writable.close();
        } else {
          await writable.abort();
        }
      } catch {
        // ignore cleanup failure
      }
    }
    if (err instanceof TypeError && /fetch/i.test(err.message)) {
      throw new Error(
        `Network/CORS error fetching ${merged.filename} (${err.message}). Tap Download again to resume, or use "Direct Link" + "Import .litertlm".`
      );
    }
    throw err;
  } finally {
    if (wakeLock) {
      await wakeLock.release().catch(() => {});
    }
  }
}

/**
 * Imports a locally downloaded .litertlm File directly into OPFS.
 */
export async function importModelFileToOpfs(
  file: File,
  onProgress?: (progress: ModelDownloadProgress) => void,
  config: Partial<ModelConfig> = {}
): Promise<boolean> {
  const merged = { ...DEFAULT_MODEL_CONFIG, ...config };
  const root = await navigator.storage.getDirectory();
  const tempName = `${merged.filename}.importing`;
  const tempHandle = await root.getFileHandle(tempName, { create: true });
  const writable = await tempHandle.createWritable();

  try {
    const totalBytes = file.size;
    const reader = file.stream().getReader();
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      receivedBytes += value.byteLength;
      onProgress?.({
        receivedBytes,
        totalBytes,
        percent: totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0,
      });
    }

    await writable.close();

    const finalHandle = await root.getFileHandle(merged.filename, { create: true });
    const finalWritable = await finalHandle.createWritable();
    const importedFile = await tempHandle.getFile();
    await importedFile.stream().pipeTo(finalWritable);
    await root.removeEntry(tempName).catch(() => {});

    onProgress?.({ receivedBytes, totalBytes: receivedBytes, percent: 100 });
    return true;
  } catch (err) {
    try {
      await writable.abort();
      await root.removeEntry(tempName).catch(() => {});
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

/**
 * Removes the cached model file from OPFS to free local browser storage.
 */
export async function removeModelFromOpfs(filename = DEFAULT_MODEL_CONFIG.filename): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(filename);
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats byte counts into a human-readable string (e.g., "1.42 GB").
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 || idx === 0 ? Math.round(val) : val.toFixed(2)} ${units[idx]}`;
}
