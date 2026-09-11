ALTER TABLE todo_tasks ADD COLUMN reminder_claim_token TEXT;

CREATE UNIQUE INDEX todo_tasks_reminder_claim_token_unique
ON todo_tasks(reminder_claim_token)
WHERE reminder_claim_token IS NOT NULL;
