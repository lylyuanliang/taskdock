CREATE UNIQUE INDEX todo_projects_active_name_unique
ON todo_projects(name COLLATE NOCASE)
WHERE archived_at IS NULL;
