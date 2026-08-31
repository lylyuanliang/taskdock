use std::{
    path::{Path, PathBuf},
    sync::{Arc, Barrier},
    time::Duration,
};

use chrono::{TimeZone, Utc};
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::{
    domain::{
        ports::{ProjectRepository, TaskRepository},
        project::Project,
        recurrence::{Frequency, RecurrenceRule},
        task::{Priority, Task},
    },
    infrastructure::sqlite::{run_migrations, SqliteTaskRepository},
};

struct TemporaryDatabaseFile {
    path: PathBuf,
}

impl TemporaryDatabaseFile {
    fn unique() -> Self {
        let path = std::env::temp_dir().join(format!(
            "todo-app-migration-{}-{}.sqlite3",
            std::process::id(),
            Uuid::new_v4()
        ));

        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryDatabaseFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[test]
fn concurrent_file_connections_apply_migrations_once() -> Result<(), Box<dyn std::error::Error>> {
    let database_file = TemporaryDatabaseFile::unique();
    let first_connection = Connection::open(database_file.path())?;
    let second_connection = Connection::open(database_file.path())?;
    first_connection.busy_timeout(Duration::from_secs(5))?;
    second_connection.busy_timeout(Duration::from_secs(5))?;
    let start = Arc::new(Barrier::new(2));
    let first_start = Arc::clone(&start);
    let second_start = Arc::clone(&start);

    let first = std::thread::spawn(move || {
        first_start.wait();
        run_migrations(&first_connection)
    });
    let second = std::thread::spawn(move || {
        second_start.wait();
        run_migrations(&second_connection)
    });

    let first_result = first.join();
    let second_result = second.join();

    first_result
        .map_err(|_| std::io::Error::other("first migration thread panicked"))?
        .map_err(|error| {
            std::io::Error::other(format!("first connection migration failed: {error:?}"))
        })?;
    second_result
        .map_err(|_| std::io::Error::other("second migration thread panicked"))?
        .map_err(|error| {
            std::io::Error::other(format!("second connection migration failed: {error:?}"))
        })?;

    let verification_connection = Connection::open(database_file.path())?;
    let mut version_statement = verification_connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")?;
    let applied_versions = version_statement
        .query_map(params![], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let task_rows: i64 =
        verification_connection.query_row("SELECT COUNT(*) FROM todo_tasks", params![], |row| {
            row.get(0)
        })?;

    assert_eq!(applied_versions, vec![1, 2, 3, 4]);
    assert_eq!(task_rows, 0);

    Ok(())
}

#[test]
fn migrations_are_idempotent_on_the_same_connection() {
    let connection = Connection::open_in_memory().unwrap();

    run_migrations(&connection).unwrap();
    run_migrations(&connection).unwrap();

    let applied_versions: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
            params![2_i64],
            |row| row.get(0),
        )
        .unwrap();
    let task_rows: i64 = connection
        .query_row("SELECT COUNT(*) FROM todo_tasks", params![], |row| {
            row.get(0)
        })
        .unwrap();

    assert_eq!(applied_versions, 1);
    assert_eq!(task_rows, 0);
}

#[test]
fn task_search_migration_backfills_and_tracks_task_changes(
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = Connection::open_in_memory()?;
    connection.execute_batch(include_str!("../../migrations/0001_initial.sql"))?;
    connection.execute_batch(include_str!("../../migrations/0002_daily_workflow.sql"))?;
    connection.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2), (?3, ?4)",
        params![1_i64, "2026-08-26T00:00:00Z", 2_i64, "2026-08-26T00:01:00Z"],
    )?;
    let task_id = Uuid::new_v4().to_string();
    connection.execute(
        "INSERT INTO todo_tasks (id, title, note, priority, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            task_id,
            "Legacy launch plan",
            "Backfill this note",
            "normal",
            "2026-08-26T00:00:00Z",
            "2026-08-26T00:00:00Z",
        ],
    )?;

    run_migrations(&connection)?;

    let matches: i64 = connection.query_row(
        "SELECT COUNT(*) FROM todo_task_search WHERE todo_task_search MATCH ?1",
        params!["legacy"],
        |row| row.get(0),
    )?;
    assert_eq!(matches, 1);

    connection.execute(
        "UPDATE todo_tasks SET title = ?1, note = ?2 WHERE id = ?3",
        params!["Refined launch plan", "Updated replacement note", task_id],
    )?;
    assert_fts_match_count(&connection, "legacy", 0)?;
    assert_fts_match_count(&connection, "backfill", 0)?;
    assert_fts_match_count(&connection, "refined", 1)?;
    assert_fts_match_count(&connection, "updated", 1)?;

    connection.execute(
        "UPDATE todo_tasks SET note = ?1 WHERE id = ?2",
        params!["Second note content", task_id],
    )?;
    assert_fts_match_count(&connection, "updated", 0)?;
    assert_fts_match_count(&connection, "second", 1)?;
    assert_fts_match_count(&connection, "refined", 1)?;

    connection.execute("DELETE FROM todo_tasks WHERE id = ?1", params![task_id])?;
    assert_fts_match_count(&connection, "refined", 0)?;

    Ok(())
}

fn assert_fts_match_count(
    connection: &Connection,
    term: &str,
    expected_count: i64,
) -> Result<(), Box<dyn std::error::Error>> {
    let matches: i64 = connection.query_row(
        "SELECT COUNT(*) FROM todo_task_search WHERE todo_task_search MATCH ?1",
        params![term],
        |row| row.get(0),
    )?;
    assert_eq!(matches, expected_count, "unexpected FTS matches for {term}");

    Ok(())
}

#[test]
fn sqlite_repository_round_trips_a_task() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task = Task::for_test("Prepare release".into());

    repository.insert(&task).unwrap();

    assert_eq!(repository.get(task.id).unwrap(), Some(task));
}

#[test]
fn sqlite_projects_keep_archived_task_associations_and_reuse_archived_names() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let project = Project::new("Release".into()).unwrap();
    repository.insert_project(&project).unwrap();

    let mut task = Task::for_test("Publish notes".into());
    task.project_id = Some(project.id);
    repository.insert(&task).unwrap();

    let mut archived = project.clone();
    archived.archive();
    repository.update_project(&archived).unwrap();
    repository
        .insert_project(&Project::new("release".into()).unwrap())
        .unwrap();

    assert_eq!(
        repository.get(task.id).unwrap().unwrap().project_id,
        Some(project.id)
    );
    assert!(repository
        .list_active_projects()
        .unwrap()
        .iter()
        .all(|item| item.id != project.id));
}

#[test]
fn sqlite_repository_round_trips_all_persisted_task_fields() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let project_id = Uuid::new_v4();
    let mut parent = Task::for_test("Prepare release".into());
    parent.created_at = fixed_utc(2026, 8, 27, 9, 0, 0);
    parent.updated_at = fixed_utc(2026, 8, 27, 9, 0, 0);
    let mut task = Task::for_test("Publish release".into());
    task.note = "Publish the approved build".into();
    task.project_id = Some(project_id);
    task.parent_id = Some(parent.id);
    task.priority = Priority::High;
    task.scheduled_at = Some(fixed_utc(2026, 8, 28, 9, 30, 0));
    task.due_at = Some(fixed_utc(2026, 8, 29, 17, 0, 0));
    task.completed_at = Some(fixed_utc(2026, 8, 29, 17, 30, 0));
    task.recurrence = Some(RecurrenceRule::new(Frequency::Weekly, 1, None, None).unwrap());
    task.reminder_sent_at = Some(fixed_utc(2026, 8, 28, 9, 0, 0));
    task.instance_number = 3;
    task.monthly_anchor_day = Some(31);
    task.created_at = fixed_utc(2026, 8, 27, 10, 0, 0);
    task.updated_at = fixed_utc(2026, 8, 27, 10, 15, 0);

    repository.insert(&parent).unwrap();
    repository.insert(&task).unwrap();

    assert_eq!(repository.get(task.id).unwrap(), Some(task));
}

#[test]
fn migration_preserves_tasks_and_upgrades_legacy_recurrence_json(
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = Connection::open_in_memory()?;
    connection.execute_batch(include_str!("../../migrations/0001_initial.sql"))?;
    connection.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
        params![1_i64, "2026-08-26T00:00:00Z"],
    )?;
    let monthly_task_id = Uuid::new_v4();
    connection.execute(
        "INSERT INTO todo_tasks (\
         id, title, note, priority, scheduled_at, recurrence_json, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            monthly_task_id.to_string(),
            "Legacy monthly task",
            "keep this row too",
            "normal",
            "2026-01-31T09:00:00+00:00",
            "\"Monthly\"",
            "2026-01-01T00:00:00+00:00",
            "2026-01-01T00:00:00+00:00",
        ],
    )?;
    let task_id = Uuid::new_v4();
    connection.execute(
        "INSERT INTO todo_tasks (\
         id, title, note, priority, scheduled_at, recurrence_json, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            task_id.to_string(),
            "Legacy yearly task",
            "keep this row",
            "normal",
            "2026-01-31T09:00:00+00:00",
            "\"Yearly\"",
            "2026-01-01T00:00:00+00:00",
            "2026-01-01T00:00:00+00:00",
        ],
    )?;

    run_migrations(&connection)?;

    let row = connection.query_row(
        "SELECT title, note, recurrence_json, recurrence_instance, monthly_anchor_day \
         FROM todo_tasks WHERE id = ?1",
        params![task_id.to_string()],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, u32>(3)?,
                row.get::<_, Option<u8>>(4)?,
            ))
        },
    )?;

    assert_eq!(row.0, "Legacy yearly task");
    assert_eq!(row.1, "keep this row");
    assert_eq!(
        row.2,
        r#"{"frequency":"yearly","interval":1,"until":null,"count":null}"#
    );
    assert_eq!(row.3, 1);
    assert_eq!(row.4, Some(31));

    let monthly_anchor_day: Option<u8> = connection.query_row(
        "SELECT monthly_anchor_day FROM todo_tasks WHERE id = ?1",
        params![monthly_task_id.to_string()],
        |row| row.get(0),
    )?;

    assert_eq!(monthly_anchor_day, Some(31));

    Ok(())
}

#[test]
fn sqlite_repository_updates_a_task() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Prepare release".into());

    repository.insert(&task).unwrap();
    task.note = "Verify release checklist".into();
    task.reminder_sent_at = Some(fixed_utc(2026, 8, 27, 8, 45, 0));
    task.instance_number = 4;
    task.monthly_anchor_day = Some(30);
    repository.update(&task).unwrap();

    assert_eq!(repository.get(task.id).unwrap(), Some(task));
}

fn fixed_utc(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, hour, minute, second)
        .single()
        .unwrap()
}

#[test]
fn sqlite_repository_lists_only_incomplete_inbox_tasks() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut inbox_task = Task::for_test("Prepare release".into());
    inbox_task.scheduled_at = Some(fixed_utc(2026, 8, 28, 9, 0, 0));
    inbox_task.recurrence = Some(RecurrenceRule::new(Frequency::Monthly, 1, None, None).unwrap());
    inbox_task.reminder_sent_at = Some(fixed_utc(2026, 8, 28, 8, 45, 0));
    inbox_task.instance_number = 2;
    inbox_task.monthly_anchor_day = Some(31);
    let mut completed_task = Task::for_test("Archive release notes".into());
    completed_task.completed_at = Some(chrono::Utc::now());

    repository.insert(&inbox_task).unwrap();
    repository.insert(&completed_task).unwrap();

    assert_eq!(repository.list_inbox().unwrap(), vec![inbox_task]);
}
