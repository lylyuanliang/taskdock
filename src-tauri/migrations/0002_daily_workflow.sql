CREATE TABLE todo_projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX todo_projects_active_index
ON todo_projects(archived_at, name);

CREATE TABLE todo_tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(name)
);

CREATE TABLE todo_task_tags (
  task_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY(task_id, tag_id),
  FOREIGN KEY(task_id) REFERENCES todo_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES todo_tags(id) ON DELETE CASCADE
);

ALTER TABLE todo_tasks ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE todo_tasks ADD COLUMN recurrence_instance INTEGER NOT NULL DEFAULT 1;
ALTER TABLE todo_tasks ADD COLUMN monthly_anchor_day INTEGER;

UPDATE todo_tasks
SET recurrence_json = CASE recurrence_json
  WHEN '"Daily"' THEN '{"frequency":"daily","interval":1,"until":null,"count":null}'
  WHEN '"Weekly"' THEN '{"frequency":"weekly","interval":1,"until":null,"count":null}'
  WHEN '"Monthly"' THEN '{"frequency":"monthly","interval":1,"until":null,"count":null}'
  WHEN '"Yearly"' THEN '{"frequency":"yearly","interval":1,"until":null,"count":null}'
  ELSE recurrence_json
END
WHERE recurrence_json IS NOT NULL;

UPDATE todo_tasks
SET monthly_anchor_day = CAST(strftime('%d', scheduled_at) AS INTEGER)
WHERE (
  recurrence_json LIKE '{"frequency":"monthly"%'
  OR recurrence_json LIKE '{"frequency":"yearly"%'
)
  AND scheduled_at IS NOT NULL;
