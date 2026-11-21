CREATE TABLE IF NOT EXISTS custom_schemas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_custom_schemas_updated_at
  ON custom_schemas (updated_at DESC);
