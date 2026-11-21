import type { FieldAppSchema } from '@edge-field-assistant/core';

export const BUILT_IN_SCHEMA_IDS = new Set([
  'twincover-cope',
  'oceanfalls-facility',
  'twinflow-lead-intake',
]);

export const CUSTOM_SCHEMAS_STORAGE_KEY = 'edge_field_assistant_custom_schemas_v1';
export const MERGED_SCHEMAS_CACHE_KEY = 'edge_field_assistant_merged_schemas_v1';
export const ADMIN_TOKEN_STORAGE_KEY = 'edge_field_assistant_admin_token_v1';

export type SchemaSyncStatus = 'idle' | 'synced' | 'offline_local' | 'auth_required';

interface RemoteSchemaRow {
  id: string;
  name: string;
  schema_json: string;
  updated_at: string;
}

export function loadAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveAdminToken(token: string): void {
  try {
    if (token.trim()) {
      localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token.trim());
    } else {
      localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function readCachedCustomSchemas(): FieldAppSchema[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SCHEMAS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FieldAppSchema[]) : [];
  } catch {
    return [];
  }
}

function writeCachedSchemas(schemas: FieldAppSchema[]): void {
  try {
    const customOnly = schemas.filter((s) => !BUILT_IN_SCHEMA_IDS.has(s.id));
    localStorage.setItem(CUSTOM_SCHEMAS_STORAGE_KEY, JSON.stringify(customOnly));
    localStorage.setItem(MERGED_SCHEMAS_CACHE_KEY, JSON.stringify(schemas));
  } catch {
    // ignore quota errors
  }
}

function readCachedMergedSchemas(): FieldAppSchema[] {
  try {
    const raw = localStorage.getItem(MERGED_SCHEMAS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FieldAppSchema[]) : [];
  } catch {
    return [];
  }
}

/**
 * Loads static schemas from /schemas/index.json, merges cached localStorage schemas,
 * and if online fetches /api/schemas (cloud schemas override matching IDs).
 */
export async function loadAndSyncSchemas(): Promise<{
  schemas: FieldAppSchema[];
  syncStatus: SchemaSyncStatus;
}> {
  const byId = new Map<string, FieldAppSchema>();

  // 1. Seed from cached merged list first for instant offline resilience
  for (const cached of readCachedMergedSchemas()) {
    byId.set(cached.id, cached);
  }

  // 2. Load static built-in schemas
  try {
    const idxResp = await fetch('/schemas/index.json');
    if (idxResp.ok) {
      const files = (await idxResp.json()) as string[];
      const fetched = await Promise.all(
        files.map(async (file) => {
          const r = await fetch(`/schemas/${file}`);
          return r.ok ? ((await r.json()) as FieldAppSchema) : null;
        })
      );
      for (const schema of fetched) {
        if (schema?.id) {
          byId.set(schema.id, schema);
        }
      }
    }
  } catch {
    // offline or SW cache miss
  }

  // 3. Apply locally saved custom schemas
  for (const localCustom of readCachedCustomSchemas()) {
    if (localCustom?.id) {
      byId.set(localCustom.id, localCustom);
    }
  }

  // 4. Fetch cloud schemas when online; cloud overrides matching IDs
  let syncStatus: SchemaSyncStatus =
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline_local' : 'idle';

  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      const resp = await fetch('/api/schemas');
      if (resp.ok) {
        const rows = (await resp.json()) as RemoteSchemaRow[];
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row.schema_json) as FieldAppSchema;
            if (parsed?.id) {
              byId.set(parsed.id, parsed);
            }
          } catch {
            // ignore malformed remote row
          }
        }
        const storageMode = resp.headers.get('X-Schema-Storage');
        syncStatus = storageMode === 'd1' || storageMode === 'kv' ? 'synced' : 'idle';
      }
    } catch {
      syncStatus = 'offline_local';
    }
  }

  const merged = Array.from(byId.values());
  if (merged.length > 0) {
    writeCachedSchemas(merged);
  }

  return { schemas: merged, syncStatus };
}

export async function persistSchema(
  schema: FieldAppSchema,
  allSchemas: FieldAppSchema[],
  adminToken: string
): Promise<{ schemas: FieldAppSchema[]; syncStatus: SchemaSyncStatus }> {
  const next = [...allSchemas.filter((s) => s.id !== schema.id), schema];
  writeCachedSchemas(next);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { schemas: next, syncStatus: 'offline_local' };
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (adminToken.trim()) {
      headers.Authorization = `Bearer ${adminToken.trim()}`;
    }

    const resp = await fetch('/api/schemas', {
      method: 'POST',
      headers,
      body: JSON.stringify(schema),
    });

    if (resp.status === 401 || resp.status === 403) {
      return { schemas: next, syncStatus: 'auth_required' };
    }
    if (resp.ok) {
      return { schemas: next, syncStatus: 'synced' };
    }
    return { schemas: next, syncStatus: 'offline_local' };
  } catch {
    return { schemas: next, syncStatus: 'offline_local' };
  }
}

export async function removeCustomSchema(
  schemaId: string,
  allSchemas: FieldAppSchema[],
  adminToken: string
): Promise<{ schemas: FieldAppSchema[]; syncStatus: SchemaSyncStatus }> {
  const next = allSchemas.filter((s) => s.id !== schemaId);
  writeCachedSchemas(next);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { schemas: next, syncStatus: 'offline_local' };
  }

  try {
    const headers: Record<string, string> = {};
    if (adminToken.trim()) {
      headers.Authorization = `Bearer ${adminToken.trim()}`;
    }

    const resp = await fetch(`/api/schemas?id=${encodeURIComponent(schemaId)}`, {
      method: 'DELETE',
      headers,
    });

    if (resp.status === 401 || resp.status === 403) {
      return { schemas: next, syncStatus: 'auth_required' };
    }
    if (resp.ok) {
      return { schemas: next, syncStatus: 'synced' };
    }
    return { schemas: next, syncStatus: 'offline_local' };
  } catch {
    return { schemas: next, syncStatus: 'offline_local' };
  }
}
