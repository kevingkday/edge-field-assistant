CREATE TABLE IF NOT EXISTS custom_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  size_mb INTEGER,
  description TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_custom_models_updated_at
  ON custom_models (updated_at DESC);
