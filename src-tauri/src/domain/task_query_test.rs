use chrono::{Days, Local, NaiveDate, TimeZone, Utc};
use rusqlite::{params, Connection};
use std::{collections::BTreeSet, path::PathBuf};
use uuid::Uuid;

use crate::{
    domain::{ports::TaskRepository, task::Task, task_query::TaskView},
    infrastructure::sqlite::SqliteTaskRepository,
};

#[test]
fn today_includes_scheduled_and_overdue_top_level_tasks_only() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let day = NaiveDate::from_ymd_opt(2026, 8, 26).unwrap();

    let mut scheduled_today = Task::for_test("Scheduled today".into());
    scheduled_today.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    let mut overdue = Task::for_test("Overdue".into());
    overdue.scheduled_at = Some(fixed_utc(2026, 8, 25, 9, 0, 0));
    let mut completed = Task::for_test("Completed today".into());
    completed.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    completed.completed_at = Some(fixed_utc(2026, 8, 26, 10, 0, 0));
    let mut child = Task::for_test("Child today".into());
    child.parent_id = Some(scheduled_today.id);
    child.scheduled_at = Some(fixed_utc(2026, 8, 26, 11, 0, 0));

    repository.insert(&scheduled_today).unwrap();
    repository.insert(&overdue).unwrap();
    repository.insert(&completed).unwrap();
    repository.insert(&child).unwrap();

    let summaries = repository.list_tasks(&TaskView::Today { day }).unwrap();
    let titles = summaries
        .into_iter()
        .map(|summary| summary.title)
        .collect::<Vec<_>>();

    assert_eq!(titles, vec!["Overdue", "Scheduled today"]);
}

#[test]
fn quick_panel_today_includes_open_tasks_and_tasks_completed_on_the_day() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let day = NaiveDate::from_ymd_opt(2026, 8, 26).unwrap();

    let mut open = Task::for_test("Open today".into());
    open.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    let mut completed_today = Task::for_test("Completed today".into());
    completed_today.completed_at = Some(fixed_utc(2026, 8, 26, 10, 0, 0));
    let mut completed_yesterday = Task::for_test("Completed yesterday".into());
    completed_yesterday.completed_at = Some(fixed_utc(2026, 8, 25, 10, 0, 0));

    for task in [&open, &completed_today, &completed_yesterday] {
        repository.insert(task).unwrap();
    }

    let summaries = repository
        .list_tasks(&TaskView::QuickPanelToday { day })
        .unwrap();

    assert_eq!(
        summaries
            .into_iter()
            .map(|summary| summary.title)
            .collect::<Vec<_>>(),
        vec!["Open today", "Completed today"]
    );
}

#[test]
fn upcoming_uses_the_system_local_calendar_day_for_utc_timestamps() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Local-day task".into());
    let scheduled_at = fixed_utc(2026, 8, 26, 18, 0, 0);
    task.scheduled_at = Some(scheduled_at);
    repository.insert(&task).unwrap();

    let local_day = scheduled_at.with_timezone(&Local).date_naive();
    let summaries = repository
        .list_tasks(&TaskView::Upcoming {
            day: local_day.checked_sub_days(Days::new(1)).unwrap(),
        })
        .unwrap();

    assert_eq!(
        title_set(summaries),
        BTreeSet::from(["Local-day task".into()])
    );
}

#[test]
fn calendar_view_includes_scheduled_completed_top_level_tasks_only_within_the_local_month() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let start = NaiveDate::from_ymd_opt(2026, 8, 1).unwrap();
    let end = NaiveDate::from_ymd_opt(2026, 9, 1).unwrap();
    let mut open = Task::for_test("August open".into());
    open.scheduled_at = Some(fixed_local_utc(2026, 8, 12));
    let mut completed = Task::for_test("August completed".into());
    completed.scheduled_at = Some(fixed_local_utc(2026, 8, 18));
    completed.completed_at = Some(fixed_local_utc(2026, 8, 19));
    let mut child = Task::for_test("August child".into());
    child.parent_id = Some(open.id);
    child.scheduled_at = Some(fixed_local_utc(2026, 8, 20));
    let mut previous_month = Task::for_test("July task".into());
    previous_month.scheduled_at = Some(fixed_local_utc(2026, 7, 31));
    let mut next_month = Task::for_test("September task".into());
    next_month.scheduled_at = Some(fixed_local_utc(2026, 9, 1));
    let unscheduled = Task::for_test("Unscheduled".into());

    for task in [
        &open,
        &completed,
        &child,
        &previous_month,
        &next_month,
        &unscheduled,
    ] {
        repository.insert(task).unwrap();
    }

    let summaries = repository
        .list_tasks(&TaskView::Calendar { start, end })
        .unwrap();

    assert_eq!(
        title_set(summaries),
        BTreeSet::from(["August completed".to_owned(), "August open".to_owned()])
    );
}

#[test]
fn task_views_filter_top_level_tasks_by_status_date_and_project() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let day = NaiveDate::from_ymd_opt(2026, 8, 26).unwrap();
    let project_id = Uuid::new_v4();

    let inbox = Task::for_test("Inbox".into());
    let mut upcoming = Task::for_test("Upcoming".into());
    upcoming.scheduled_at = Some(fixed_utc(2026, 8, 27, 9, 0, 0));
    let mut completed = Task::for_test("Completed".into());
    completed.completed_at = Some(fixed_utc(2026, 8, 26, 10, 0, 0));
    let mut project_task = Task::for_test("Project task".into());
    project_task.project_id = Some(project_id);
    let mut other_project_task = Task::for_test("Other project task".into());
    other_project_task.project_id = Some(Uuid::new_v4());

    for task in [
        &inbox,
        &upcoming,
        &completed,
        &project_task,
        &other_project_task,
    ] {
        repository.insert(task).unwrap();
    }

    assert_eq!(
        title_set(repository.list_tasks(&TaskView::Inbox).unwrap()),
        BTreeSet::from([
            "Inbox".to_owned(),
            "Other project task".to_owned(),
            "Project task".to_owned(),
            "Upcoming".to_owned(),
        ])
    );
    assert_eq!(
        title_set(repository.list_tasks(&TaskView::Upcoming { day }).unwrap()),
        BTreeSet::from(["Upcoming".to_owned()])
    );
    assert_eq!(
        title_set(repository.list_tasks(&TaskView::Completed).unwrap()),
        BTreeSet::from(["Completed".to_owned()])
    );
    assert_eq!(
        title_set(
            repository
                .list_tasks(&TaskView::Project(project_id))
                .unwrap()
        ),
        BTreeSet::from(["Project task".to_owned()])
    );
}

#[test]
fn search_matches_title_and_note_with_all_user_terms() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut matching = Task::for_test("Plan release".into());
    matching.note = "Schedule the final checklist".into();
    let non_matching = Task::for_test("Plan draft".into());
    let mut completed_matching = Task::for_test("Release archive".into());
    completed_matching.note = "Final checklist".into();
    completed_matching.completed_at = Some(fixed_utc(2026, 8, 26, 10, 0, 0));

    for task in [&matching, &non_matching, &completed_matching] {
        repository.insert(task).unwrap();
    }

    assert_eq!(
        title_set(
            repository
                .list_tasks(&TaskView::Search("release checklist".into()))
                .unwrap()
        ),
        BTreeSet::from(["Plan release".to_owned(), "Release archive".to_owned()])
    );
    assert!(repository
        .list_tasks(&TaskView::Search("release OR checklist".into()))
        .unwrap()
        .is_empty());
}

#[test]
fn inbox_view_excludes_completed_and_child_tasks_from_the_shared_fixture() {
    let fixture = shared_view_fixture();

    assert_eq!(
        summary_ids(fixture.repository.list_tasks(&TaskView::Inbox).unwrap()),
        fixture.inbox_ids
    );
}

#[test]
fn upcoming_view_excludes_completed_and_child_tasks_from_the_shared_fixture() {
    let fixture = shared_view_fixture();

    assert_eq!(
        summary_ids(
            fixture
                .repository
                .list_tasks(&TaskView::Upcoming { day: fixture.day })
                .unwrap(),
        ),
        fixture.upcoming_ids
    );
}

#[test]
fn completed_view_excludes_child_tasks_from_the_shared_fixture() {
    let fixture = shared_view_fixture();

    assert_eq!(
        summary_ids(fixture.repository.list_tasks(&TaskView::Completed).unwrap()),
        fixture.completed_ids
    );
}

#[test]
fn project_view_excludes_completed_other_project_and_child_tasks_from_the_shared_fixture() {
    let fixture = shared_view_fixture();

    assert_eq!(
        summary_ids(
            fixture
                .repository
                .list_tasks(&TaskView::Project(fixture.project_id))
                .unwrap(),
        ),
        fixture.project_ids
    );
}

#[test]
fn search_view_excludes_child_tasks_without_filtering_completed_tasks() {
    let fixture = shared_view_fixture();

    assert_eq!(
        summary_ids(
            fixture
                .repository
                .list_tasks(&TaskView::Search("needle".into()))
                .unwrap(),
        ),
        fixture.search_ids
    );
}

#[test]
fn project_summary_includes_archived_project_tags_and_direct_child_counts(
) -> Result<(), Box<dyn std::error::Error>> {
    let database_path = temporary_database_path();
    let repository = SqliteTaskRepository::open(&database_path)?;
    let connection = Connection::open(&database_path)?;
    let project_id = Uuid::new_v4();
    let first_tag_id = Uuid::new_v4();
    let second_tag_id = Uuid::new_v4();
    let mut parent = Task::for_test("Prepare release".into());
    parent.note = "Release details".into();
    parent.project_id = Some(project_id);
    parent.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    parent.due_at = Some(fixed_utc(2026, 8, 27, 17, 0, 0));
    let mut completed_child = Task::for_test("Approved child".into());
    completed_child.parent_id = Some(parent.id);
    completed_child.completed_at = Some(fixed_utc(2026, 8, 26, 11, 0, 0));
    let mut open_child = Task::for_test("Open child".into());
    open_child.parent_id = Some(parent.id);

    connection.execute(
        "INSERT INTO todo_projects (id, name, archived_at, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            project_id.to_string(),
            "Archived release",
            "2026-08-20T00:00:00Z",
            "2026-08-01T00:00:00Z",
            "2026-08-20T00:00:00Z",
        ],
    )?;
    for (id, name) in [(first_tag_id, "zeta"), (second_tag_id, "alpha")] {
        connection.execute(
            "INSERT INTO todo_tags (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                id.to_string(),
                name,
                "2026-08-01T00:00:00Z",
                "2026-08-01T00:00:00Z",
            ],
        )?;
    }

    repository.insert(&parent)?;
    repository.insert(&completed_child)?;
    repository.insert(&open_child)?;
    for tag_id in [first_tag_id, second_tag_id] {
        connection.execute(
            "INSERT INTO todo_task_tags (task_id, tag_id) VALUES (?1, ?2)",
            params![parent.id.to_string(), tag_id.to_string()],
        )?;
    }

    let summaries = repository.list_tasks(&TaskView::Project(project_id))?;
    let summary = summaries.first().ok_or("project task should be listed")?;

    assert_eq!(summary.id, parent.id.to_string());
    assert_eq!(summary.project_name.as_deref(), Some("Archived release"));
    assert_eq!(summary.tags, vec!["alpha", "zeta"]);
    assert_eq!(summary.scheduled_at, parent.scheduled_at);
    assert_eq!(summary.due_at, parent.due_at);
    assert!(!summary.completed);
    assert!(summary.has_note);
    assert_eq!(summary.child_total, 2);
    assert_eq!(summary.child_completed, 1);
    assert_eq!(
        serde_json::to_value(summary)?,
        serde_json::json!({
            "id": parent.id.to_string(),
            "title": "Prepare release",
            "projectName": "Archived release",
            "tags": ["alpha", "zeta"],
            "priority": "Normal",
            "scheduledAt": "2026-08-26T09:00:00Z",
            "dueAt": "2026-08-27T17:00:00Z",
            "completed": false,
            "hasNote": true,
            "childTotal": 2,
            "childCompleted": 1,
        })
    );

    drop(connection);
    drop(repository);
    std::fs::remove_file(database_path)?;

    Ok(())
}

fn title_set(summaries: Vec<crate::domain::task_query::TaskSummaryDto>) -> BTreeSet<String> {
    summaries.into_iter().map(|summary| summary.title).collect()
}

struct SharedViewFixture {
    repository: SqliteTaskRepository,
    day: NaiveDate,
    project_id: Uuid,
    inbox_ids: BTreeSet<String>,
    upcoming_ids: BTreeSet<String>,
    completed_ids: BTreeSet<String>,
    project_ids: BTreeSet<String>,
    search_ids: BTreeSet<String>,
}

fn shared_view_fixture() -> SharedViewFixture {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let day = NaiveDate::from_ymd_opt(2026, 8, 26).unwrap();
    let project_id = Uuid::new_v4();
    let other_project_id = Uuid::new_v4();
    let inbox_open = Task::for_test("Fixture inbox open".into());
    let mut upcoming_open = Task::for_test("Fixture upcoming open".into());
    upcoming_open.project_id = Some(project_id);
    upcoming_open.scheduled_at = Some(fixed_utc(2026, 8, 27, 9, 0, 0));
    let mut upcoming_completed = Task::for_test("Fixture upcoming completed".into());
    upcoming_completed.project_id = Some(project_id);
    upcoming_completed.scheduled_at = Some(fixed_utc(2026, 8, 27, 9, 0, 0));
    upcoming_completed.completed_at = Some(fixed_utc(2026, 8, 26, 10, 0, 0));
    let mut upcoming_child = Task::for_test("Fixture upcoming child".into());
    upcoming_child.parent_id = Some(upcoming_open.id);
    upcoming_child.scheduled_at = Some(fixed_utc(2026, 8, 27, 9, 0, 0));
    let mut completed_open = Task::for_test("Fixture completed open".into());
    completed_open.completed_at = Some(fixed_utc(2026, 8, 26, 10, 0, 0));
    let mut completed_child = Task::for_test("Fixture completed child".into());
    completed_child.parent_id = Some(completed_open.id);
    completed_child.completed_at = Some(fixed_utc(2026, 8, 26, 10, 0, 0));
    let mut project_open = Task::for_test("Fixture project open".into());
    project_open.project_id = Some(project_id);
    let mut project_completed = Task::for_test("Fixture project completed".into());
    project_completed.project_id = Some(project_id);
    project_completed.completed_at = Some(fixed_utc(2026, 8, 26, 10, 0, 0));
    let mut project_child = Task::for_test("Fixture project child".into());
    project_child.parent_id = Some(project_open.id);
    project_child.project_id = Some(project_id);
    let mut other_project_open = Task::for_test("Fixture other project open".into());
    other_project_open.project_id = Some(other_project_id);
    let mut search_open = Task::for_test("Fixture search open".into());
    search_open.note = "needle".into();
    let mut search_completed = Task::for_test("Fixture search completed".into());
    search_completed.note = "needle".into();
    search_completed.completed_at = Some(fixed_utc(2026, 8, 26, 10, 0, 0));
    let mut search_child = Task::for_test("Fixture search child".into());
    search_child.parent_id = Some(search_open.id);
    search_child.note = "needle".into();

    for task in [
        &inbox_open,
        &upcoming_open,
        &upcoming_completed,
        &upcoming_child,
        &completed_open,
        &completed_child,
        &project_open,
        &project_completed,
        &project_child,
        &other_project_open,
        &search_open,
        &search_completed,
        &search_child,
    ] {
        repository.insert(task).unwrap();
    }

    SharedViewFixture {
        repository,
        day,
        project_id,
        inbox_ids: BTreeSet::from([
            inbox_open.id.to_string(),
            upcoming_open.id.to_string(),
            project_open.id.to_string(),
            other_project_open.id.to_string(),
            search_open.id.to_string(),
        ]),
        upcoming_ids: BTreeSet::from([upcoming_open.id.to_string()]),
        completed_ids: BTreeSet::from([
            upcoming_completed.id.to_string(),
            completed_open.id.to_string(),
            project_completed.id.to_string(),
            search_completed.id.to_string(),
        ]),
        project_ids: BTreeSet::from([upcoming_open.id.to_string(), project_open.id.to_string()]),
        search_ids: BTreeSet::from([search_open.id.to_string(), search_completed.id.to_string()]),
    }
}

fn summary_ids(summaries: Vec<crate::domain::task_query::TaskSummaryDto>) -> BTreeSet<String> {
    summaries.into_iter().map(|summary| summary.id).collect()
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

fn fixed_local_utc(year: i32, month: u32, day: u32) -> chrono::DateTime<Utc> {
    Local
        .with_ymd_and_hms(year, month, day, 12, 0, 0)
        .single()
        .unwrap()
        .with_timezone(&Utc)
}

fn temporary_database_path() -> PathBuf {
    std::env::temp_dir().join(format!("todo-app-query-{}.sqlite3", Uuid::new_v4()))
}
