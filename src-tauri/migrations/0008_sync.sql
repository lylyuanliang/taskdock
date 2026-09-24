CREATE TABLE todo_sync_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  endpoint TEXT NOT NULL,
  remote_directory TEXT NOT NULL,
  username TEXT NOT NULL,
  encryption_enabled INTEGER NOT NULL DEFAULT 1,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE todo_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL,
  last_synced_at TEXT,
  last_error_code TEXT,
  pending_upload INTEGER NOT NULL DEFAULT 0,
  pending_download INTEGER NOT NULL DEFAULT 0,
  conflicts INTEGER NOT NULL DEFAULT 0,
  baseline_snapshot_id TEXT
);

CREATE TABLE todo_sync_baselines (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE todo_sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX todo_sync_queue_due_index
ON todo_sync_queue(next_attempt_at, id);

CREATE TABLE todo_sync_conflicts (
  entity_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  field_name TEXT NOT NULL,
  local_json TEXT,
  remote_json TEXT,
  base_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  decision TEXT,
  PRIMARY KEY(entity_id, entity_kind, field_name)
);

CREATE INDEX todo_sync_conflicts_pending_index
ON todo_sync_conflicts(resolved_at, created_at);
