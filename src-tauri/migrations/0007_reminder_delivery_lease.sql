ALTER TABLE todo_tasks ADD COLUMN reminder_claimed_at TEXT;

CREATE INDEX todo_tasks_reminder_due_lease_index
ON todo_tasks(reminder_sent_at, reminder_claimed_at, scheduled_at)
WHERE completed_at IS NULL;
