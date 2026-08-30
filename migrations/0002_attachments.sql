CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('job', 'machine')),
  entity_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id, uploaded_at);
