use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Params};
use uuid::Uuid;

use crate::{
    domain::{
        ports::{
            ProjectRepository, SubtaskInsertOutcome, SubtaskRepository, TaskEditor,
            TaskEditorRepository, TaskRepository,
        },
        project::Project,
        recurrence::TaskCompletion,
        task::{Priority, RecurrenceRule, ReminderClaimStateUpdate, Task},
        task_query::{TaskSummaryDto, TaskView},
    },
    error::{AppError, AppErrorKind},
};

const INITIAL_MIGRATION: &str = include_str!("../../migrations/0001_initial.sql");
const DAILY_WORKFLOW_MIGRATION: &str = include_str!("../../migrations/0002_daily_workflow.sql");
const TASK_SEARCH_MIGRATION: &str = include_str!("../../migrations/0003_task_search.sql");
const PROJECT_MANAGEMENT_MIGRATION: &str =
    include_str!("../../migrations/0004_project_management.sql");
const REMINDER_CLAIM_TOKEN_MIGRATION: &str =
    include_str!("../../migrations/0005_reminder_claim_token.sql");
const TASK_REVISION_MIGRATION: &str = include_str!("../../migrations/0006_task_revision.sql");
const REMINDER_DELIVERY_LEASE_MIGRATION: &str =
    include_str!("../../migrations/0007_reminder_delivery_lease.sql");
const MIGRATIONS: &[(i64, &str)] = &[
    (1, INITIAL_MIGRATION),
    (2, DAILY_WORKFLOW_MIGRATION),
    (3, TASK_SEARCH_MIGRATION),
    (4, PROJECT_MANAGEMENT_MIGRATION),
    (5, REMINDER_CLAIM_TOKEN_MIGRATION),
    (6, TASK_REVISION_MIGRATION),
    (7, REMINDER_DELIVERY_LEASE_MIGRATION),
];
const STORAGE_ERROR_CODE: &str = "storage.unavailable";
const STORAGE_ERROR_KEY: &str = "errors.storage.unavailable";

#[derive(Clone)]
pub(crate) struct SqliteTaskRepository {
    connection: Arc<Mutex<Connection>>,
}

impl SqliteTaskRepository {
    pub(crate) fn open(path: &Path) -> Result<Self, AppError> {
        let connection = Connection::open(path).map_err(storage_error)?;

        Self::from_connection(connection)
    }

    #[cfg(test)]
    pub(crate) fn in_memory() -> Result<Self, AppError> {
        let connection = Connection::open_in_memory().map_err(storage_error)?;

        Self::from_connection(connection)
    }

    #[cfg(test)]
    pub(crate) fn fail_task_tag_association_inserts_for_test(&self) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection
                .execute_batch(
                    "CREATE TRIGGER todo_test_fail_task_tag_insert \
                     BEFORE INSERT ON todo_task_tags \
                     BEGIN SELECT RAISE(ABORT, 'forced task tag insert failure'); END",
                )
                .map_err(storage_error)
        })
    }

    #[cfg(test)]
    pub(crate) fn fail_subtask_project_update_for_test(
        &self,
        subtask_id: Uuid,
    ) -> Result<(), AppError> {
        let trigger = format!(
            "CREATE TRIGGER todo_test_fail_subtask_project_update \
             BEFORE UPDATE OF project_id ON todo_tasks \
             WHEN OLD.id = '{subtask_id}' \
             BEGIN SELECT RAISE(ABORT, 'forced subtask project update failure'); END"
        );

        self.with_connection(|connection| connection.execute_batch(&trigger).map_err(storage_error))
    }

    fn from_connection(connection: Connection) -> Result<Self, AppError> {
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(storage_error)?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(storage_error)?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(storage_error)?;
        run_migrations(&connection)?;

        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut connection = self.connection.lock().map_err(|_| storage_error(()))?;

        operation(&mut connection)
    }
}

impl TaskRepository for SqliteTaskRepository {
    fn insert(&self, task: &Task) -> Result<(), AppError> {
        self.with_connection(|connection| insert_task(connection, task))
    }

    fn update(
        &self,
        task: &Task,
        expected_revision: i64,
        reminder_claim_state_update: ReminderClaimStateUpdate,
    ) -> Result<(), AppError> {
        self.with_connection(|connection| {
            update_task_and_direct_subtasks(
                connection,
                task,
                expected_revision,
                reminder_claim_state_update,
            )
        })
    }

    fn save_completion(
        &self,
        completion: &TaskCompletion,
        expected_revision: i64,
    ) -> Result<(), AppError> {
        self.with_connection(|connection| {
            save_task_completion(connection, completion, expected_revision)
        })
    }

    fn get(&self, id: Uuid) -> Result<Option<Task>, AppError> {
        self.with_connection(|connection| get_task(connection, id))
    }

    fn list_inbox(&self) -> Result<Vec<Task>, AppError> {
        self.with_connection(|connection| list_inbox_tasks(connection))
    }

    fn list_tasks(&self, view: &TaskView) -> Result<Vec<TaskSummaryDto>, AppError> {
        self.with_connection(|connection| list_task_summaries(connection, view))
    }

    fn list_due_reminder_candidates(
        &self,
        now: DateTime<Utc>,
        expired_before: DateTime<Utc>,
    ) -> Result<Vec<Task>, AppError> {
        self.with_connection(|connection| {
            list_due_reminder_candidates(connection, now, expired_before)
        })
    }

    fn claim_reminder(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        claimed_at: DateTime<Utc>,
        expired_before: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.with_connection(|connection| {
            claim_reminder(
                connection,
                task_id,
                scheduled_at,
                claimed_at,
                expired_before,
                claim_token,
            )
        })
    }

    fn mark_reminder_delivered(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        delivered_at: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.with_connection(|connection| {
            mark_reminder_delivered(connection, task_id, scheduled_at, delivered_at, claim_token)
        })
    }

    fn release_reminder_claim(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.with_connection(|connection| {
            release_reminder_claim(connection, task_id, scheduled_at, claim_token)
        })
    }
}

impl TaskEditorRepository for SqliteTaskRepository {
    fn create_editor(&self, task: &Task, tag_names: &[String]) -> Result<(), AppError> {
        self.with_connection(|connection| create_task_editor(connection, task, tag_names))
    }

    fn update_editor(
        &self,
        task: &Task,
        expected_revision: i64,
        reminder_claim_state_update: ReminderClaimStateUpdate,
        tag_names: Option<&[String]>,
    ) -> Result<(), AppError> {
        self.with_connection(|connection| {
            update_task_editor(
                connection,
                task,
                expected_revision,
                reminder_claim_state_update,
                tag_names,
            )
        })
    }

    fn get_editor(&self, id: Uuid) -> Result<Option<TaskEditor>, AppError> {
        self.with_connection(|connection| get_task_editor(connection, id))
    }
}

impl SubtaskRepository for SqliteTaskRepository {
    fn insert_subtask(
        &self,
        parent_snapshot: &Task,
        subtask: &Task,
    ) -> Result<SubtaskInsertOutcome, AppError> {
        self.with_connection(|connection| {
            insert_subtask_from_parent_snapshot(connection, parent_snapshot, subtask)
        })
    }
}

impl ProjectRepository for SqliteTaskRepository {
    fn insert_project(&self, project: &Project) -> Result<(), AppError> {
        self.with_connection(|connection| insert_project(connection, project))
    }

    fn get_project(&self, id: Uuid) -> Result<Option<Project>, AppError> {
        self.with_connection(|connection| get_project(connection, id))
    }

    fn update_project(&self, project: &Project) -> Result<(), AppError> {
        self.with_connection(|connection| update_project(connection, project))
    }

    fn list_active_projects(&self) -> Result<Vec<Project>, AppError> {
        self.with_connection(|connection| list_active_projects(connection))
    }
}

fn insert_project(connection: &Connection, project: &Project) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO todo_projects (id, name, archived_at, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                project.id.to_string(),
                project.name,
                project.archived_at.map(|value| value.to_rfc3339()),
                project.created_at.to_rfc3339(),
                project.updated_at.to_rfc3339(),
            ],
        )
        .map_err(project_storage_error)?;

    Ok(())
}

fn get_project(connection: &Connection, id: Uuid) -> Result<Option<Project>, AppError> {
    connection
        .query_row(
            "SELECT id, name, archived_at, created_at, updated_at \
             FROM todo_projects WHERE id = ?1",
            params![id.to_string()],
            project_from_row,
        )
        .optional()
        .map_err(storage_error)
}

fn update_project(connection: &Connection, project: &Project) -> Result<(), AppError> {
    connection
        .execute(
            "UPDATE todo_projects SET name = ?1, archived_at = ?2, updated_at = ?3 WHERE id = ?4",
            params![
                project.name,
                project.archived_at.map(|value| value.to_rfc3339()),
                project.updated_at.to_rfc3339(),
                project.id.to_string(),
            ],
        )
        .map_err(project_storage_error)?;

    Ok(())
}

fn list_active_projects(connection: &Connection) -> Result<Vec<Project>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, archived_at, created_at, updated_at FROM todo_projects \
             WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE ASC, created_at ASC",
        )
        .map_err(storage_error)?;
    let projects = statement
        .query_map(params![], project_from_row)
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    Ok(projects)
}

pub(crate) fn run_migrations(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(storage_error)?;

    let result = (|| {
        let metadata_exists = connection
            .query_row(
                "SELECT EXISTS(\
                 SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2\
                 )",
                params!["table", "schema_migrations"],
                |row| row.get::<_, bool>(0),
            )
            .map_err(storage_error)?;

        if !metadata_exists {
            apply_migration(connection, 1, INITIAL_MIGRATION)?;
        }

        for (version, migration) in MIGRATIONS {
            let migration_applied = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
                    params![version],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(storage_error)?;

            if !migration_applied {
                apply_migration(connection, *version, migration)?;
            }
        }

        connection.execute_batch("COMMIT").map_err(storage_error)
    })();

    if result.is_err() {
        let _ = connection.execute_batch("ROLLBACK");
    }

    result
}

fn apply_migration(connection: &Connection, version: i64, migration: &str) -> Result<(), AppError> {
    connection.execute_batch(migration).map_err(storage_error)?;
    connection
        .execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![version, Utc::now().to_rfc3339()],
        )
        .map_err(storage_error)?;

    Ok(())
}

fn insert_task(connection: &Connection, task: &Task) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO todo_tasks (\
             id, title, note, project_id, parent_id, priority, scheduled_at, due_at, \
             completed_at, recurrence_json, reminder_sent_at, recurrence_instance, monthly_anchor_day, \
             created_at, updated_at, revision\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                task.id.to_string(),
                task.title,
                task.note,
                task.project_id.map(|value| value.to_string()),
                task.parent_id.map(|value| value.to_string()),
                priority_to_database(&task.priority),
                task.scheduled_at.map(|value| value.to_rfc3339()),
                task.due_at.map(|value| value.to_rfc3339()),
                task.completed_at.map(|value| value.to_rfc3339()),
                recurrence_to_database(task.recurrence.as_ref())?,
                task.reminder_sent_at.map(|value| value.to_rfc3339()),
                task.instance_number,
                task.monthly_anchor_day,
                task.created_at.to_rfc3339(),
                task.updated_at.to_rfc3339(),
                task.revision,
            ],
        )
        .map_err(storage_error)?;

    Ok(())
}

fn insert_subtask_from_parent_snapshot(
    connection: &mut Connection,
    parent_snapshot: &Task,
    subtask: &Task,
) -> Result<SubtaskInsertOutcome, AppError> {
    let transaction = connection.transaction().map_err(storage_error)?;
    let inserted_rows = transaction
        .execute(
            "INSERT INTO todo_tasks (\
             id, title, note, project_id, parent_id, priority, scheduled_at, due_at, \
             completed_at, recurrence_json, reminder_sent_at, recurrence_instance, monthly_anchor_day, \
             created_at, updated_at, revision\
             ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16 \
             FROM todo_tasks parent WHERE parent.id = ?17 AND parent.parent_id IS NULL \
             AND parent.revision = ?18 AND parent.project_id IS ?19",
            params![
                subtask.id.to_string(),
                subtask.title,
                subtask.note,
                subtask.project_id.map(|value| value.to_string()),
                subtask.parent_id.map(|value| value.to_string()),
                priority_to_database(&subtask.priority),
                subtask.scheduled_at.map(|value| value.to_rfc3339()),
                subtask.due_at.map(|value| value.to_rfc3339()),
                subtask.completed_at.map(|value| value.to_rfc3339()),
                recurrence_to_database(subtask.recurrence.as_ref())?,
                subtask.reminder_sent_at.map(|value| value.to_rfc3339()),
                subtask.instance_number,
                subtask.monthly_anchor_day,
                subtask.created_at.to_rfc3339(),
                subtask.updated_at.to_rfc3339(),
                subtask.revision,
                parent_snapshot.id.to_string(),
                parent_snapshot.revision,
                parent_snapshot.project_id.map(|value| value.to_string()),
            ],
        )
        .map_err(storage_error)?;
    if inserted_rows == 1 {
        transaction.commit().map_err(storage_error)?;

        return Ok(SubtaskInsertOutcome::Inserted);
    }

    let outcome = match get_task(&transaction, parent_snapshot.id)? {
        None => SubtaskInsertOutcome::ParentMissing,
        Some(parent) if parent.parent_id.is_some() => SubtaskInsertOutcome::ParentNested,
        Some(parent)
            if parent.revision != parent_snapshot.revision
                || parent.project_id != parent_snapshot.project_id =>
        {
            SubtaskInsertOutcome::ParentChanged
        }
        Some(_) => {
            return Err(storage_error(
                "subtask parent snapshot insert unexpectedly skipped",
            ))
        }
    };
    transaction.commit().map_err(storage_error)?;

    Ok(outcome)
}

fn create_task_editor(
    connection: &mut Connection,
    task: &Task,
    tag_names: &[String],
) -> Result<(), AppError> {
    let transaction = connection.transaction().map_err(storage_error)?;
    insert_task(&transaction, task)?;
    replace_task_tags(&transaction, task.id, tag_names)?;
    transaction.commit().map_err(storage_error)
}

fn update_task_editor(
    connection: &mut Connection,
    task: &Task,
    expected_revision: i64,
    reminder_claim_state_update: ReminderClaimStateUpdate,
    tag_names: Option<&[String]>,
) -> Result<(), AppError> {
    let transaction = connection.transaction().map_err(storage_error)?;
    update_task_and_direct_subtasks_in_transaction(
        &transaction,
        task,
        expected_revision,
        reminder_claim_state_update,
    )?;
    if let Some(tag_names) = tag_names {
        replace_task_tags(&transaction, task.id, tag_names)?;
    }
    transaction.commit().map_err(storage_error)
}

fn replace_task_tags(
    connection: &Connection,
    task_id: Uuid,
    tag_names: &[String],
) -> Result<(), AppError> {
    connection
        .execute(
            "DELETE FROM todo_task_tags WHERE task_id = ?1",
            params![task_id.to_string()],
        )
        .map_err(storage_error)?;
    for tag_name in tag_names {
        let tag_id = Uuid::new_v4();
        let now = Utc::now().to_rfc3339();
        connection
            .execute(
                "INSERT INTO todo_tags (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4) \
                 ON CONFLICT(name) DO NOTHING",
                params![tag_id.to_string(), tag_name, now, now],
            )
            .map_err(storage_error)?;
        let tag_id: String = connection
            .query_row(
                "SELECT id FROM todo_tags WHERE name = ?1",
                params![tag_name],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        connection
            .execute(
                "INSERT INTO todo_task_tags (task_id, tag_id) VALUES (?1, ?2)",
                params![task_id.to_string(), tag_id],
            )
            .map_err(storage_error)?;
    }

    Ok(())
}

fn get_task_editor(connection: &Connection, id: Uuid) -> Result<Option<TaskEditor>, AppError> {
    let Some(task) = get_task(connection, id)? else {
        return Ok(None);
    };
    let tag_names = load_task_tag_names(connection, id)?;
    let subtasks = list_direct_subtasks(connection, id)?;

    Ok(Some(TaskEditor {
        task,
        tag_names,
        subtasks,
    }))
}

fn load_task_tag_names(connection: &Connection, task_id: Uuid) -> Result<Vec<String>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT tag.name FROM todo_task_tags task_tag \
             JOIN todo_tags tag ON tag.id = task_tag.tag_id \
             WHERE task_tag.task_id = ?1 ORDER BY tag.name ASC",
        )
        .map_err(storage_error)?;

    let tag_names = statement
        .query_map(params![task_id.to_string()], |row| row.get::<_, String>(0))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    Ok(tag_names)
}

fn list_direct_subtasks(connection: &Connection, parent_id: Uuid) -> Result<Vec<Task>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, note, project_id, parent_id, priority, scheduled_at, due_at, \
             completed_at, recurrence_json, reminder_sent_at, recurrence_instance, monthly_anchor_day, \
             created_at, updated_at, revision FROM todo_tasks \
             WHERE parent_id = ?1 ORDER BY created_at ASC, id ASC",
        )
        .map_err(storage_error)?;

    let subtasks = statement
        .query_map(params![parent_id.to_string()], task_from_row)
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    Ok(subtasks)
}

fn get_task(connection: &Connection, id: Uuid) -> Result<Option<Task>, AppError> {
    connection
        .query_row(
            "SELECT id, title, note, project_id, parent_id, priority, scheduled_at, due_at, \
             completed_at, recurrence_json, reminder_sent_at, recurrence_instance, monthly_anchor_day, \
             created_at, updated_at, revision \
             FROM todo_tasks WHERE id = ?1",
            params![id.to_string()],
            task_from_row,
        )
        .optional()
        .map_err(storage_error)
}

fn update_task(
    connection: &Connection,
    task: &Task,
    expected_revision: i64,
    reminder_claim_state_update: ReminderClaimStateUpdate,
) -> Result<(), AppError> {
    let (clear_reminder_claim_state, clear_if_stored_schedule_differs) =
        match reminder_claim_state_update {
            ReminderClaimStateUpdate::Preserve => (false, false),
            ReminderClaimStateUpdate::Clear => (true, false),
            ReminderClaimStateUpdate::ClearIfStoredScheduleDiffers => (false, true),
        };

    let updated_rows = connection
        .execute(
            "UPDATE todo_tasks SET \
             title = ?1, note = ?2, project_id = ?3, parent_id = ?4, priority = ?5, \
              scheduled_at = ?6, due_at = ?7, completed_at = ?8, recurrence_json = ?9, \
              reminder_sent_at = CASE WHEN ?10 OR (?11 AND scheduled_at IS NOT ?6) THEN NULL ELSE reminder_sent_at END, \
              reminder_claimed_at = CASE WHEN ?10 OR (?11 AND scheduled_at IS NOT ?6) THEN NULL ELSE reminder_claimed_at END, \
              reminder_claim_token = CASE WHEN ?10 OR (?11 AND scheduled_at IS NOT ?6) THEN NULL ELSE reminder_claim_token END, \
              recurrence_instance = ?12, monthly_anchor_day = ?13, created_at = ?14, \
              updated_at = ?15, revision = ?16 WHERE id = ?17 AND revision = ?18",
            params![
                task.title,
                task.note,
                task.project_id.map(|value| value.to_string()),
                task.parent_id.map(|value| value.to_string()),
                priority_to_database(&task.priority),
                task.scheduled_at.map(|value| value.to_rfc3339()),
                task.due_at.map(|value| value.to_rfc3339()),
                task.completed_at.map(|value| value.to_rfc3339()),
                recurrence_to_database(task.recurrence.as_ref())?,
                clear_reminder_claim_state,
                clear_if_stored_schedule_differs,
                task.instance_number,
                task.monthly_anchor_day,
                task.created_at.to_rfc3339(),
                task.updated_at.to_rfc3339(),
                task.revision,
                task.id.to_string(),
                expected_revision,
            ],
        )
        .map_err(storage_error)?;
    if updated_rows == 0 {
        return Err(concurrent_task_update_error());
    }

    Ok(())
}

fn update_task_and_direct_subtasks(
    connection: &mut Connection,
    task: &Task,
    expected_revision: i64,
    reminder_claim_state_update: ReminderClaimStateUpdate,
) -> Result<(), AppError> {
    let transaction = connection.transaction().map_err(storage_error)?;
    update_task_and_direct_subtasks_in_transaction(
        &transaction,
        task,
        expected_revision,
        reminder_claim_state_update,
    )?;
    transaction.commit().map_err(storage_error)
}

fn update_task_and_direct_subtasks_in_transaction(
    connection: &Connection,
    task: &Task,
    expected_revision: i64,
    reminder_claim_state_update: ReminderClaimStateUpdate,
) -> Result<(), AppError> {
    update_task(
        connection,
        task,
        expected_revision,
        reminder_claim_state_update,
    )?;
    update_direct_subtask_projects(connection, task)
}

fn update_direct_subtask_projects(connection: &Connection, parent: &Task) -> Result<(), AppError> {
    for mut subtask in list_direct_subtasks(connection, parent.id)? {
        if subtask.project_id == parent.project_id {
            continue;
        }

        let expected_revision = subtask.revision;
        subtask.project_id = parent.project_id;
        subtask.updated_at = parent.updated_at;
        subtask.increment_revision()?;
        let updated_rows = connection
            .execute(
                "UPDATE todo_tasks SET project_id = ?1, updated_at = ?2, revision = ?3 \
                 WHERE id = ?4 AND revision = ?5",
                params![
                    subtask.project_id.map(|value| value.to_string()),
                    subtask.updated_at.to_rfc3339(),
                    subtask.revision,
                    subtask.id.to_string(),
                    expected_revision,
                ],
            )
            .map_err(storage_error)?;
        if updated_rows == 0 {
            return Err(concurrent_task_update_error());
        }
    }

    Ok(())
}

fn save_task_completion(
    connection: &mut Connection,
    completion: &TaskCompletion,
    expected_revision: i64,
) -> Result<(), AppError> {
    let transaction = connection.transaction().map_err(storage_error)?;
    let completed_rows = transaction
        .execute(
            "UPDATE todo_tasks SET completed_at = ?1, updated_at = ?2, revision = ?3 \
             WHERE id = ?4 AND completed_at IS NULL AND revision = ?5",
            params![
                completion
                    .completed_task
                    .completed_at
                    .map(|value| value.to_rfc3339()),
                completion.completed_task.updated_at.to_rfc3339(),
                completion.completed_task.revision,
                completion.completed_task.id.to_string(),
                expected_revision,
            ],
        )
        .map_err(storage_error)?;
    if completed_rows == 0 {
        let stored_completed_at = transaction
            .query_row(
                "SELECT completed_at FROM todo_tasks WHERE id = ?1",
                params![completion.completed_task.id.to_string()],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(storage_error)?;

        return match stored_completed_at {
            Some(Some(_)) => Err(AppError::new(
                "task.already_completed",
                "errors.task.already_completed",
                AppErrorKind::Conflict,
            )),
            _ => Err(concurrent_task_update_error()),
        };
    }
    if let Some(next_task) = completion.next_task.as_ref() {
        insert_task(&transaction, next_task)?;
    }

    transaction.commit().map_err(storage_error)?;

    Ok(())
}

fn concurrent_task_update_error() -> AppError {
    AppError::new(
        "task.concurrent_update",
        "errors.task.concurrent_update",
        AppErrorKind::Conflict,
    )
}

fn list_inbox_tasks(connection: &Connection) -> Result<Vec<Task>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, note, project_id, parent_id, priority, scheduled_at, due_at, \
             completed_at, recurrence_json, reminder_sent_at, recurrence_instance, monthly_anchor_day, \
             created_at, updated_at, revision FROM todo_tasks \
             WHERE completed_at IS NULL ORDER BY scheduled_at ASC, created_at ASC",
        )
        .map_err(storage_error)?;
    let tasks = statement
        .query_map(params![], task_from_row)
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    Ok(tasks)
}

fn list_due_reminder_candidates(
    connection: &Connection,
    now: DateTime<Utc>,
    expired_before: DateTime<Utc>,
) -> Result<Vec<Task>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, note, project_id, parent_id, priority, scheduled_at, due_at, \
             completed_at, recurrence_json, reminder_sent_at, recurrence_instance, monthly_anchor_day, \
             created_at, updated_at, revision FROM todo_tasks \
             WHERE scheduled_at IS NOT NULL AND scheduled_at <= ?1 AND completed_at IS NULL \
             AND reminder_sent_at IS NULL \
             AND (reminder_claimed_at IS NULL OR reminder_claimed_at <= ?2) \
             ORDER BY scheduled_at ASC, created_at ASC",
        )
        .map_err(storage_error)?;
    let tasks = statement
        .query_map(
            params![now.to_rfc3339(), expired_before.to_rfc3339()],
            task_from_row,
        )
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    Ok(tasks)
}

fn claim_reminder(
    connection: &Connection,
    task_id: Uuid,
    scheduled_at: DateTime<Utc>,
    claimed_at: DateTime<Utc>,
    expired_before: DateTime<Utc>,
    claim_token: Uuid,
) -> Result<bool, AppError> {
    let changed_rows = connection
        .execute(
            "UPDATE todo_tasks SET reminder_claimed_at = ?1, reminder_claim_token = ?2 \
             WHERE id = ?3 AND scheduled_at = ?4 AND completed_at IS NULL \
             AND reminder_sent_at IS NULL \
             AND (reminder_claimed_at IS NULL OR reminder_claimed_at <= ?5)",
            params![
                claimed_at.to_rfc3339(),
                claim_token.to_string(),
                task_id.to_string(),
                scheduled_at.to_rfc3339(),
                expired_before.to_rfc3339(),
            ],
        )
        .map_err(storage_error)?;

    Ok(changed_rows == 1)
}

fn mark_reminder_delivered(
    connection: &Connection,
    task_id: Uuid,
    scheduled_at: DateTime<Utc>,
    delivered_at: DateTime<Utc>,
    claim_token: Uuid,
) -> Result<bool, AppError> {
    let changed_rows = connection
        .execute(
            "UPDATE todo_tasks SET reminder_sent_at = ?1, reminder_claimed_at = NULL, \
             reminder_claim_token = NULL WHERE id = ?2 AND scheduled_at = ?3 \
             AND completed_at IS NULL AND reminder_sent_at IS NULL \
             AND reminder_claim_token = ?4",
            params![
                delivered_at.to_rfc3339(),
                task_id.to_string(),
                scheduled_at.to_rfc3339(),
                claim_token.to_string(),
            ],
        )
        .map_err(storage_error)?;

    Ok(changed_rows == 1)
}

fn release_reminder_claim(
    connection: &Connection,
    task_id: Uuid,
    scheduled_at: DateTime<Utc>,
    claim_token: Uuid,
) -> Result<bool, AppError> {
    let changed_rows = connection
        .execute(
            "UPDATE todo_tasks SET reminder_claimed_at = NULL, reminder_claim_token = NULL \
             WHERE id = ?1 AND scheduled_at = ?2 AND reminder_sent_at IS NULL \
             AND reminder_claim_token = ?3",
            params![
                task_id.to_string(),
                scheduled_at.to_rfc3339(),
                claim_token.to_string(),
            ],
        )
        .map_err(storage_error)?;

    Ok(changed_rows == 1)
}

fn list_task_summaries(
    connection: &Connection,
    view: &TaskView,
) -> Result<Vec<TaskSummaryDto>, AppError> {
    const TASK_SUMMARY_SELECT: &str = "SELECT t.id, t.title, p.name, t.priority, \
        t.scheduled_at, t.due_at, t.completed_at IS NOT NULL, \
        (SELECT COUNT(*) FROM todo_tasks child WHERE child.parent_id = t.id), \
        (SELECT COUNT(*) FROM todo_tasks child \
         WHERE child.parent_id = t.id AND child.completed_at IS NOT NULL) \
        FROM todo_tasks t \
        LEFT JOIN todo_projects p ON p.id = t.project_id";

    let summaries = match view {
        TaskView::Inbox => query_task_summaries(
            connection,
            &format!(
                "{TASK_SUMMARY_SELECT} WHERE t.parent_id IS NULL AND t.completed_at IS NULL \
                 ORDER BY t.scheduled_at ASC, t.created_at ASC"
            ),
            params![],
        )?,
        TaskView::Today { day } => query_task_summaries(
            connection,
            &format!(
                "{TASK_SUMMARY_SELECT} WHERE t.parent_id IS NULL AND t.completed_at IS NULL \
                 AND t.scheduled_at IS NOT NULL AND date(t.scheduled_at, 'localtime') <= ?1 \
                 ORDER BY t.scheduled_at ASC, t.created_at ASC"
            ),
            params![day.to_string()],
        )?,
        TaskView::Upcoming { day } => query_task_summaries(
            connection,
            &format!(
                "{TASK_SUMMARY_SELECT} WHERE t.parent_id IS NULL AND t.completed_at IS NULL \
                 AND t.scheduled_at IS NOT NULL AND date(t.scheduled_at, 'localtime') > ?1 \
                 ORDER BY t.scheduled_at ASC, t.created_at ASC"
            ),
            params![day.to_string()],
        )?,
        TaskView::Completed => query_task_summaries(
            connection,
            &format!(
                "{TASK_SUMMARY_SELECT} WHERE t.parent_id IS NULL AND t.completed_at IS NOT NULL \
                 ORDER BY t.completed_at DESC, t.created_at ASC"
            ),
            params![],
        )?,
        TaskView::Project(project_id) => query_task_summaries(
            connection,
            &format!(
                "{TASK_SUMMARY_SELECT} WHERE t.parent_id IS NULL AND t.completed_at IS NULL \
                 AND t.project_id = ?1 ORDER BY t.scheduled_at ASC, t.created_at ASC"
            ),
            params![project_id.to_string()],
        )?,
        TaskView::Search(text) => query_task_summaries(
            connection,
            &format!(
                "{TASK_SUMMARY_SELECT} JOIN todo_task_search ON todo_task_search.rowid = t.rowid \
                 WHERE t.parent_id IS NULL AND todo_task_search MATCH ?1 \
                 ORDER BY t.scheduled_at ASC, t.created_at ASC"
            ),
            params![fts_phrase_query(text)],
        )?,
        TaskView::Calendar { start, end } => query_task_summaries(
            connection,
            &format!(
                "{TASK_SUMMARY_SELECT} WHERE t.parent_id IS NULL \
                 AND t.scheduled_at IS NOT NULL \
                 AND date(t.scheduled_at, 'localtime') >= ?1 \
                 AND date(t.scheduled_at, 'localtime') < ?2 \
                 ORDER BY t.scheduled_at ASC, t.created_at ASC"
            ),
            params![start.to_string(), end.to_string()],
        )?,
    };

    summaries
        .into_iter()
        .map(|summary| load_tags(connection, summary))
        .collect()
}

fn query_task_summaries<P>(
    connection: &Connection,
    query: &str,
    parameters: P,
) -> Result<Vec<TaskSummaryDto>, AppError>
where
    P: Params,
{
    let mut statement = connection.prepare(query).map_err(storage_error)?;
    let summaries = statement
        .query_map(parameters, task_summary_from_row)
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    Ok(summaries)
}

fn fts_phrase_query(text: &str) -> String {
    text.split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn task_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskSummaryDto> {
    let scheduled_at = row
        .get::<_, Option<String>>(4)?
        .map(parse_datetime)
        .transpose()?;
    let due_at = row
        .get::<_, Option<String>>(5)?
        .map(parse_datetime)
        .transpose()?;

    Ok(TaskSummaryDto {
        id: row.get(0)?,
        title: row.get(1)?,
        project_name: row.get(2)?,
        tags: Vec::new(),
        priority: parse_priority(row.get(3)?)?,
        scheduled_at,
        due_at,
        completed: row.get(6)?,
        child_total: row.get(7)?,
        child_completed: row.get(8)?,
    })
}

fn load_tags(
    connection: &Connection,
    mut summary: TaskSummaryDto,
) -> Result<TaskSummaryDto, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT tag.name FROM todo_task_tags task_tag \
             JOIN todo_tags tag ON tag.id = task_tag.tag_id \
             WHERE task_tag.task_id = ?1 ORDER BY tag.name ASC",
        )
        .map_err(storage_error)?;
    let tags = statement
        .query_map(params![summary.id], |row| row.get::<_, String>(0))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    summary.tags = tags;

    Ok(summary)
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let id = parse_uuid(row.get(0)?)?;
    let project_id = row
        .get::<_, Option<String>>(3)?
        .map(parse_uuid)
        .transpose()?;
    let parent_id = row
        .get::<_, Option<String>>(4)?
        .map(parse_uuid)
        .transpose()?;
    let priority = parse_priority(row.get(5)?)?;
    let scheduled_at = row
        .get::<_, Option<String>>(6)?
        .map(parse_datetime)
        .transpose()?;
    let due_at = row
        .get::<_, Option<String>>(7)?
        .map(parse_datetime)
        .transpose()?;
    let completed_at = row
        .get::<_, Option<String>>(8)?
        .map(parse_datetime)
        .transpose()?;
    let recurrence = row
        .get::<_, Option<String>>(9)?
        .map(|value| serde_json::from_str(&value).map_err(to_sql_error))
        .transpose()?;
    let reminder_sent_at = row
        .get::<_, Option<String>>(10)?
        .map(parse_datetime)
        .transpose()?;
    let instance_number = row.get(11)?;
    let monthly_anchor_day = row.get(12)?;
    let created_at = parse_datetime(row.get(13)?)?;
    let updated_at = parse_datetime(row.get(14)?)?;
    let revision = row.get(15)?;

    Ok(Task {
        id,
        title: row.get(1)?,
        note: row.get(2)?,
        project_id,
        parent_id,
        priority,
        scheduled_at,
        due_at,
        completed_at,
        reminder_sent_at,
        recurrence,
        instance_number,
        monthly_anchor_day,
        created_at,
        updated_at,
        revision,
    })
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    let archived_at = row
        .get::<_, Option<String>>(2)?
        .map(parse_datetime)
        .transpose()?;

    Ok(Project {
        id: parse_uuid(row.get(0)?)?,
        name: row.get(1)?,
        archived_at,
        created_at: parse_datetime(row.get(3)?)?,
        updated_at: parse_datetime(row.get(4)?)?,
    })
}

fn priority_to_database(priority: &Priority) -> &'static str {
    match priority {
        Priority::Low => "low",
        Priority::Normal => "normal",
        Priority::High => "high",
    }
}

fn recurrence_to_database(recurrence: Option<&RecurrenceRule>) -> Result<Option<String>, AppError> {
    recurrence
        .map(serde_json::to_string)
        .transpose()
        .map_err(storage_error)
}

fn parse_uuid(value: String) -> rusqlite::Result<Uuid> {
    Uuid::parse_str(&value).map_err(to_sql_error)
}

fn parse_priority(value: String) -> rusqlite::Result<Priority> {
    match value.as_str() {
        "low" => Ok(Priority::Low),
        "normal" => Ok(Priority::Normal),
        "high" => Ok(Priority::High),
        _ => Err(to_sql_error(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid priority",
        ))),
    }
}

fn parse_datetime(value: String) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&value)
        .map(|date_time| date_time.with_timezone(&Utc))
        .map_err(to_sql_error)
}

fn to_sql_error(error: impl std::error::Error + Send + Sync + 'static) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn storage_error(_error: impl std::fmt::Debug) -> AppError {
    AppError::new(STORAGE_ERROR_CODE, STORAGE_ERROR_KEY, AppErrorKind::Storage)
}

fn project_storage_error(error: rusqlite::Error) -> AppError {
    if matches!(
        error,
        rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: rusqlite::ErrorCode::ConstraintViolation,
                ..
            },
            _
        )
    ) {
        return AppError::new(
            "project.name.duplicate",
            "errors.project.name.duplicate",
            AppErrorKind::Conflict,
        );
    }

    storage_error(error)
}
