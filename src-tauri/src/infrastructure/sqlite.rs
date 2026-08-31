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
        ports::{ProjectRepository, TaskRepository},
        project::Project,
        task::{Priority, RecurrenceRule, Task},
        task_query::{TaskSummaryDto, TaskView},
    },
    error::{AppError, AppErrorKind},
};

const INITIAL_MIGRATION: &str = include_str!("../../migrations/0001_initial.sql");
const DAILY_WORKFLOW_MIGRATION: &str = include_str!("../../migrations/0002_daily_workflow.sql");
const TASK_SEARCH_MIGRATION: &str = include_str!("../../migrations/0003_task_search.sql");
const PROJECT_MANAGEMENT_MIGRATION: &str =
    include_str!("../../migrations/0004_project_management.sql");
const MIGRATIONS: &[(i64, &str)] = &[
    (1, INITIAL_MIGRATION),
    (2, DAILY_WORKFLOW_MIGRATION),
    (3, TASK_SEARCH_MIGRATION),
    (4, PROJECT_MANAGEMENT_MIGRATION),
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
        operation: impl FnOnce(&Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let connection = self.connection.lock().map_err(|_| storage_error(()))?;

        operation(&connection)
    }
}

impl TaskRepository for SqliteTaskRepository {
    fn insert(&self, task: &Task) -> Result<(), AppError> {
        self.with_connection(|connection| insert_task(connection, task))
    }

    fn update(&self, task: &Task) -> Result<(), AppError> {
        self.with_connection(|connection| update_task(connection, task))
    }

    fn get(&self, id: Uuid) -> Result<Option<Task>, AppError> {
        self.with_connection(|connection| get_task(connection, id))
    }

    fn list_inbox(&self) -> Result<Vec<Task>, AppError> {
        self.with_connection(list_inbox_tasks)
    }

    fn list_tasks(&self, view: &TaskView) -> Result<Vec<TaskSummaryDto>, AppError> {
        self.with_connection(|connection| list_task_summaries(connection, view))
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
        self.with_connection(list_active_projects)
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
             created_at, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
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
            ],
        )
        .map_err(storage_error)?;

    Ok(())
}

fn get_task(connection: &Connection, id: Uuid) -> Result<Option<Task>, AppError> {
    connection
        .query_row(
            "SELECT id, title, note, project_id, parent_id, priority, scheduled_at, due_at, \
             completed_at, recurrence_json, reminder_sent_at, recurrence_instance, monthly_anchor_day, \
             created_at, updated_at \
             FROM todo_tasks WHERE id = ?1",
            params![id.to_string()],
            task_from_row,
        )
        .optional()
        .map_err(storage_error)
}

fn update_task(connection: &Connection, task: &Task) -> Result<(), AppError> {
    connection
        .execute(
            "UPDATE todo_tasks SET \
             title = ?1, note = ?2, project_id = ?3, parent_id = ?4, priority = ?5, \
             scheduled_at = ?6, due_at = ?7, completed_at = ?8, recurrence_json = ?9, \
             reminder_sent_at = ?10, recurrence_instance = ?11, monthly_anchor_day = ?12, \
             created_at = ?13, updated_at = ?14 WHERE id = ?15",
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
                task.reminder_sent_at.map(|value| value.to_rfc3339()),
                task.instance_number,
                task.monthly_anchor_day,
                task.created_at.to_rfc3339(),
                task.updated_at.to_rfc3339(),
                task.id.to_string(),
            ],
        )
        .map_err(storage_error)?;

    Ok(())
}

fn list_inbox_tasks(connection: &Connection) -> Result<Vec<Task>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, note, project_id, parent_id, priority, scheduled_at, due_at, \
             completed_at, recurrence_json, reminder_sent_at, recurrence_instance, monthly_anchor_day, \
             created_at, updated_at FROM todo_tasks \
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
