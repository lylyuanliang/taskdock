ALTER TABLE todo_sync_config
ADD COLUMN strategy TEXT NOT NULL DEFAULT 'smartMerge';
