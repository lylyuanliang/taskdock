use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::{TimeZone, Utc};
use uuid::Uuid;

use crate::{
    domain::{
        ports::TaskRepository,
        recurrence::{Frequency, RecurrenceRule},
        task::{Priority, Task, TaskDraft, TaskPatch},
        task_service::TaskService,
    },
    error::AppError,
};

#[test]
fn create_task_rejects_a_blank_title() {
    let error = TaskDraft::new("   ".into()).unwrap_err();

    assert_eq!(error.code(), "task.title.blank");
}

#[test]
fn patch_preserves_unspecified_fields() {
    let task = Task::for_test("Draft API".into());
    let patched = task
        .apply_patch(TaskPatch {
            title: Some("Review API".into()),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(patched.title, "Review API");
    assert_eq!(patched.priority, task.priority);
}

#[test]
fn from_draft_rejects_a_blank_title_from_direct_construction() {
    let error = Task::from_draft(direct_draft("   ")).unwrap_err();

    assert_eq!(error.code(), "task.title.blank");
}

#[test]
fn from_draft_rejects_a_title_with_501_unicode_scalar_values() {
    let error = Task::from_draft(direct_draft(&"a".repeat(501))).unwrap_err();

    assert_eq!(error.code(), "task.title.too_long");
}

#[test]
fn from_draft_trims_a_title_from_direct_construction() {
    let task = Task::from_draft(direct_draft("  Review API  ")).unwrap();

    assert_eq!(task.title, "Review API");
}

#[test]
fn task_service_does_not_insert_a_draft_with_an_invalid_direct_title() {
    let repository = CountingRepository::default();
    let service = TaskService::new(&repository);

    let error = service.create(direct_draft(" ")).unwrap_err();

    assert_eq!(error.code(), "task.title.blank");
    assert_eq!(repository.insert_count.load(Ordering::Relaxed), 0);
}

#[test]
fn patch_clears_an_explicit_scheduled_date_without_changing_other_fields() {
    let mut task = Task::for_test("Draft API".into());
    let scheduled_at = Utc::now();
    task.scheduled_at = Some(scheduled_at);

    let patched = task
        .apply_patch(TaskPatch {
            scheduled_at: Some(None),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(patched.scheduled_at, None);
    assert_eq!(patched.title, task.title);
    assert_eq!(patched.priority, task.priority);
}

#[test]
fn from_draft_rejects_a_new_yearly_rule_loaded_from_structured_input() {
    let mut draft = direct_draft("Renew certificate");
    draft.scheduled_at = Some(fixed_utc(2026, 2, 1, 9, 0, 0));
    draft.recurrence = Some(legacy_yearly_rule());

    let error = Task::from_draft(draft).unwrap_err();

    assert_eq!(error.code(), "recurrence.frequency.unsupported");
}

#[test]
fn patch_rejects_a_new_yearly_rule_loaded_from_structured_input() {
    let task = Task::for_test("Renew certificate".into());

    let error = task
        .apply_patch(TaskPatch {
            recurrence: Some(Some(legacy_yearly_rule())),
            ..Default::default()
        })
        .unwrap_err();

    assert_eq!(error.code(), "recurrence.frequency.unsupported");
}

#[test]
fn patch_preserves_an_unmodified_legacy_yearly_rule() {
    let mut task = Task::for_test("Renew certificate".into());
    task.scheduled_at = Some(fixed_utc(2026, 2, 28, 9, 0, 0));
    task.recurrence = Some(legacy_yearly_rule());
    task.monthly_anchor_day = Some(29);

    let patched = task
        .apply_patch(TaskPatch {
            note: Some("Keep legacy schedule".into()),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(patched.recurrence, task.recurrence);
    assert_eq!(patched.monthly_anchor_day, Some(29));
}

#[test]
fn from_draft_rejects_a_recurring_task_without_a_schedule() {
    let mut draft = direct_draft("Review budget");
    draft.recurrence = Some(RecurrenceRule::new(Frequency::Daily, 1, None, None).unwrap());

    let error = Task::from_draft(draft).unwrap_err();

    assert_eq!(error.code(), "recurrence.scheduled_at.required");
}

#[test]
fn from_draft_rejects_a_recurring_subtask() {
    let mut draft = direct_draft("Review budget");
    draft.parent_id = Some(Uuid::new_v4());
    draft.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    draft.recurrence = Some(RecurrenceRule::new(Frequency::Daily, 1, None, None).unwrap());

    let error = Task::from_draft(draft).unwrap_err();

    assert_eq!(error.code(), "recurrence.child.unsupported");
}

fn direct_draft(title: &str) -> TaskDraft {
    TaskDraft {
        title: title.into(),
        note: String::new(),
        project_id: None,
        parent_id: None,
        priority: Priority::Normal,
        scheduled_at: None,
        due_at: None,
        recurrence: None,
    }
}

fn legacy_yearly_rule() -> RecurrenceRule {
    serde_json::from_str(r#"{"frequency":"yearly","interval":1,"until":null,"count":null}"#)
        .unwrap()
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

#[derive(Default)]
struct CountingRepository {
    insert_count: AtomicUsize,
}

impl TaskRepository for &CountingRepository {
    fn insert(&self, _task: &Task) -> Result<(), AppError> {
        self.insert_count.fetch_add(1, Ordering::Relaxed);

        Ok(())
    }

    fn update(&self, _task: &Task) -> Result<(), AppError> {
        Ok(())
    }

    fn get(&self, _id: Uuid) -> Result<Option<Task>, AppError> {
        Ok(None)
    }

    fn list_inbox(&self) -> Result<Vec<Task>, AppError> {
        Ok(Vec::new())
    }

    fn list_tasks(
        &self,
        _view: &crate::domain::task_query::TaskView,
    ) -> Result<Vec<crate::domain::task_query::TaskSummaryDto>, AppError> {
        Ok(Vec::new())
    }
}
