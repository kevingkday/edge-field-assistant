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
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
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

const KV_PREFIX = 'schema:';

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

function validateSchemaPayload(body: unknown):
  | { valid: true; id: string; name: string; schemaJson: string }
  | { valid: false; error: string } {
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

async function handleGetSchemas(env: Env): Promise<Response> {
  try {
    if (env.SCHEMAS_DB) {
      const { results } = await env.SCHEMAS_DB.prepare(
        'SELECT id, name, schema_json, updated_at FROM custom_schemas ORDER BY updated_at DESC'
      ).all<SchemaRow>();
      return jsonResponse(results || [], 200, { 'X-Schema-Storage': 'd1' });
    }

    if (env.SCHEMAS_KV) {
      const listed = await env.SCHEMAS_KV.list({ prefix: KV_PREFIX });
      const rows = await Promise.all(
        listed.keys.map(async (k) => {
          const raw = await env.SCHEMAS_KV!.get(k.name);
          if (!raw) return null;
          try {
            return JSON.parse(raw) as SchemaRow;
          } catch {
            return null;
          }
        })
      );
      const validRows = rows
        .filter((r): r is SchemaRow => r !== null)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      return jsonResponse(validRows, 200, { 'X-Schema-Storage': 'kv' });
    }

    return jsonResponse([], 200, { 'X-Schema-Storage': 'unconfigured' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load schemas';
    return jsonResponse({ error: message }, 500);
  }
}

async function handlePostSchema(request: Request, env: Env): Promise<Response> {
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

  const updatedAt = new Date().toISOString();
  const row: SchemaRow = {
    id: validation.id,
    name: validation.name,
    schema_json: validation.schemaJson,
    updated_at: updatedAt,
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
      await env.SCHEMAS_KV.put(`${KV_PREFIX}${row.id}`, JSON.stringify(row));
      return jsonResponse({ ok: true, storage: 'kv', ...row }, 200);
    }

    return jsonResponse(
      { ok: false, error: 'Neither SCHEMAS_DB (D1) nor SCHEMAS_KV (KV) is bound.' },
      501
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save schema';
    return jsonResponse({ error: message }, 500);
  }
}

async function handleDeleteSchema(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized: valid SCHEMA_ADMIN_TOKEN required.' }, 401);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim();
  if (!id) {
    return jsonResponse({ error: 'Missing required "id" query parameter.' }, 400);
  }

  try {
    if (env.SCHEMAS_DB) {
      await env.SCHEMAS_DB.prepare('DELETE FROM custom_schemas WHERE id = ?').bind(id).run();
      return jsonResponse({ ok: true, storage: 'd1', deletedId: id }, 200);
    }

    if (env.SCHEMAS_KV) {
      await env.SCHEMAS_KV.delete(`${KV_PREFIX}${id}`);
      return jsonResponse({ ok: true, storage: 'kv', deletedId: id }, 200);
    }

    return jsonResponse(
      { ok: false, error: 'Neither SCHEMAS_DB (D1) nor SCHEMAS_KV (KV) is bound.' },
      501
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete schema';
    return jsonResponse({ error: message }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/schemas') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        });
      }
      if (request.method === 'GET') return handleGetSchemas(env);
      if (request.method === 'POST') return handlePostSchema(request, env);
      if (request.method === 'DELETE') return handleDeleteSchema(request, env);
      return jsonResponse({ error: `Method ${request.method} not allowed` }, 405);
    }

    return env.ASSETS.fetch(request);
  },
};
