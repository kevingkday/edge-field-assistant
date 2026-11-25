interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS?: Fetcher;
  SCHEMAS_DB?: D1Database;
  SCHEMAS_KV?: KVNamespace;
  SCHEMA_ADMIN_TOKEN?: string;
}

interface SchemaRow {
  id: string;
  name: string;
  schema_json: string;
  updated_at: string;
}

interface CustomModelRow {
  id: string;
  name: string;
  url: string;
  size_mb: number | null;
  description: string | null;
  updated_at: string;
}

const SCHEMA_KV_PREFIX = 'schema:';
const MODEL_KV_PREFIX = 'model:';
const FEEDBACK_KV_PREFIX = 'feedback:';

interface FeedbackRow {
  id: string;
  rating: string;
  message: string;
  email: string | null;
  diagnostics_json: string;
  created_at: string;
}

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  const token = env.SCHEMA_ADMIN_TOKEN?.trim();
  if (!token) return true;
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${token}`;
}

function validateSchemaPayload(
  body: unknown
): { valid: true; id: string; name: string; schemaJson: string } | { valid: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object.' };
  }

  const record = body as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';

  if (!id || !name) {
    return { valid: false, error: 'Schema must include non-empty "id" and "name" strings.' };
  }

  if (!Array.isArray(record.items) || record.items.length === 0) {
    return { valid: false, error: 'Schema must include a non-empty "items" array.' };
  }

  for (const item of record.items) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as Record<string, unknown>).id !== 'string' ||
      typeof (item as Record<string, unknown>).label !== 'string'
    ) {
      return {
        valid: false,
        error: 'Each item in "items" must be an object with string "id" and "label".',
      };
    }
  }

  return {
    valid: true,
    id,
    name,
    schemaJson: JSON.stringify(record),
  };
}

function validateModelPayload(body: unknown):
  | {
      valid: true;
      id: string;
      name: string;
      url: string;
      size_mb: number | null;
      description: string | null;
    }
  | { valid: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object.' };
  }

  const record = body as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const rawId = typeof record.id === 'string' ? record.id.trim() : '';
  const id =
    rawId ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const url = typeof record.url === 'string' ? record.url.trim() : '';

  if (!id || !name || !url) {
    return { valid: false, error: 'Model must include non-empty "id", "name", and "url".' };
  }

  if (!/^https?:\/\//i.test(url)) {
    return { valid: false, error: 'Model "url" must start with http:// or https://.' };
  }

  let sizeMb: number | null = null;
  if (record.size_mb !== undefined && record.size_mb !== null && record.size_mb !== '') {
    const parsedSize = Number(record.size_mb);
    if (!Number.isFinite(parsedSize) || parsedSize < 0) {
      return { valid: false, error: 'Model "size_mb" must be a non-negative number.' };
    }
    sizeMb = Math.round(parsedSize);
  }

  const description =
    typeof record.description === 'string' && record.description.trim()
      ? record.description.trim()
      : null;

  return { valid: true, id, name, url, size_mb: sizeMb, description };
}

async function listFromKv<T extends { updated_at: string }>(
  kv: KVNamespace,
  prefix: string
): Promise<T[]> {
  const listed = await kv.list({ prefix });
  const rows = await Promise.all(
    listed.keys.map(async (k) => {
      const raw = await kv.get(k.name);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    })
  );
  return rows
    .filter((r): r is T => r !== null)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

async function handleSchemasRequest(request: Request, env: Env): Promise<Response> {
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    try {
      if (env.SCHEMAS_DB) {
        const { results } = await env.SCHEMAS_DB.prepare(
          'SELECT id, name, schema_json, updated_at FROM custom_schemas ORDER BY updated_at DESC'
        ).all<SchemaRow>();
        return jsonResponse(results || [], 200, { 'X-Schema-Storage': 'd1' });
      }
      if (env.SCHEMAS_KV) {
        const rows = await listFromKv<SchemaRow>(env.SCHEMAS_KV, SCHEMA_KV_PREFIX);
        return jsonResponse(rows, 200, { 'X-Schema-Storage': 'kv' });
      }
      return jsonResponse([], 200, { 'X-Schema-Storage': 'unconfigured' });
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to load schemas' },
        500
      );
    }
  }

  if (method === 'POST') {
    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: 'Unauthorized: valid SCHEMA_ADMIN_TOKEN required.' }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
    }

    const validation = validateSchemaPayload(body);
    if (!validation.valid) {
      return jsonResponse({ error: validation.error }, 400);
    }

    const row: SchemaRow = {
      id: validation.id,
      name: validation.name,
      schema_json: validation.schemaJson,
      updated_at: new Date().toISOString(),
    };

    try {
      if (env.SCHEMAS_DB) {
        await env.SCHEMAS_DB.prepare(
          `INSERT INTO custom_schemas (id, name, schema_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             schema_json = excluded.schema_json,
             updated_at = excluded.updated_at`
        )
          .bind(row.id, row.name, row.schema_json, row.updated_at)
          .run();
        return jsonResponse({ ok: true, storage: 'd1', ...row }, 200);
      }

      if (env.SCHEMAS_KV) {
        await env.SCHEMAS_KV.put(`${SCHEMA_KV_PREFIX}${row.id}`, JSON.stringify(row));
        return jsonResponse({ ok: true, storage: 'kv', ...row }, 200);
      }

      return jsonResponse(
        { ok: false, error: 'Neither SCHEMAS_DB (D1) nor SCHEMAS_KV (KV) is bound.' },
        501
      );
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to save schema' },
        500
      );
    }
  }

  if (method === 'DELETE') {
    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: 'Unauthorized: valid SCHEMA_ADMIN_TOKEN required.' }, 401);
    }

    const id = new URL(request.url).searchParams.get('id')?.trim();
    if (!id) {
      return jsonResponse({ error: 'Missing required "id" query parameter.' }, 400);
    }

    try {
      if (env.SCHEMAS_DB) {
        await env.SCHEMAS_DB.prepare('DELETE FROM custom_schemas WHERE id = ?').bind(id).run();
        return jsonResponse({ ok: true, storage: 'd1', deletedId: id }, 200);
      }

      if (env.SCHEMAS_KV) {
        await env.SCHEMAS_KV.delete(`${SCHEMA_KV_PREFIX}${id}`);
        return jsonResponse({ ok: true, storage: 'kv', deletedId: id }, 200);
      }

      return jsonResponse(
        { ok: false, error: 'Neither SCHEMAS_DB (D1) nor SCHEMAS_KV (KV) is bound.' },
        501
      );
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to delete schema' },
        500
      );
    }
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

async function handleModelsRequest(request: Request, env: Env): Promise<Response> {
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    try {
      if (env.SCHEMAS_DB) {
        const { results } = await env.SCHEMAS_DB.prepare(
          'SELECT id, name, url, size_mb, description, updated_at FROM custom_models ORDER BY updated_at DESC'
        ).all<CustomModelRow>();
        return jsonResponse(results || [], 200, { 'X-Model-Storage': 'd1' });
      }
      if (env.SCHEMAS_KV) {
        const rows = await listFromKv<CustomModelRow>(env.SCHEMAS_KV, MODEL_KV_PREFIX);
        return jsonResponse(rows, 200, { 'X-Model-Storage': 'kv' });
      }
      return jsonResponse([], 200, { 'X-Model-Storage': 'unconfigured' });
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to load custom models' },
        500
      );
    }
  }

  if (method === 'POST') {
    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: 'Unauthorized: valid SCHEMA_ADMIN_TOKEN required.' }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
    }

    const validation = validateModelPayload(body);
    if (!validation.valid) {
      return jsonResponse({ error: validation.error }, 400);
    }

    const row: CustomModelRow = {
      id: validation.id,
      name: validation.name,
      url: validation.url,
      size_mb: validation.size_mb,
      description: validation.description,
      updated_at: new Date().toISOString(),
    };

    try {
      if (env.SCHEMAS_DB) {
        await env.SCHEMAS_DB.prepare(
          `INSERT INTO custom_models (id, name, url, size_mb, description, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             url = excluded.url,
             size_mb = excluded.size_mb,
             description = excluded.description,
             updated_at = excluded.updated_at`
        )
          .bind(row.id, row.name, row.url, row.size_mb, row.description, row.updated_at)
          .run();
        return jsonResponse({ ok: true, storage: 'd1', ...row }, 200);
      }

      if (env.SCHEMAS_KV) {
        await env.SCHEMAS_KV.put(`${MODEL_KV_PREFIX}${row.id}`, JSON.stringify(row));
        return jsonResponse({ ok: true, storage: 'kv', ...row }, 200);
      }

      return jsonResponse(
        { ok: false, error: 'Neither SCHEMAS_DB (D1) nor SCHEMAS_KV (KV) is bound.' },
        501
      );
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to save custom model' },
        500
      );
    }
  }

  if (method === 'DELETE') {
    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: 'Unauthorized: valid SCHEMA_ADMIN_TOKEN required.' }, 401);
    }

    const id = new URL(request.url).searchParams.get('id')?.trim();
    if (!id) {
      return jsonResponse({ error: 'Missing required "id" query parameter.' }, 400);
    }

    try {
      if (env.SCHEMAS_DB) {
        await env.SCHEMAS_DB.prepare('DELETE FROM custom_models WHERE id = ?').bind(id).run();
        return jsonResponse({ ok: true, storage: 'd1', deletedId: id }, 200);
      }

      if (env.SCHEMAS_KV) {
        await env.SCHEMAS_KV.delete(`${MODEL_KV_PREFIX}${id}`);
        return jsonResponse({ ok: true, storage: 'kv', deletedId: id }, 200);
      }

      return jsonResponse(
        { ok: false, error: 'Neither SCHEMAS_DB (D1) nor SCHEMAS_KV (KV) is bound.' },
        501
      );
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to delete custom model' },
        500
      );
    }
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

async function handleModelProxyRequest(request: Request): Promise<Response> {
  if (request.method.toUpperCase() !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const target = new URL(request.url).searchParams.get('url')?.trim();
  if (!target || !/^https:\/\//i.test(target)) {
    return jsonResponse({ error: 'Missing or invalid https:// "url" parameter.' }, 400);
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(target);
  } catch {
    return jsonResponse({ error: 'Malformed target URL.' }, 400);
  }

  const host = parsedTarget.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.local') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.')
  ) {
    return jsonResponse({ error: 'Blocked private host.' }, 403);
  }

  try {
    const upstreamHeaders = new Headers();
    const range = request.headers.get('Range');
    if (range) upstreamHeaders.set('Range', range);

    const upstream = await fetch(parsedTarget.toString(), {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    if (!upstream.ok && upstream.status !== 206) {
      return jsonResponse(
        { error: `Upstream model fetch failed (HTTP ${upstream.status})` },
        upstream.status
      );
    }

    const headers = new Headers();
    const contentType = upstream.headers.get('Content-Type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('Content-Length');
    const contentRange = upstream.headers.get('Content-Range');
    headers.set('Content-Type', contentType);
    if (contentLength) headers.set('Content-Length', contentLength);
    if (contentRange) headers.set('Content-Range', contentRange);
    headers.set('Cache-Control', 'no-store');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Model proxy fetch failed' },
      502
    );
  }
}

async function handleFeedbackRequest(request: Request, env: Env): Promise<Response> {
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: 'Unauthorized: valid SCHEMA_ADMIN_TOKEN required.' }, 401);
    }

    try {
      if (env.SCHEMAS_DB) {
        const { results } = await env.SCHEMAS_DB.prepare(
          'SELECT id, rating, message, email, diagnostics_json, created_at FROM tester_feedback ORDER BY created_at DESC LIMIT 200'
        ).all<FeedbackRow>();
        return jsonResponse(results || [], 200, { 'X-Feedback-Storage': 'd1' });
      }
      if (env.SCHEMAS_KV) {
        const listed = await env.SCHEMAS_KV.list({ prefix: FEEDBACK_KV_PREFIX });
        const rows = await Promise.all(
          listed.keys.map(async (k) => {
            const raw = await env.SCHEMAS_KV!.get(k.name);
            if (!raw) return null;
            try {
              return JSON.parse(raw) as FeedbackRow;
            } catch {
              return null;
            }
          })
        );
        return jsonResponse(
          rows
            .filter((r): r is FeedbackRow => r !== null)
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
          200,
          { 'X-Feedback-Storage': 'kv' }
        );
      }
      return jsonResponse([], 200, { 'X-Feedback-Storage': 'logs' });
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to load feedback' },
        500
      );
    }
  }

  if (method === 'POST') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse({ error: 'Request body must be a JSON object.' }, 400);
    }

    const record = body as Record<string, unknown>;
    const rating = typeof record.rating === 'string' ? record.rating.trim() : '';
    const message = typeof record.message === 'string' ? record.message.trim() : '';
    const email =
      typeof record.email === 'string' && record.email.trim() ? record.email.trim() : null;

    if (!rating) {
      return jsonResponse({ error: 'Feedback must include a "rating".' }, 400);
    }

    const rawDiag =
      record.diagnostics && typeof record.diagnostics === 'object' && !Array.isArray(record.diagnostics)
        ? (record.diagnostics as Record<string, unknown>)
        : {};

    // Strictly whitelist non-sensitive diagnostic metadata (never photos or transcripts).
    const diagnostics = {
      userAgent: typeof rawDiag.userAgent === 'string' ? rawDiag.userAgent.slice(0, 300) : null,
      hasWebGPU: Boolean(rawDiag.hasWebGPU),
      deviceMemory:
        typeof rawDiag.deviceMemory === 'number' && Number.isFinite(rawDiag.deviceMemory)
          ? rawDiag.deviceMemory
          : null,
      activeSchemaId:
        typeof rawDiag.activeSchemaId === 'string' ? rawDiag.activeSchemaId.slice(0, 100) : null,
      inferenceLatencyMs:
        typeof rawDiag.inferenceLatencyMs === 'number' && Number.isFinite(rawDiag.inferenceLatencyMs)
          ? Math.round(rawDiag.inferenceLatencyMs)
          : null,
    };

    const createdAt = new Date().toISOString();
    const id = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const row: FeedbackRow = {
      id,
      rating: rating.slice(0, 80),
      message: message.slice(0, 4000),
      email: email ? email.slice(0, 200) : null,
      diagnostics_json: JSON.stringify(diagnostics),
      created_at: createdAt,
    };

    console.log(JSON.stringify({ type: 'tester_feedback', ...row }));

    if (env.SCHEMAS_DB) {
      try {
        await env.SCHEMAS_DB.prepare(
          `INSERT INTO tester_feedback (id, rating, message, email, diagnostics_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(row.id, row.rating, row.message, row.email, row.diagnostics_json, row.created_at)
          .run();
        return jsonResponse({ ok: true, storage: 'd1', id: row.id }, 200);
      } catch {
        // Fall through to KV or logs if migration hasn't been applied yet
      }
    }

    if (env.SCHEMAS_KV) {
      await env.SCHEMAS_KV.put(`${FEEDBACK_KV_PREFIX}${row.created_at}_${row.id}`, JSON.stringify(row));
      return jsonResponse({ ok: true, storage: 'kv', id: row.id }, 200);
    }

    return jsonResponse({ ok: true, storage: 'logs', id: row.id }, 200);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/schemas') {
      return handleSchemasRequest(request, env);
    }

    if (url.pathname === '/api/models') {
      return handleModelsRequest(request, env);
    }

    if (url.pathname === '/api/model-proxy') {
      return handleModelProxyRequest(request);
    }

    if (url.pathname === '/api/feedback') {
      return handleFeedbackRequest(request, env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
