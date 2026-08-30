CREATE TABLE IF NOT EXISTS operator_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  issue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepting', 'accepted', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  accepted_at TEXT,
  accepted_by TEXT,
  assigned_profile_id TEXT,
  assigned_profile_name TEXT,
  linked_job_no TEXT,
  rejected_at TEXT,
  rejected_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_operator_requests_status ON operator_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_requests_machine ON operator_requests(machine_id, created_at DESC);
