use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier, Mutex,
    },
};

use chrono::{DateTime, TimeZone, Utc};
use uuid::Uuid;

use crate::{
    domain::{
        ports::TaskRepository,
        recurrence::TaskCompletion,
        reminders::{ReminderNotifier, ReminderScheduler},
        task::{ReminderClaimStateUpdate, Task},
        task_query::{TaskSummaryDto, TaskView},
        task_service::TaskService,
    },
    error::{AppError, AppErrorKind},
    infrastructure::sqlite::SqliteTaskRepository,
    reminder_notification::TauriReminderNotifier,
    reminder_notification_test::ControlledNativePresenter,
};

#[test]
fn scheduler_retries_native_presenter_failure_before_the_claim_lease_expires() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let retry_at = now + chrono::Duration::seconds(1);
    let mut task = Task::for_test("Retry rejected native submission".into());
    task.scheduled_at = Some(now);
    repository.insert(&task).unwrap();
    let presenter = ControlledNativePresenter::failing_once();
    let notifier = TauriReminderNotifier::with_presenter(
        "TaskDock".into(),
        "com.taskdock.app".into(),
        presenter.clone(),
    );
    let scheduler = ReminderScheduler::new(TaskService::new(repository.clone()), notifier);

    let result = scheduler.run_once(now);
    presenter.wait_for_attempt();

    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        None,
        "a native submission failure must never be persisted as delivered"
    );
    assert_eq!(result.unwrap_err().code(), "reminder.notification.failed");
    assert_eq!(
        repository
            .list_due_reminder_candidates(now, now - chrono::Duration::minutes(2))
            .unwrap()
            .iter()
            .map(|candidate| candidate.id)
            .collect::<Vec<_>>(),
        vec![task.id],
        "a failed submission must release its unexpired claim for retry"
    );

    scheduler.run_once(retry_at).unwrap();
    presenter.wait_for_attempt();

    assert_eq!(presenter.attempt_count(), 2);
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        Some(retry_at)
    );
}

#[test]
fn scheduler_notifies_each_due_task_only_once() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut due_task = Task::for_test("Start deployment".into());
    due_task.scheduled_at = Some(now);
    let mut future_task = Task::for_test("Review release metrics".into());
    future_task.scheduled_at = Some(fixed_utc(2026, 9, 8, 9, 15, 0));
    let mut completed_task = Task::for_test("Publish release notes".into());
    completed_task.scheduled_at = Some(now);
    completed_task.completed_at = Some(now);
    let mut claimed_task = Task::for_test("Notify stakeholders".into());
    claimed_task.scheduled_at = Some(now);
    claimed_task.reminder_sent_at = Some(fixed_utc(2026, 9, 8, 8, 45, 0));
    for task in [&due_task, &future_task, &completed_task, &claimed_task] {
        repository.insert(task).unwrap();
    }
    let notifier = RecordingNotifier::default();
    let scheduler = ReminderScheduler::new(TaskService::new(repository.clone()), notifier.clone());

    scheduler.run_once(now).unwrap();
    scheduler.run_once(fixed_utc(2026, 9, 8, 9, 1, 0)).unwrap();

    assert_eq!(notifier.sent_task_ids(), vec![due_task.id]);
    assert_eq!(
        repository
            .get(due_task.id)
            .unwrap()
            .unwrap()
            .reminder_sent_at,
        Some(now)
    );
}

#[test]
fn scheduler_retries_an_abandoned_claim_after_its_lease_expires() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let claimed_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let retry_at = fixed_utc(2026, 9, 8, 9, 3, 0);
    let mut task = Task::for_test("Resume interrupted reminder".into());
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

    let notifier = RecordingNotifier::default();
    let scheduler = ReminderScheduler::new(TaskService::new(repository.clone()), notifier.clone());

    scheduler.run_once(retry_at).unwrap();

    assert_eq!(notifier.sent_task_ids(), vec![task.id]);
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        Some(retry_at)
    );
}

#[test]
fn scheduler_marks_a_reminder_delivered_only_after_native_notification_succeeds() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut task = Task::for_test("Confirm native reminder before delivery".into());
    task.scheduled_at = Some(now);
    repository.insert(&task).unwrap();
    let notifier = DeliveryStateInspectingNotifier::new(repository.clone());
    let scheduler = ReminderScheduler::new(TaskService::new(repository.clone()), notifier.clone());

    scheduler.run_once(now).unwrap();

    assert_eq!(
        notifier.deliveries_observed_during_notification(),
        vec![None]
    );
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        Some(now)
    );
}

#[test]
fn scheduler_recovers_an_acknowledgement_storage_failure_after_the_lease_expires() {
    let sqlite_repository = SqliteTaskRepository::in_memory().unwrap();
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut task = Task::for_test("Retry delivery acknowledgement after storage failure".into());
    task.scheduled_at = Some(now);
    sqlite_repository.insert(&task).unwrap();
    let repository = AcknowledgementFailingRepository::new(sqlite_repository.clone());
    let notifier = RecordingNotifier::default();
    let scheduler = ReminderScheduler::new(TaskService::new(&repository), notifier.clone());

    let error = scheduler.run_once(now).unwrap_err();

    assert_eq!(error.code(), "storage.unavailable");
    assert_eq!(notifier.sent_task_ids(), vec![task.id]);
    assert_eq!(repository.release_attempt_count(), 0);
    assert_eq!(
        sqlite_repository
            .get(task.id)
            .unwrap()
            .unwrap()
            .reminder_sent_at,
        None
    );

    scheduler.run_once(fixed_utc(2026, 9, 8, 9, 1, 0)).unwrap();

    assert_eq!(notifier.sent_task_ids(), vec![task.id]);
    assert_eq!(repository.release_attempt_count(), 0);

    let fresh_scheduler = ReminderScheduler::new(TaskService::new(&repository), notifier.clone());
    let recovered_at = fixed_utc(2026, 9, 8, 9, 3, 0);
    fresh_scheduler.run_once(recovered_at).unwrap();

    assert_eq!(notifier.sent_task_ids(), vec![task.id, task.id]);
    assert_eq!(
        sqlite_repository
            .get(task.id)
            .unwrap()
            .unwrap()
            .reminder_sent_at,
        Some(recovered_at)
    );
}

#[test]
fn scheduler_releases_its_claim_after_a_notification_failure_for_a_later_retry() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let retry_at = fixed_utc(2026, 9, 8, 9, 1, 0);
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(now);
    repository.insert(&task).unwrap();
    let notifier = FailsOnceNotifier::default();
    let scheduler = ReminderScheduler::new(TaskService::new(repository.clone()), notifier.clone());

    let error = scheduler.run_once(now).unwrap_err();

    assert_eq!(error.code(), "reminder.notification.failed");
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        None
    );

    scheduler.run_once(retry_at).unwrap();

    assert_eq!(notifier.attempt_count(), 2);
    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        Some(retry_at)
    );
}

#[test]
fn scheduler_continues_after_a_notification_failure_and_returns_the_first_error() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut failing_task = Task::for_test("Start deployment".into());
    failing_task.scheduled_at = Some(fixed_utc(2026, 9, 8, 8, 45, 0));
    let mut succeeding_task = Task::for_test("Notify stakeholders".into());
    succeeding_task.scheduled_at = Some(fixed_utc(2026, 9, 8, 8, 50, 0));
    repository.insert(&failing_task).unwrap();
    repository.insert(&succeeding_task).unwrap();
    let notifier = SelectiveFailingNotifier::new(failing_task.id);
    let scheduler = ReminderScheduler::new(TaskService::new(repository.clone()), notifier.clone());

    let error = scheduler.run_once(now).unwrap_err();

    assert_eq!(error.code(), "reminder.notification.failed");
    assert_eq!(
        notifier.attempted_task_ids(),
        vec![failing_task.id, succeeding_task.id]
    );
    assert_eq!(
        repository
            .get(failing_task.id)
            .unwrap()
            .unwrap()
            .reminder_sent_at,
        None
    );
    assert_eq!(
        repository
            .get(succeeding_task.id)
            .unwrap()
            .unwrap()
            .reminder_sent_at,
        Some(now)
    );
}

#[test]
fn scheduler_does_not_notify_when_claim_persistence_fails() {
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(now);
    let repository = ClaimFailingRepository::new(task);
    let notifier = RecordingNotifier::default();
    let scheduler = ReminderScheduler::new(TaskService::new(&repository), notifier.clone());

    let error = scheduler.run_once(now).unwrap_err();

    assert_eq!(error.code(), "storage.unavailable");
    assert!(notifier.sent_task_ids().is_empty());
    assert_eq!(repository.release_attempt_count(), 0);
}

#[test]
fn scheduler_retries_a_failed_release_with_its_original_token_before_retrying_notification() {
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(now);
    let repository = ReleaseRetryRepository::new_with_release_failures(task.clone(), 2);
    let notifier = FailsOnceNotifier::default();
    let scheduler = ReminderScheduler::new(TaskService::new(&repository), notifier.clone());

    let first_error = scheduler.run_once(now).unwrap_err();

    assert_eq!(first_error.code(), "reminder.notification.failed");
    assert_eq!(notifier.attempt_count(), 1);
    assert_eq!(repository.release_tokens().len(), 1);
    let original_token = repository.claim_tokens()[0];
    assert_eq!(repository.release_tokens(), vec![original_token]);
    assert_eq!(
        repository.release_attempts(),
        vec![ReleaseAttempt {
            task_id: task.id,
            scheduled_at: now,
            claim_token: original_token,
        }]
    );

    let second_error = scheduler
        .run_once(fixed_utc(2026, 9, 8, 9, 1, 0))
        .unwrap_err();

    assert_eq!(second_error.code(), "storage.unavailable");
    assert_eq!(notifier.attempt_count(), 1);
    assert_eq!(
        repository.release_tokens(),
        vec![original_token, original_token]
    );
    assert!(repository.is_claimed());

    scheduler.run_once(fixed_utc(2026, 9, 8, 9, 2, 0)).unwrap();

    assert_eq!(notifier.attempt_count(), 1);
    assert_eq!(
        repository.release_tokens(),
        vec![original_token, original_token, original_token]
    );
    assert!(!repository.is_claimed());

    scheduler.run_once(fixed_utc(2026, 9, 8, 9, 3, 0)).unwrap();

    assert_eq!(notifier.attempt_count(), 2);
}

#[test]
fn scheduler_retries_pending_release_after_a_candidate_query_error_with_the_original_claim() {
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(now);
    let repository = ReleaseRetryRepository::new_with_release_failures(task.clone(), 3);
    let scheduler =
        ReminderScheduler::new(TaskService::new(&repository), FailsOnceNotifier::default());

    let first_error = scheduler.run_once(now).unwrap_err();
    let original_token = repository.claim_tokens()[0];
    repository.fail_next_candidate_queries(1);

    let second_error = scheduler
        .run_once(fixed_utc(2026, 9, 8, 9, 1, 0))
        .unwrap_err();

    assert_eq!(first_error.code(), "reminder.notification.failed");
    assert_eq!(second_error.code(), "reminder.candidates.failed");
    assert_eq!(
        repository.release_attempts(),
        vec![
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
        ]
    );

    let third_error = scheduler
        .run_once(fixed_utc(2026, 9, 8, 9, 2, 0))
        .unwrap_err();

    assert_eq!(third_error.code(), "storage.unavailable");
    assert_eq!(
        repository.release_attempts(),
        vec![
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
        ]
    );
}

#[test]
fn scheduler_retries_pending_release_after_a_claim_error_with_the_original_claim() {
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(now);
    let repository = ReleaseRetryRepository::new_with_release_failures(task.clone(), 3);
    let scheduler =
        ReminderScheduler::new(TaskService::new(&repository), FailsOnceNotifier::default());

    scheduler.run_once(now).unwrap_err();
    let original_token = repository.claim_tokens()[0];
    repository.fail_next_claims(1);

    let second_error = scheduler
        .run_once(fixed_utc(2026, 9, 8, 9, 1, 0))
        .unwrap_err();

    assert_eq!(second_error.code(), "reminder.claim.failed");
    assert_eq!(
        repository.release_attempts(),
        vec![
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
        ]
    );

    scheduler
        .run_once(fixed_utc(2026, 9, 8, 9, 2, 0))
        .unwrap_err();

    assert_eq!(
        repository.release_attempts(),
        vec![
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
        ]
    );
}

#[test]
fn scheduler_continues_after_a_notification_and_release_failure() {
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut failing_task = Task::for_test("Start deployment".into());
    failing_task.scheduled_at = Some(fixed_utc(2026, 9, 8, 8, 45, 0));
    let mut succeeding_task = Task::for_test("Notify stakeholders".into());
    succeeding_task.scheduled_at = Some(fixed_utc(2026, 9, 8, 8, 50, 0));
    let repository = ReleaseRetryRepository::new_with_tasks_and_release_failures(
        vec![failing_task.clone(), succeeding_task.clone()],
        1,
    );
    let notifier = SelectiveFailingNotifier::new(failing_task.id);
    let scheduler = ReminderScheduler::new(TaskService::new(&repository), notifier.clone());

    let error = scheduler.run_once(now).unwrap_err();

    assert_eq!(error.code(), "reminder.notification.failed");
    assert_eq!(
        notifier.attempted_task_ids(),
        vec![failing_task.id, succeeding_task.id]
    );
    assert_eq!(
        repository.release_attempts(),
        vec![ReleaseAttempt {
            task_id: failing_task.id,
            scheduled_at: failing_task.scheduled_at.unwrap(),
            claim_token: repository.claim_tokens()[0],
        }]
    );
    assert!(!repository.is_task_claimed(succeeding_task.id));
}

#[test]
fn concurrent_runs_of_one_scheduler_do_not_lose_or_duplicate_a_pending_release() {
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(now);
    let repository = ReleaseRetryRepository::new_with_release_failures(task.clone(), 1);
    let scheduler = Arc::new(ReminderScheduler::new(
        TaskService::new(&repository),
        FailsOnceNotifier::default(),
    ));

    scheduler.run_once(now).unwrap_err();
    let original_token = repository.claim_tokens()[0];
    let first_list_started = Arc::new(Barrier::new(2));
    let both_lists_started = Arc::new(Barrier::new(2));
    repository.synchronize_next_two_list_calls(
        Arc::clone(&first_list_started),
        Arc::clone(&both_lists_started),
    );
    repository.fail_next_synchronized_candidate_query();
    std::thread::scope(|scope| {
        let first_scheduler = Arc::clone(&scheduler);
        let first = scope.spawn(move || first_scheduler.run_once(now));

        first_list_started.wait();

        let second_scheduler = Arc::clone(&scheduler);
        let second = scope.spawn(move || second_scheduler.run_once(now));

        assert_eq!(
            first.join().unwrap().unwrap_err().code(),
            "reminder.candidates.failed"
        );
        second.join().unwrap().unwrap();
    });

    assert_eq!(
        repository.release_attempts(),
        vec![
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
            ReleaseAttempt {
                task_id: task.id,
                scheduled_at: now,
                claim_token: original_token,
            },
        ]
    );
    assert!(!repository.is_claimed());
}

#[test]
fn scheduler_never_releases_a_pending_claim_replaced_by_another_scheduler() {
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(now);
    let repository = ReleaseRetryRepository::new(task);
    let scheduler =
        ReminderScheduler::new(TaskService::new(&repository), FailsOnceNotifier::default());

    scheduler.run_once(now).unwrap_err();
    let original_token = repository.claim_tokens()[0];
    let other_scheduler_token = Uuid::new_v4();
    repository.replace_claim(other_scheduler_token);

    scheduler.run_once(fixed_utc(2026, 9, 8, 9, 1, 0)).unwrap();

    assert_eq!(
        repository.release_tokens(),
        vec![original_token, original_token]
    );
    assert_eq!(repository.claim_token(), Some(other_scheduler_token));
}

#[test]
fn concurrent_schedulers_notify_a_due_task_only_once() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let now = fixed_utc(2026, 9, 8, 9, 0, 0);
    let mut task = Task::for_test("Start deployment".into());
    task.scheduled_at = Some(now);
    repository.insert(&task).unwrap();
    let notifier = RecordingNotifier::default();
    let start = Arc::new(Barrier::new(2));
    let first_scheduler =
        ReminderScheduler::new(TaskService::new(repository.clone()), notifier.clone());
    let second_scheduler =
        ReminderScheduler::new(TaskService::new(repository.clone()), notifier.clone());
    let first_start = Arc::clone(&start);
    let second_start = Arc::clone(&start);

    let first = std::thread::spawn(move || {
        first_start.wait();
        first_scheduler.run_once(now)
    });
    let second = std::thread::spawn(move || {
        second_start.wait();
        second_scheduler.run_once(now)
    });

    first.join().unwrap().unwrap();
    second.join().unwrap().unwrap();

    assert_eq!(notifier.sent_task_ids(), vec![task.id]);
}

#[derive(Clone, Default)]
struct RecordingNotifier {
    task_ids: Arc<Mutex<Vec<Uuid>>>,
}

impl RecordingNotifier {
    fn sent_task_ids(&self) -> Vec<Uuid> {
        self.task_ids
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

impl ReminderNotifier for RecordingNotifier {
    fn notify(&self, task: &Task) -> Result<(), AppError> {
        self.task_ids
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(task.id);

        Ok(())
    }
}

#[derive(Clone)]
struct DeliveryStateInspectingNotifier {
    repository: SqliteTaskRepository,
    deliveries: Arc<Mutex<Vec<Option<DateTime<Utc>>>>>,
}

impl DeliveryStateInspectingNotifier {
    fn new(repository: SqliteTaskRepository) -> Self {
        Self {
            repository,
            deliveries: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn deliveries_observed_during_notification(&self) -> Vec<Option<DateTime<Utc>>> {
        self.deliveries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

impl ReminderNotifier for DeliveryStateInspectingNotifier {
    fn notify(&self, task: &Task) -> Result<(), AppError> {
        let delivered_at = self
            .repository
            .get(task.id)?
            .and_then(|stored_task| stored_task.reminder_sent_at);
        self.deliveries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(delivered_at);

        Ok(())
    }
}

#[derive(Clone, Default)]
struct FailsOnceNotifier {
    attempts: Arc<AtomicUsize>,
}

impl FailsOnceNotifier {
    fn attempt_count(&self) -> usize {
        self.attempts.load(Ordering::Relaxed)
    }
}

impl ReminderNotifier for FailsOnceNotifier {
    fn notify(&self, _task: &Task) -> Result<(), AppError> {
        let attempt = self.attempts.fetch_add(1, Ordering::Relaxed);

        if attempt == 0 {
            return Err(notification_error());
        }

        Ok(())
    }
}

#[derive(Clone)]
struct SelectiveFailingNotifier {
    failing_task_id: Uuid,
    attempted_task_ids: Arc<Mutex<Vec<Uuid>>>,
}

impl SelectiveFailingNotifier {
    fn new(failing_task_id: Uuid) -> Self {
        Self {
            failing_task_id,
            attempted_task_ids: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn attempted_task_ids(&self) -> Vec<Uuid> {
        self.attempted_task_ids
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

impl ReminderNotifier for SelectiveFailingNotifier {
    fn notify(&self, task: &Task) -> Result<(), AppError> {
        self.attempted_task_ids
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(task.id);

        if task.id == self.failing_task_id {
            return Err(notification_error());
        }

        Ok(())
    }
}

struct ClaimFailingRepository {
    candidate: Task,
    release_attempts: AtomicUsize,
}

struct AcknowledgementFailingRepository {
    repository: SqliteTaskRepository,
    delivery_failures: AtomicUsize,
    release_attempts: AtomicUsize,
}

impl AcknowledgementFailingRepository {
    fn new(repository: SqliteTaskRepository) -> Self {
        Self {
            repository,
            delivery_failures: AtomicUsize::new(1),
            release_attempts: AtomicUsize::new(0),
        }
    }

    fn release_attempt_count(&self) -> usize {
        self.release_attempts.load(Ordering::Relaxed)
    }
}

impl TaskRepository for &AcknowledgementFailingRepository {
    fn insert(&self, task: &Task) -> Result<(), AppError> {
        self.repository.insert(task)
    }

    fn update(
        &self,
        task: &Task,
        expected_revision: i64,
        reminder_claim_state_update: ReminderClaimStateUpdate,
    ) -> Result<(), AppError> {
        self.repository
            .update(task, expected_revision, reminder_claim_state_update)
    }

    fn save_completion(
        &self,
        completion: &TaskCompletion,
        expected_revision: i64,
    ) -> Result<(), AppError> {
        self.repository
            .save_completion(completion, expected_revision)
    }

    fn get(&self, id: Uuid) -> Result<Option<Task>, AppError> {
        self.repository.get(id)
    }

    fn list_inbox(&self) -> Result<Vec<Task>, AppError> {
        self.repository.list_inbox()
    }

    fn list_tasks(&self, view: &TaskView) -> Result<Vec<TaskSummaryDto>, AppError> {
        self.repository.list_tasks(view)
    }

    fn list_due_reminder_candidates(
        &self,
        now: DateTime<Utc>,
        expired_before: DateTime<Utc>,
    ) -> Result<Vec<Task>, AppError> {
        self.repository
            .list_due_reminder_candidates(now, expired_before)
    }

    fn claim_reminder(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        claimed_at: DateTime<Utc>,
        expired_before: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.repository.claim_reminder(
            task_id,
            scheduled_at,
            claimed_at,
            expired_before,
            claim_token,
        )
    }

    fn mark_reminder_delivered(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        delivered_at: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        if self
            .delivery_failures
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err(storage_error());
        }

        self.repository
            .mark_reminder_delivered(task_id, scheduled_at, delivered_at, claim_token)
    }

    fn release_reminder_claim(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.release_attempts.fetch_add(1, Ordering::Relaxed);
        self.repository
            .release_reminder_claim(task_id, scheduled_at, claim_token)
    }
}

impl ClaimFailingRepository {
    fn new(candidate: Task) -> Self {
        Self {
            candidate,
            release_attempts: AtomicUsize::new(0),
        }
    }

    fn release_attempt_count(&self) -> usize {
        self.release_attempts.load(Ordering::Relaxed)
    }
}

impl TaskRepository for &ClaimFailingRepository {
    fn insert(&self, _task: &Task) -> Result<(), AppError> {
        Ok(())
    }

    fn update(
        &self,
        _task: &Task,
        _expected_revision: i64,
        _reminder_claim_state_update: ReminderClaimStateUpdate,
    ) -> Result<(), AppError> {
        Ok(())
    }

    fn save_completion(
        &self,
        _completion: &TaskCompletion,
        _expected_revision: i64,
    ) -> Result<(), AppError> {
        Ok(())
    }

    fn get(&self, _id: Uuid) -> Result<Option<Task>, AppError> {
        Ok(None)
    }

    fn list_inbox(&self) -> Result<Vec<Task>, AppError> {
        Ok(Vec::new())
    }

    fn list_tasks(&self, _view: &TaskView) -> Result<Vec<TaskSummaryDto>, AppError> {
        Ok(Vec::new())
    }

    fn list_due_reminder_candidates(
        &self,
        _now: DateTime<Utc>,
        _expired_before: DateTime<Utc>,
    ) -> Result<Vec<Task>, AppError> {
        Ok(vec![self.candidate.clone()])
    }

    fn claim_reminder(
        &self,
        _task_id: Uuid,
        _scheduled_at: DateTime<Utc>,
        _claimed_at: DateTime<Utc>,
        _expired_before: DateTime<Utc>,
        _claim_token: Uuid,
    ) -> Result<bool, AppError> {
        Err(storage_error())
    }

    fn mark_reminder_delivered(
        &self,
        _task_id: Uuid,
        _scheduled_at: DateTime<Utc>,
        _delivered_at: DateTime<Utc>,
        _claim_token: Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }

    fn release_reminder_claim(
        &self,
        _task_id: Uuid,
        _scheduled_at: DateTime<Utc>,
        _claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.release_attempts.fetch_add(1, Ordering::Relaxed);

        Ok(false)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ReleaseAttempt {
    task_id: Uuid,
    scheduled_at: DateTime<Utc>,
    claim_token: Uuid,
}

#[derive(Clone)]
struct ListCallSynchronization {
    first_call_index: usize,
    first_claim_call_index: usize,
    first_list_started: Arc<Barrier>,
    both_lists_started: Arc<Barrier>,
    second_claim_completed: Arc<Barrier>,
}

struct ReleaseRetryRepository {
    tasks: Vec<Task>,
    claims: Mutex<HashMap<Uuid, Uuid>>,
    claim_tokens: Mutex<Vec<Uuid>>,
    release_attempts: Mutex<Vec<ReleaseAttempt>>,
    release_failures: AtomicUsize,
    candidate_query_failures: AtomicUsize,
    claim_failures: AtomicUsize,
    list_call_count: AtomicUsize,
    claim_call_count: AtomicUsize,
    synchronized_list_query_failure: Mutex<Option<usize>>,
    list_call_synchronization: Mutex<Option<ListCallSynchronization>>,
}

impl ReleaseRetryRepository {
    fn new(task: Task) -> Self {
        Self::new_with_release_failures(task, 1)
    }

    fn new_with_release_failures(task: Task, release_failures: usize) -> Self {
        Self::new_with_tasks_and_release_failures(vec![task], release_failures)
    }

    fn new_with_tasks_and_release_failures(tasks: Vec<Task>, release_failures: usize) -> Self {
        Self {
            tasks,
            claims: Mutex::new(HashMap::new()),
            claim_tokens: Mutex::new(Vec::new()),
            release_attempts: Mutex::new(Vec::new()),
            release_failures: AtomicUsize::new(release_failures),
            candidate_query_failures: AtomicUsize::new(0),
            claim_failures: AtomicUsize::new(0),
            list_call_count: AtomicUsize::new(0),
            claim_call_count: AtomicUsize::new(0),
            synchronized_list_query_failure: Mutex::new(None),
            list_call_synchronization: Mutex::new(None),
        }
    }

    fn claim_token(&self) -> Option<Uuid> {
        let task_id = self.tasks[0].id;
        self.claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&task_id)
            .copied()
    }

    fn claim_tokens(&self) -> Vec<Uuid> {
        self.claim_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn is_claimed(&self) -> bool {
        self.is_task_claimed(self.tasks[0].id)
    }

    fn is_task_claimed(&self, task_id: Uuid) -> bool {
        self.claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains_key(&task_id)
    }

    fn release_tokens(&self) -> Vec<Uuid> {
        self.release_attempts()
            .into_iter()
            .map(|attempt| attempt.claim_token)
            .collect()
    }

    fn release_attempts(&self) -> Vec<ReleaseAttempt> {
        self.release_attempts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn replace_claim(&self, claim_token: Uuid) {
        self.claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(self.tasks[0].id, claim_token);
    }

    fn fail_next_candidate_queries(&self, count: usize) {
        self.candidate_query_failures
            .fetch_add(count, Ordering::Relaxed);
    }

    fn fail_next_claims(&self, count: usize) {
        self.claim_failures.fetch_add(count, Ordering::Relaxed);
    }

    fn synchronize_next_two_list_calls(
        &self,
        first_list_started: Arc<Barrier>,
        both_lists_started: Arc<Barrier>,
    ) {
        let first_call_index = self.list_call_count.load(Ordering::Relaxed) + 1;
        let first_claim_call_index = self.claim_call_count.load(Ordering::Relaxed) + 1;
        *self
            .list_call_synchronization
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(ListCallSynchronization {
            first_call_index,
            first_claim_call_index,
            first_list_started,
            both_lists_started,
            second_claim_completed: Arc::new(Barrier::new(2)),
        });
    }

    fn fail_next_synchronized_candidate_query(&self) {
        *self
            .synchronized_list_query_failure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some(self.list_call_count.load(Ordering::Relaxed) + 1);
    }
}

impl TaskRepository for &ReleaseRetryRepository {
    fn insert(&self, _task: &Task) -> Result<(), AppError> {
        Ok(())
    }

    fn update(
        &self,
        _task: &Task,
        _expected_revision: i64,
        _reminder_claim_state_update: ReminderClaimStateUpdate,
    ) -> Result<(), AppError> {
        Ok(())
    }

    fn save_completion(
        &self,
        _completion: &TaskCompletion,
        _expected_revision: i64,
    ) -> Result<(), AppError> {
        Ok(())
    }

    fn get(&self, _id: Uuid) -> Result<Option<Task>, AppError> {
        Ok(None)
    }

    fn list_inbox(&self) -> Result<Vec<Task>, AppError> {
        Ok(Vec::new())
    }

    fn list_tasks(&self, _view: &TaskView) -> Result<Vec<TaskSummaryDto>, AppError> {
        Ok(Vec::new())
    }

    fn list_due_reminder_candidates(
        &self,
        _now: DateTime<Utc>,
        _expired_before: DateTime<Utc>,
    ) -> Result<Vec<Task>, AppError> {
        let list_call_index = self.list_call_count.fetch_add(1, Ordering::Relaxed) + 1;
        let synchronization = self
            .list_call_synchronization
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Some(synchronization) = synchronization {
            if list_call_index == synchronization.first_call_index {
                synchronization.first_list_started.wait();
            }
            if (synchronization.first_call_index..=synchronization.first_call_index + 1)
                .contains(&list_call_index)
            {
                synchronization.both_lists_started.wait();
            }
            if list_call_index == synchronization.first_call_index {
                synchronization.second_claim_completed.wait();
            }
        }

        if *self
            .synchronized_list_query_failure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            == Some(list_call_index)
        {
            return Err(candidate_query_error());
        }
        if self
            .candidate_query_failures
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err(candidate_query_error());
        }

        Ok(self.tasks.clone())
    }

    fn claim_reminder(
        &self,
        task_id: Uuid,
        _scheduled_at: DateTime<Utc>,
        _claimed_at: DateTime<Utc>,
        _expired_before: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        let claim_call_index = self.claim_call_count.fetch_add(1, Ordering::Relaxed) + 1;
        if self
            .claim_failures
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err(claim_error());
        }

        let claimed = {
            let mut claims = self
                .claims
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if claims.contains_key(&task_id) {
                false
            } else {
                claims.insert(task_id, claim_token);
                self.claim_tokens
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .push(claim_token);
                true
            }
        };
        let synchronization = self
            .list_call_synchronization
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Some(synchronization) = synchronization {
            if claim_call_index == synchronization.first_claim_call_index {
                synchronization.second_claim_completed.wait();
            }
        }

        Ok(claimed)
    }

    fn mark_reminder_delivered(
        &self,
        task_id: Uuid,
        _scheduled_at: DateTime<Utc>,
        _delivered_at: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        let mut claims = self
            .claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if claims.get(&task_id).copied() != Some(claim_token) {
            return Ok(false);
        }

        claims.remove(&task_id);

        Ok(true)
    }

    fn release_reminder_claim(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.release_attempts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(ReleaseAttempt {
                task_id,
                scheduled_at,
                claim_token,
            });
        if self
            .release_failures
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err(storage_error());
        }

        let mut claims = self
            .claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if claims.get(&task_id).copied() != Some(claim_token) {
            return Ok(false);
        }

        claims.remove(&task_id);

        Ok(true)
    }
}

fn fixed_utc(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, hour, minute, second)
        .single()
        .unwrap()
}

fn notification_error() -> AppError {
    AppError::new(
        "reminder.notification.failed",
        "errors.reminder.notification.failed",
        AppErrorKind::Validation,
    )
}

fn candidate_query_error() -> AppError {
    AppError::new(
        "reminder.candidates.failed",
        "errors.reminder.candidates.failed",
        AppErrorKind::Storage,
    )
}

fn claim_error() -> AppError {
    AppError::new(
        "reminder.claim.failed",
        "errors.reminder.claim.failed",
        AppErrorKind::Storage,
    )
}

fn storage_error() -> AppError {
    AppError::new(
        "storage.unavailable",
        "errors.storage.unavailable",
        AppErrorKind::Storage,
    )
}
