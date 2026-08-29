CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 1,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_email TEXT,
  action TEXT NOT NULL,
  detail_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_email ON audit_log(actor_email);
