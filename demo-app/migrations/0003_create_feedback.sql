CREATE TABLE IF NOT EXISTS tester_feedback (
  id TEXT PRIMARY KEY,
  rating TEXT NOT NULL,
  message TEXT NOT NULL,
  email TEXT,
  diagnostics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tester_feedback_created_at
  ON tester_feedback (created_at DESC);
