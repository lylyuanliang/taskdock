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
        ports::{ProjectRepository, SubtaskInsertOutcome, SubtaskRepository, TaskRepository},
        project::Project,
        recurrence::{complete_task, Frequency, RecurrenceRule},
        task::{Priority, ReminderClaimStateUpdate, Task, TaskPatch},
        task_service::TaskService,
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

    assert_eq!(applied_versions, vec![1, 2, 3, 4, 5, 6, 7]);
    assert_eq!(task_rows, 0);

    Ok(())
}

#[test]
fn sqlite_reminder_claim_does_not_mark_delivery_and_only_reclaims_expired_leases() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let claimed_at = fixed_utc(2026, 9, 9, 9, 0, 0);
    let expired_at = fixed_utc(2026, 9, 9, 9, 3, 0);
    let mut task = Task::for_test("Lease state stays separate from delivery".into());
    task.scheduled_at = Some(claimed_at);
    repository.insert(&task).unwrap();

    assert!(repository
        .claim_reminder(
            task.id,
            claimed_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            Uuid::new_v4(),
        )
        .unwrap());
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        None
    );
    assert!(!repository
        .claim_reminder(
            task.id,
            claimed_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            Uuid::new_v4(),
        )
        .unwrap());
    assert!(repository
        .claim_reminder(
            task.id,
            claimed_at,
            expired_at,
            expired_at - chrono::Duration::minutes(2),
            Uuid::new_v4(),
        )
        .unwrap());
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
fn reminder_claim_token_migration_adds_a_unique_task_column(
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = Connection::open_in_memory()?;

    run_migrations(&connection)?;

    let columns = connection
        .prepare("PRAGMA table_info(todo_tasks)")?
        .query_map(params![], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    assert!(columns
        .iter()
        .any(|column| column == "reminder_claim_token"));

    let unique_indexes = connection
        .prepare("PRAGMA index_list(todo_tasks)")?
        .query_map(params![], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let claim_token_is_unique = unique_indexes
        .into_iter()
        .filter(|(_, is_unique)| *is_unique == 1)
        .map(|(index, _)| index)
        .any(|index| {
            connection
                .prepare(&format!("PRAGMA index_info({index})"))
                .and_then(|mut statement| {
                    statement
                        .query_map(params![], |row| row.get::<_, String>(2))?
                        .collect::<Result<Vec<_>, _>>()
                })
                .is_ok_and(|columns| columns == ["reminder_claim_token"])
        });

    assert!(claim_token_is_unique);

    Ok(())
}

#[test]
fn task_revision_migration_upgrades_version_five_without_losing_reminder_data(
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = Connection::open_in_memory()?;
    connection.execute_batch(include_str!("../../migrations/0001_initial.sql"))?;
    connection.execute_batch(include_str!("../../migrations/0002_daily_workflow.sql"))?;
    connection.execute_batch(include_str!("../../migrations/0003_task_search.sql"))?;
    connection.execute_batch(include_str!("../../migrations/0004_project_management.sql"))?;
    connection.execute_batch(include_str!(
        "../../migrations/0005_reminder_claim_token.sql"
    ))?;
    for version in 1_i64..=5 {
        connection.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![version, "2026-09-09T00:00:00Z"],
        )?;
    }
    let task_id = Uuid::new_v4();
    let claim_token = Uuid::new_v4();
    connection.execute(
        "INSERT INTO todo_tasks (\
         id, title, note, priority, scheduled_at, reminder_sent_at, reminder_claim_token, \
         created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            task_id.to_string(),
            "Legacy reminder task",
            "keep reminder state",
            "normal",
            "2026-09-09T09:00:00Z",
            "2026-09-09T08:55:00Z",
            claim_token.to_string(),
            "2026-09-09T08:00:00Z",
            "2026-09-09T08:30:00Z",
        ],
    )?;

    run_migrations(&connection)?;

    let row = connection.query_row(
        "SELECT title, note, scheduled_at, reminder_sent_at, reminder_claim_token, revision \
         FROM todo_tasks WHERE id = ?1",
        params![task_id.to_string()],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        },
    )?;
    let applied_versions = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")?
        .query_map(params![], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    assert_eq!(row.0, "Legacy reminder task");
    assert_eq!(row.1, "keep reminder state");
    assert_eq!(row.2, "2026-09-09T09:00:00Z");
    assert_eq!(row.3, "2026-09-09T08:55:00Z");
    assert_eq!(row.4, claim_token.to_string());
    assert_eq!(row.5, 1);
    assert_eq!(applied_versions, vec![1, 2, 3, 4, 5, 6, 7]);

    Ok(())
}

#[test]
fn reminder_delivery_lease_migration_upgrades_version_six_without_losing_delivery_data(
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = Connection::open_in_memory()?;
    connection.execute_batch(include_str!("../../migrations/0001_initial.sql"))?;
    connection.execute_batch(include_str!("../../migrations/0002_daily_workflow.sql"))?;
    connection.execute_batch(include_str!("../../migrations/0003_task_search.sql"))?;
    connection.execute_batch(include_str!("../../migrations/0004_project_management.sql"))?;
    connection.execute_batch(include_str!(
        "../../migrations/0005_reminder_claim_token.sql"
    ))?;
    connection.execute_batch(include_str!("../../migrations/0006_task_revision.sql"))?;
    for version in 1_i64..=6 {
        connection.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![version, "2026-09-09T00:00:00Z"],
        )?;
    }
    let task_id = Uuid::new_v4();
    let delivered_at = "2026-09-09T08:55:00Z";
    connection.execute(
        "INSERT INTO todo_tasks (\
         id, title, note, priority, scheduled_at, reminder_sent_at, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            task_id.to_string(),
            "Legacy delivered reminder",
            "keep delivered state",
            "normal",
            "2026-09-09T09:00:00Z",
            delivered_at,
            "2026-09-09T08:00:00Z",
            "2026-09-09T08:30:00Z",
        ],
    )?;

    run_migrations(&connection)?;

    let columns = connection
        .prepare("PRAGMA table_info(todo_tasks)")?
        .query_map(params![], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    assert!(columns.iter().any(|column| column == "reminder_claimed_at"));
    let row = connection.query_row(
        "SELECT reminder_sent_at, reminder_claimed_at FROM todo_tasks WHERE id = ?1",
        params![task_id.to_string()],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
    )?;
    let applied_versions = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")?
        .query_map(params![], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    assert_eq!(row.0, delivered_at);
    assert_eq!(row.1, None);
    assert_eq!(applied_versions, vec![1, 2, 3, 4, 5, 6, 7]);

    Ok(())
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
fn sqlite_subtask_insert_requires_the_loaded_top_level_parent_snapshot() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let missing_parent = Task::for_test("Missing parent".into());
    let mut missing_child = Task::for_test("Missing child".into());
    missing_child.parent_id = Some(missing_parent.id);
    assert_eq!(
        repository
            .insert_subtask(&missing_parent, &missing_child)
            .unwrap(),
        SubtaskInsertOutcome::ParentMissing
    );
    assert_eq!(repository.get(missing_child.id).unwrap(), None);

    let project = Project::new("Release".into()).unwrap();
    repository.insert_project(&project).unwrap();
    let mut parent = Task::for_test("Parent".into());
    parent.project_id = Some(project.id);
    repository.insert(&parent).unwrap();
    let stale_parent = parent.clone();
    let updated_parent = parent
        .apply_patch(crate::domain::task::TaskPatch {
            note: Some("Changed".into()),
            ..Default::default()
        })
        .unwrap();
    repository
        .update(
            &updated_parent,
            parent.revision,
            ReminderClaimStateUpdate::Preserve,
        )
        .unwrap();
    let mut stale_child = Task::for_test("Stale child".into());
    stale_child.parent_id = Some(stale_parent.id);
    stale_child.project_id = stale_parent.project_id;

    assert_eq!(
        repository
            .insert_subtask(&stale_parent, &stale_child)
            .unwrap(),
        SubtaskInsertOutcome::ParentChanged
    );
    assert_eq!(repository.get(stale_child.id).unwrap(), None);

    let current_parent = repository.get(parent.id).unwrap().unwrap();
    let grandparent = Task::for_test("Grandparent".into());
    repository.insert(&grandparent).unwrap();
    let nested_parent = current_parent
        .apply_patch(crate::domain::task::TaskPatch {
            parent_id: Some(Some(grandparent.id)),
            ..Default::default()
        })
        .unwrap();
    repository
        .update(
            &nested_parent,
            current_parent.revision,
            ReminderClaimStateUpdate::Preserve,
        )
        .unwrap();
    let mut nested_child = Task::for_test("Nested child".into());
    nested_child.parent_id = Some(current_parent.id);
    nested_child.project_id = current_parent.project_id;

    assert_eq!(
        repository
            .insert_subtask(&current_parent, &nested_child)
            .unwrap(),
        SubtaskInsertOutcome::ParentNested
    );
    assert_eq!(repository.get(nested_child.id).unwrap(), None);
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
    let expected_revision = task.revision;
    task.note = "Verify release checklist".into();
    task.instance_number = 4;
    task.monthly_anchor_day = Some(30);
    task.increment_revision().unwrap();
    repository
        .update(&task, expected_revision, ReminderClaimStateUpdate::Preserve)
        .unwrap();

    assert_eq!(repository.get(task.id).unwrap(), Some(task));
}

#[test]
fn sqlite_rejects_a_stale_patch_even_when_updated_at_has_the_same_value() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Prepare release".into());
    task.updated_at = fixed_utc(2026, 9, 9, 8, 30, 0);
    repository.insert(&task).unwrap();
    let mut first_patch = repository.get(task.id).unwrap().unwrap();
    let mut stale_patch = first_patch.clone();

    first_patch.note = "Current release checklist".into();
    let first_expected_revision = first_patch.revision;
    first_patch.increment_revision().unwrap();
    repository
        .update(
            &first_patch,
            first_expected_revision,
            ReminderClaimStateUpdate::Preserve,
        )
        .unwrap();
    stale_patch.note = "Stale release checklist".into();

    let error = repository
        .update(
            &stale_patch,
            stale_patch.revision,
            ReminderClaimStateUpdate::Preserve,
        )
        .unwrap_err();

    assert_eq!(error.code(), "task.concurrent_update");
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().note,
        "Current release checklist"
    );
}

#[test]
fn sqlite_rejects_a_stale_completion_even_when_updated_at_has_the_same_value() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Prepare release".into());
    task.updated_at = fixed_utc(2026, 9, 9, 8, 30, 0);
    repository.insert(&task).unwrap();
    let stale_task = repository.get(task.id).unwrap().unwrap();
    let mut first_patch = stale_task.clone();

    first_patch.note = "Current release checklist".into();
    let first_expected_revision = first_patch.revision;
    first_patch.increment_revision().unwrap();
    repository
        .update(
            &first_patch,
            first_expected_revision,
            ReminderClaimStateUpdate::Preserve,
        )
        .unwrap();
    let completion = complete_task(&stale_task, stale_task.updated_at).unwrap();

    let error = repository
        .save_completion(&completion, stale_task.revision)
        .unwrap_err();

    assert_eq!(error.code(), "task.concurrent_update");
    let persisted_task = repository.get(task.id).unwrap().unwrap();
    assert_eq!(persisted_task.completed_at, None);
    assert_eq!(persisted_task.note, "Current release checklist");
}

#[test]
fn sqlite_patch_accepts_a_loaded_legacy_z_updated_at_value(
) -> Result<(), Box<dyn std::error::Error>> {
    let database_file = TemporaryDatabaseFile::unique();
    let repository = SqliteTaskRepository::open(database_file.path())?;
    let task = Task::for_test("Prepare release".into());
    repository.insert(&task)?;
    let connection = Connection::open(database_file.path())?;
    connection.execute(
        "UPDATE todo_tasks SET updated_at = ?1 WHERE id = ?2",
        params!["2026-09-09T08:30:00Z", task.id.to_string()],
    )?;
    let mut loaded_task = repository.get(task.id)?.unwrap();
    loaded_task.note = "Legacy timestamp remains writable".into();
    let expected_revision = loaded_task.revision;
    loaded_task.increment_revision()?;

    repository.update(
        &loaded_task,
        expected_revision,
        ReminderClaimStateUpdate::Preserve,
    )?;

    assert_eq!(
        repository.get(task.id)?.unwrap().note,
        "Legacy timestamp remains writable"
    );

    Ok(())
}

#[test]
fn sqlite_completion_accepts_a_loaded_legacy_z_updated_at_value(
) -> Result<(), Box<dyn std::error::Error>> {
    let database_file = TemporaryDatabaseFile::unique();
    let repository = SqliteTaskRepository::open(database_file.path())?;
    let task = Task::for_test("Prepare release".into());
    repository.insert(&task)?;
    let connection = Connection::open(database_file.path())?;
    connection.execute(
        "UPDATE todo_tasks SET updated_at = ?1 WHERE id = ?2",
        params!["2026-09-09T08:30:00Z", task.id.to_string()],
    )?;
    let loaded_task = repository.get(task.id)?.unwrap();
    let completion = complete_task(&loaded_task, fixed_utc(2026, 9, 9, 9, 0, 0))?;

    repository.save_completion(&completion, loaded_task.revision)?;

    assert!(repository.get(task.id)?.unwrap().completed_at.is_some());

    Ok(())
}

#[test]
fn sqlite_preserves_an_interleaved_reminder_claim_during_a_content_update() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 9, 0, 5);
    let claim_token = Uuid::new_v4();
    let mut task = Task::for_test("Prepare release".into());
    task.scheduled_at = Some(scheduled_at);
    repository.insert(&task).unwrap();

    let mut stale_task = repository.get(task.id).unwrap().unwrap();
    assert!(repository
        .claim_reminder(
            task.id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            claim_token,
        )
        .unwrap());
    stale_task.note = "Notify the release channel".into();
    let expected_revision = stale_task.revision;
    stale_task.increment_revision().unwrap();
    repository
        .update(
            &stale_task,
            expected_revision,
            ReminderClaimStateUpdate::Preserve,
        )
        .unwrap();

    let persisted_task = repository.get(task.id).unwrap().unwrap();
    assert_eq!(persisted_task.note, "Notify the release channel");
    assert_eq!(persisted_task.reminder_sent_at, None);
    assert!(repository
        .release_reminder_claim(task.id, scheduled_at, claim_token)
        .unwrap());
}

#[test]
fn sqlite_preserves_a_claim_when_a_stale_schedule_patch_targets_the_current_schedule() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let initial_scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let rescheduled_at = fixed_utc(2026, 9, 8, 10, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 10, 0, 5);
    let claim_token = Uuid::new_v4();
    let mut task = Task::for_test("Prepare release".into());
    task.scheduled_at = Some(initial_scheduled_at);
    repository.insert(&task).unwrap();

    let mut rescheduled_task = repository.get(task.id).unwrap().unwrap();
    rescheduled_task.scheduled_at = Some(rescheduled_at);
    let expected_revision = rescheduled_task.revision;
    rescheduled_task.increment_revision().unwrap();
    repository
        .update(
            &rescheduled_task,
            expected_revision,
            ReminderClaimStateUpdate::ClearIfStoredScheduleDiffers,
        )
        .unwrap();
    assert!(repository
        .claim_reminder(
            task.id,
            rescheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            claim_token,
        )
        .unwrap());

    let mut stale_task = repository.get(task.id).unwrap().unwrap();
    stale_task.scheduled_at = Some(rescheduled_at);
    let expected_revision = stale_task.revision;
    stale_task.increment_revision().unwrap();
    repository
        .update(
            &stale_task,
            expected_revision,
            ReminderClaimStateUpdate::ClearIfStoredScheduleDiffers,
        )
        .unwrap();

    let persisted_task = repository.get(task.id).unwrap().unwrap();
    assert_eq!(persisted_task.scheduled_at, Some(rescheduled_at));
    assert_eq!(persisted_task.reminder_sent_at, None);
    assert!(repository
        .release_reminder_claim(task.id, rescheduled_at, claim_token)
        .unwrap());
}

#[test]
fn sqlite_compares_the_stored_schedule_with_the_pending_schedule_when_conditionally_clearing_a_claim(
) {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let initial_scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let rescheduled_at = fixed_utc(2026, 9, 8, 10, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 9, 0, 5);
    let claim_token = Uuid::new_v4();
    let mut task = Task::for_test("Prepare release".into());
    task.scheduled_at = Some(initial_scheduled_at);
    repository.insert(&task).unwrap();
    assert!(repository
        .claim_reminder(
            task.id,
            initial_scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            claim_token,
        )
        .unwrap());

    task.scheduled_at = Some(rescheduled_at);
    let expected_revision = task.revision;
    task.increment_revision().unwrap();
    repository
        .update(
            &task,
            expected_revision,
            ReminderClaimStateUpdate::ClearIfStoredScheduleDiffers,
        )
        .unwrap();

    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        None
    );
    assert!(!repository
        .release_reminder_claim(task.id, rescheduled_at, claim_token)
        .unwrap());
}

#[test]
fn sqlite_rescheduling_clears_delivered_and_live_reminder_lease_fields(
) -> Result<(), Box<dyn std::error::Error>> {
    let database_file = TemporaryDatabaseFile::unique();
    let repository = SqliteTaskRepository::open(database_file.path())?;
    let initial_scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let rescheduled_at = fixed_utc(2026, 9, 8, 10, 0, 0);
    let mut task = Task::for_test("Reschedule reminder delivery state".into());
    task.scheduled_at = Some(initial_scheduled_at);
    repository.insert(&task)?;
    let connection = Connection::open(database_file.path())?;
    connection.execute(
        "UPDATE todo_tasks SET reminder_sent_at = ?1, reminder_claimed_at = ?2, \
         reminder_claim_token = ?3 WHERE id = ?4",
        params![
            "2026-09-08T08:55:00Z",
            "2026-09-08T08:59:00Z",
            Uuid::new_v4().to_string(),
            task.id.to_string(),
        ],
    )?;

    TaskService::new(repository.clone()).patch(
        task.id,
        TaskPatch {
            scheduled_at: Some(Some(rescheduled_at)),
            ..Default::default()
        },
    )?;

    let reminder_state = connection.query_row(
        "SELECT reminder_sent_at, reminder_claimed_at, reminder_claim_token \
         FROM todo_tasks WHERE id = ?1",
        params![task.id.to_string()],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        },
    )?;

    assert_eq!(reminder_state, (None, None, None));
    assert!(repository.claim_reminder(
        task.id,
        rescheduled_at,
        fixed_utc(2026, 9, 8, 9, 1, 0),
        fixed_utc(2026, 9, 8, 8, 59, 0),
        Uuid::new_v4(),
    )?);

    Ok(())
}

#[test]
fn sqlite_restoring_a_completed_task_clears_delivered_and_live_reminder_lease_fields(
) -> Result<(), Box<dyn std::error::Error>> {
    let database_file = TemporaryDatabaseFile::unique();
    let repository = SqliteTaskRepository::open(database_file.path())?;
    let scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut task = Task::for_test("Restore reminder delivery state".into());
    task.scheduled_at = Some(scheduled_at);
    task.completed_at = Some(fixed_utc(2026, 9, 8, 8, 55, 0));
    repository.insert(&task)?;
    let connection = Connection::open(database_file.path())?;
    connection.execute(
        "UPDATE todo_tasks SET reminder_sent_at = ?1, reminder_claimed_at = ?2, \
         reminder_claim_token = ?3 WHERE id = ?4",
        params![
            "2026-09-08T08:55:00Z",
            "2026-09-08T08:59:00Z",
            Uuid::new_v4().to_string(),
            task.id.to_string(),
        ],
    )?;

    TaskService::new(repository.clone()).patch(
        task.id,
        TaskPatch {
            completed_at: Some(None),
            ..Default::default()
        },
    )?;

    let reminder_state = connection.query_row(
        "SELECT reminder_sent_at, reminder_claimed_at, reminder_claim_token \
         FROM todo_tasks WHERE id = ?1",
        params![task.id.to_string()],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        },
    )?;

    assert_eq!(reminder_state, (None, None, None));
    assert!(repository.claim_reminder(
        task.id,
        scheduled_at,
        fixed_utc(2026, 9, 8, 9, 1, 0),
        fixed_utc(2026, 9, 8, 8, 59, 0),
        Uuid::new_v4(),
    )?);

    Ok(())
}

#[test]
fn sqlite_lists_only_due_unfinished_unclaimed_reminder_candidates() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut overdue = Task::for_test("Overdue release review".into());
    overdue.scheduled_at = Some(fixed_utc(2026, 9, 8, 8, 45, 0));
    let mut due_now = Task::for_test("Start deployment".into());
    due_now.scheduled_at = Some(now);
    let mut future = Task::for_test("Review release metrics".into());
    future.scheduled_at = Some(fixed_utc(2026, 9, 8, 9, 15, 0));
    let mut completed = Task::for_test("Publish release notes".into());
    completed.scheduled_at = Some(fixed_utc(2026, 9, 8, 8, 30, 0));
    completed.completed_at = Some(now);
    let mut claimed = Task::for_test("Notify stakeholders".into());
    claimed.scheduled_at = Some(fixed_utc(2026, 9, 8, 8, 30, 0));
    claimed.reminder_sent_at = Some(fixed_utc(2026, 9, 8, 8, 30, 0));
    let unscheduled = Task::for_test("Unscheduled follow-up".into());

    for task in [
        &overdue,
        &due_now,
        &future,
        &completed,
        &claimed,
        &unscheduled,
    ] {
        repository.insert(task).unwrap();
    }

    let candidates = repository
        .list_due_reminder_candidates(now, now - chrono::Duration::minutes(2))
        .unwrap();
    let candidate_ids = candidates
        .into_iter()
        .map(|task| task.id)
        .collect::<Vec<_>>();

    assert_eq!(candidate_ids, vec![overdue.id, due_now.id]);
}

#[test]
fn sqlite_reminder_claim_and_release_are_bound_to_the_same_candidate_instance() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 9, 0, 5);
    let claim_token = Uuid::new_v4();
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(scheduled_at);
    repository.insert(&task).unwrap();

    assert!(repository
        .claim_reminder(
            task.id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            claim_token,
        )
        .unwrap());
    assert!(!repository
        .claim_reminder(
            task.id,
            scheduled_at,
            fixed_utc(2026, 9, 8, 9, 0, 6),
            claimed_at - chrono::Duration::minutes(2),
            Uuid::new_v4(),
        )
        .unwrap());
    assert!(!repository
        .release_reminder_claim(task.id, scheduled_at, Uuid::new_v4())
        .unwrap());
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        None
    );
    assert!(repository
        .release_reminder_claim(task.id, scheduled_at, claim_token)
        .unwrap());
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        None
    );

    let rescheduled_at = fixed_utc(2026, 9, 8, 10, 0, 0);
    task.scheduled_at = Some(rescheduled_at);
    let expected_revision = task.revision;
    task.increment_revision().unwrap();
    repository
        .update(&task, expected_revision, ReminderClaimStateUpdate::Clear)
        .unwrap();

    assert!(!repository
        .claim_reminder(
            task.id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            Uuid::new_v4(),
        )
        .unwrap());
    assert!(repository
        .claim_reminder(
            task.id,
            rescheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            Uuid::new_v4(),
        )
        .unwrap());
}

#[test]
fn sqlite_reminder_release_does_not_clear_a_later_claim_with_the_same_timestamp() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 9, 0, 5);
    let original_claim_token = Uuid::new_v4();
    let later_claim_token = Uuid::new_v4();
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(scheduled_at);
    repository.insert(&task).unwrap();

    assert!(repository
        .claim_reminder(
            task.id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            original_claim_token,
        )
        .unwrap());
    assert!(repository
        .release_reminder_claim(task.id, scheduled_at, original_claim_token)
        .unwrap());
    assert!(repository
        .claim_reminder(
            task.id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            later_claim_token,
        )
        .unwrap());

    assert!(!repository
        .release_reminder_claim(task.id, scheduled_at, original_claim_token)
        .unwrap());
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        None
    );
}

#[test]
fn sqlite_reminder_delivery_acknowledgement_requires_the_current_claim_token() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 9, 0, 5);
    let delivered_at = fixed_utc(2026, 9, 8, 9, 0, 6);
    let original_claim_token = Uuid::new_v4();
    let later_claim_token = Uuid::new_v4();
    let mut task = Task::for_test("Acknowledge only the current reminder lease".into());
    task.scheduled_at = Some(scheduled_at);
    repository.insert(&task).unwrap();

    assert!(repository
        .claim_reminder(
            task.id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            original_claim_token,
        )
        .unwrap());
    assert!(repository
        .release_reminder_claim(task.id, scheduled_at, original_claim_token)
        .unwrap());
    assert!(repository
        .claim_reminder(
            task.id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            later_claim_token,
        )
        .unwrap());

    assert!(!repository
        .mark_reminder_delivered(task.id, scheduled_at, delivered_at, original_claim_token)
        .unwrap());
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        None
    );
    assert!(repository
        .mark_reminder_delivered(task.id, scheduled_at, delivered_at, later_claim_token)
        .unwrap());
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        Some(delivered_at)
    );
    assert!(!repository
        .release_reminder_claim(task.id, scheduled_at, later_claim_token)
        .unwrap());
}

#[test]
fn sqlite_reminder_claim_allows_only_one_concurrent_caller() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 9, 0, 5);
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(scheduled_at);
    repository.insert(&task).unwrap();
    let start = Arc::new(Barrier::new(2));
    let task_id = task.id;
    let first_repository = repository.clone();
    let first_start = Arc::clone(&start);
    let second_repository = repository.clone();
    let second_start = Arc::clone(&start);

    let first = std::thread::spawn(move || {
        first_start.wait();
        first_repository.claim_reminder(
            task_id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            Uuid::new_v4(),
        )
    });
    let second = std::thread::spawn(move || {
        second_start.wait();
        second_repository.claim_reminder(
            task.id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            Uuid::new_v4(),
        )
    });

    let results = [
        first.join().unwrap().unwrap(),
        second.join().unwrap().unwrap(),
    ];

    assert_eq!(results.into_iter().filter(|claimed| *claimed).count(), 1);
}

#[test]
fn sqlite_completion_write_rolls_back_the_completed_instance_when_next_insert_fails() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Review weekly release".into());
    task.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    task.recurrence = Some(RecurrenceRule::new(Frequency::Weekly, 1, None, None).unwrap());
    repository.insert(&task).unwrap();
    let completion = complete_task(&task, fixed_utc(2026, 8, 26, 10, 0, 0)).unwrap();
    let conflicting_next_task = completion.next_task.clone().unwrap();
    repository.insert(&conflicting_next_task).unwrap();

    let error = repository
        .save_completion(&completion, task.revision)
        .unwrap_err();

    assert_eq!(error.code(), "storage.unavailable");
    assert_eq!(repository.get(task.id).unwrap(), Some(task));
    assert_eq!(
        repository.get(conflicting_next_task.id).unwrap(),
        Some(conflicting_next_task)
    );
}

#[test]
fn sqlite_completion_allows_only_one_concurrent_write_for_the_same_recurring_instance() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Review weekly release".into());
    task.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    task.recurrence = Some(RecurrenceRule::new(Frequency::Weekly, 1, None, None).unwrap());
    repository.insert(&task).unwrap();
    let start = Arc::new(Barrier::new(2));
    let first_repository = repository.clone();
    let first_task = task.clone();
    let first_start = Arc::clone(&start);
    let second_repository = repository.clone();
    let second_task = task.clone();
    let second_start = Arc::clone(&start);

    let first = std::thread::spawn(move || {
        first_start.wait();
        let completion = complete_task(&first_task, fixed_utc(2026, 8, 26, 10, 0, 0)).unwrap();

        first_repository
            .save_completion(&completion, first_task.revision)
            .map_err(|error| error.code())
    });
    let second = std::thread::spawn(move || {
        second_start.wait();
        let completion = complete_task(&second_task, fixed_utc(2026, 8, 26, 10, 0, 0)).unwrap();

        second_repository
            .save_completion(&completion, second_task.revision)
            .map_err(|error| error.code())
    });

    let results = [first.join().unwrap(), second.join().unwrap()];
    let succeeded = results.iter().filter(|result| result.is_ok()).count();
    let conflicts = results
        .iter()
        .filter(|result| result.as_ref().err() == Some(&"task.already_completed"))
        .count();

    assert_eq!(succeeded, 1);
    assert_eq!(conflicts, 1);
    assert_eq!(repository.list_inbox().unwrap().len(), 1);
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
