ALTER TABLE todo_sync_config
ADD COLUMN frequency TEXT NOT NULL DEFAULT 'fiveMinutes';
