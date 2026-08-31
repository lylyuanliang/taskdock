CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE todo_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  project_id TEXT,
  parent_id TEXT,
  priority TEXT NOT NULL,
  scheduled_at TEXT,
  due_at TEXT,
  completed_at TEXT,
  recurrence_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(parent_id) REFERENCES todo_tasks(id)
);

CREATE INDEX todo_tasks_inbox_index
ON todo_tasks(completed_at, scheduled_at, created_at);
