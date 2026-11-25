export interface FeedbackDiagnostics {
  userAgent: string;
  hasWebGPU: boolean;
  deviceMemory: number | null;
  activeSchemaId: string;
  inferenceLatencyMs: number | null;
}

export type FeedbackRating =
  | 'Worked Great'
  | 'Slow or Glitchy'
  | "Didn't Load on My Device";

export interface FeedbackSubmission {
  id: string;
  rating: FeedbackRating;
  message: string;
  email?: string;
  diagnostics: FeedbackDiagnostics;
  createdAt: string;
}

const DB_NAME = 'twinfield_feedback_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_feedback';

function openFeedbackDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

async function putQueuedFeedback(item: FeedbackSubmission): Promise<void> {
  const db = await openFeedbackDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to queue feedback'));
    };
  });
}

async function listQueuedFeedback(): Promise<FeedbackSubmission[]> {
  try {
    const db = await openFeedbackDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        db.close();
        resolve((req.result as FeedbackSubmission[]) || []);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch {
    return [];
  }
}

async function deleteQueuedFeedback(id: string): Promise<void> {
  const db = await openFeedbackDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to delete queued feedback'));
    };
  });
}

export async function getQueuedFeedbackCount(): Promise<number> {
  const items = await listQueuedFeedback();
  return items.length;
}

async function postFeedbackToServer(item: FeedbackSubmission): Promise<boolean> {
  const resp = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  return resp.ok;
}

export async function submitOrQueueFeedback(
  input: Omit<FeedbackSubmission, 'id' | 'createdAt'>
): Promise<{ status: 'sent' | 'queued'; id: string }> {
  const item: FeedbackSubmission = {
    ...input,
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };

  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      const ok = await postFeedbackToServer(item);
      if (ok) {
        return { status: 'sent', id: item.id };
      }
    } catch {
      // fall through to IndexedDB queue
    }
  }

  await putQueuedFeedback(item);
  return { status: 'queued', id: item.id };
}

export async function flushFeedbackQueue(): Promise<{
  flushed: number;
  remaining: number;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const items = await listQueuedFeedback();
    return { flushed: 0, remaining: items.length };
  }

  const items = await listQueuedFeedback();
  let flushed = 0;

  for (const item of items) {
    try {
      const ok = await postFeedbackToServer(item);
      if (ok) {
        await deleteQueuedFeedback(item.id);
        flushed += 1;
      }
    } catch {
      // Keep remaining items queued until next online event
      break;
    }
  }

  return { flushed, remaining: items.length - flushed };
}
