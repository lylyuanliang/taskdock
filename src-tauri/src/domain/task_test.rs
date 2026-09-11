use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Barrier, Mutex,
};
use std::thread;

use chrono::{TimeZone, Utc};
use uuid::Uuid;

use crate::{
    domain::{
        ports::{ProjectRepository, TaskRepository},
        project::Project,
        recurrence::{Frequency, RecurrenceRule},
        reminders::{ReminderNotifier, ReminderScheduler},
        task::{Priority, ReminderClaimStateUpdate, Task, TaskDraft, TaskPatch},
        task_service::TaskService,
    },
    error::AppError,
    infrastructure::sqlite::SqliteTaskRepository,
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
fn task_service_completes_a_non_recurring_task_without_creating_another_instance() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task = Task::for_test("Prepare release".into());
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    let completion = service.complete(task.id).unwrap().unwrap();

    assert_eq!(completion.next_task, None);
    assert!(completion.completed_task.completed_at.is_some());
    assert_eq!(
        repository.get(task.id).unwrap(),
        Some(completion.completed_task)
    );
    assert!(repository.list_inbox().unwrap().is_empty());
}

#[test]
fn task_service_parent_project_patch_updates_direct_subtask_project_and_revision() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let project_a = Project::new("Project A".into()).unwrap();
    let project_b = Project::new("Project B".into()).unwrap();
    repository.insert_project(&project_a).unwrap();
    repository.insert_project(&project_b).unwrap();
    let mut parent = Task::for_test("Parent".into());
    parent.project_id = Some(project_a.id);
    repository.insert(&parent).unwrap();
    let service = TaskService::new(repository.clone());
    let child = service.create_subtask(parent.id, "Child".into()).unwrap();

    let updated_parent = service
        .patch(
            parent.id,
            TaskPatch {
                project_id: Some(Some(project_b.id)),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
    let persisted_parent = repository.get(parent.id).unwrap().unwrap();
    let persisted_child = repository.get(child.id).unwrap().unwrap();

    assert_eq!(updated_parent.project_id, Some(project_b.id));
    assert_eq!(persisted_parent.project_id, Some(project_b.id));
    assert_eq!(persisted_child.project_id, Some(project_b.id));
    assert_eq!(persisted_child.revision, child.revision + 1);
}

#[test]
fn task_service_editor_parent_project_patch_updates_direct_subtasks_and_tags() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let project_a = Project::new("Project A".into()).unwrap();
    let project_b = Project::new("Project B".into()).unwrap();
    repository.insert_project(&project_a).unwrap();
    repository.insert_project(&project_b).unwrap();
    let service = TaskService::new(repository.clone());
    let mut draft = TaskDraft::new("Parent".into()).unwrap();
    draft.project_id = Some(project_a.id);
    let parent = service
        .create_editor(draft, vec!["initial".into()])
        .unwrap()
        .task;
    let child = service.create_subtask(parent.id, "Child".into()).unwrap();

    let updated_editor = service
        .update_editor(
            parent.id,
            parent.revision,
            TaskPatch {
                project_id: Some(Some(project_b.id)),
                ..Default::default()
            },
            Some(vec!["release".into()]),
        )
        .unwrap()
        .unwrap();
    let persisted_parent = repository.get(parent.id).unwrap().unwrap();
    let persisted_child = repository.get(child.id).unwrap().unwrap();

    assert_eq!(persisted_parent.project_id, Some(project_b.id));
    assert_eq!(persisted_child.project_id, Some(project_b.id));
    assert_eq!(persisted_child.revision, child.revision + 1);
    assert_eq!(updated_editor.tag_names, vec!["release"]);
    assert_eq!(updated_editor.subtasks, vec![persisted_child]);
}

#[test]
fn task_service_same_parent_project_patch_leaves_direct_subtasks_unchanged() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let project = Project::new("Project".into()).unwrap();
    repository.insert_project(&project).unwrap();
    let mut parent = Task::for_test("Parent".into());
    parent.project_id = Some(project.id);
    repository.insert(&parent).unwrap();
    let service = TaskService::new(repository.clone());
    let child = service.create_subtask(parent.id, "Child".into()).unwrap();

    service
        .patch(
            parent.id,
            TaskPatch {
                project_id: Some(Some(project.id)),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
    let persisted_child = repository.get(child.id).unwrap().unwrap();

    assert_eq!(persisted_child.revision, child.revision);
    assert_eq!(persisted_child.updated_at, child.updated_at);
}

#[test]
fn task_service_parent_project_patch_rolls_back_when_subtask_sync_fails() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let project_a = Project::new("Project A".into()).unwrap();
    let project_b = Project::new("Project B".into()).unwrap();
    repository.insert_project(&project_a).unwrap();
    repository.insert_project(&project_b).unwrap();
    let mut parent = Task::for_test("Parent".into());
    parent.project_id = Some(project_a.id);
    repository.insert(&parent).unwrap();
    let service = TaskService::new(repository.clone());
    let first_child = service
        .create_subtask(parent.id, "First child".into())
        .unwrap();
    let second_child = service
        .create_subtask(parent.id, "Second child".into())
        .unwrap();
    repository
        .fail_subtask_project_update_for_test(second_child.id)
        .unwrap();

    let error = service
        .patch(
            parent.id,
            TaskPatch {
                project_id: Some(Some(project_b.id)),
                ..Default::default()
            },
        )
        .unwrap_err();

    assert_eq!(error.code(), "storage.unavailable");
    assert_eq!(repository.get(parent.id).unwrap(), Some(parent));
    assert_eq!(repository.get(first_child.id).unwrap(), Some(first_child));
    assert_eq!(repository.get(second_child.id).unwrap(), Some(second_child));
}

#[test]
fn task_service_pre_update_validation_rejects_a_patch_after_its_snapshot_becomes_stale() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let first_project_id = Uuid::new_v4();
    let second_project_id = Uuid::new_v4();
    let mut task = Task::for_test("Publish notes".into());
    task.project_id = Some(first_project_id);
    repository.insert(&task).unwrap();
    let barrier_repository = ReadBarrierSqliteTaskRepository::new(repository.clone(), task.id);

    thread::scope(|scope| {
        let stale_patch = scope.spawn(|| {
            TaskService::new(&barrier_repository).patch_with_pre_update_validation(
                task.id,
                TaskPatch {
                    project_id: Some(Some(first_project_id)),
                    title: Some("Stale edit".into()),
                    ..Default::default()
                },
                |_, _| Ok(()),
            )
        });

        barrier_repository.wait_until_read();
        TaskService::new(repository.clone())
            .patch(
                task.id,
                TaskPatch {
                    project_id: Some(Some(second_project_id)),
                    ..Default::default()
                },
            )
            .unwrap();
        barrier_repository.resume_after_interleaving();

        assert_eq!(
            stale_patch.join().unwrap().unwrap_err().code(),
            "task.concurrent_update"
        );
    });

    let persisted = repository.get(task.id).unwrap().unwrap();
    assert_eq!(persisted.project_id, Some(second_project_id));
    assert_eq!(persisted.title, "Publish notes");
}

#[test]
fn task_service_completes_a_recurring_task_and_persists_its_next_instance() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Review weekly release".into());
    task.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    task.recurrence = Some(RecurrenceRule::new(Frequency::Weekly, 1, None, None).unwrap());
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    let completion = service.complete(task.id).unwrap().unwrap();
    let completed_task = completion.completed_task;
    let next_task = completion.next_task.unwrap();

    assert!(completed_task.completed_at.is_some());
    assert_eq!(next_task.scheduled_at, Some(fixed_utc(2026, 9, 2, 9, 0, 0)));
    assert_eq!(next_task.completed_at, None);
    assert_eq!(next_task.instance_number, 2);
    assert_eq!(repository.get(task.id).unwrap(), Some(completed_task));
    assert_eq!(
        repository.get(next_task.id).unwrap(),
        Some(next_task.clone())
    );
    assert_eq!(repository.list_inbox().unwrap(), vec![next_task]);
}

#[test]
fn task_service_rejects_completing_the_same_recurring_instance_twice() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Review weekly release".into());
    task.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    task.recurrence = Some(RecurrenceRule::new(Frequency::Weekly, 1, None, None).unwrap());
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    let first_completion = service.complete(task.id).unwrap().unwrap();
    let error = service.complete(task.id).unwrap_err();

    assert_eq!(error.code(), "task.already_completed");
    assert_eq!(
        repository.list_inbox().unwrap(),
        vec![first_completion.next_task.unwrap()]
    );
}

#[test]
fn task_service_rejects_completing_a_task_through_the_general_patch_path() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task = Task::for_test("Prepare release".into());
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    let error = service
        .patch(
            task.id,
            TaskPatch {
                completed_at: Some(Some(fixed_utc(2026, 8, 26, 10, 0, 0))),
                ..Default::default()
            },
        )
        .unwrap_err();

    assert_eq!(error.code(), "task.completion.use_complete");
    assert_eq!(repository.get(task.id).unwrap(), Some(task));
}

#[test]
fn task_service_rejects_restoring_a_completed_recurring_instance_and_preserves_its_next_instance() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Review weekly release".into());
    task.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    task.recurrence = Some(RecurrenceRule::new(Frequency::Weekly, 1, None, None).unwrap());
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    let completion = service.complete(task.id).unwrap().unwrap();
    let completed_task = completion.completed_task;
    let next_task = completion.next_task.unwrap();

    let error = service
        .patch(
            task.id,
            TaskPatch {
                completed_at: Some(None),
                ..Default::default()
            },
        )
        .unwrap_err();

    assert_eq!(error.code(), "task.recurrence.restore.unsupported");
    assert_eq!(repository.get(task.id).unwrap(), Some(completed_task));
    assert_eq!(
        repository.get(next_task.id).unwrap(),
        Some(next_task.clone())
    );
    assert_eq!(repository.list_inbox().unwrap(), vec![next_task]);
}

#[test]
fn stale_patch_cannot_reopen_a_recurring_task_completed_after_the_patch_read() {
    let sqlite_repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Review weekly release".into());
    task.scheduled_at = Some(fixed_utc(2026, 8, 26, 9, 0, 0));
    task.recurrence = Some(RecurrenceRule::new(Frequency::Weekly, 1, None, None).unwrap());
    sqlite_repository.insert(&task).unwrap();
    let repository = ReadBarrierSqliteTaskRepository::new(sqlite_repository.clone(), task.id);

    let error = std::thread::scope(|scope| {
        let patch = scope.spawn(|| {
            TaskService::new(&repository).patch(
                task.id,
                TaskPatch {
                    note: Some("Publish the final review".into()),
                    ..Default::default()
                },
            )
        });
        repository.wait_until_read();
        let completion = TaskService::new(sqlite_repository.clone()).complete(task.id);
        repository.resume_after_interleaving();
        completion.unwrap();

        patch.join().unwrap().unwrap_err()
    });

    assert_eq!(error.code(), "task.concurrent_update");
    assert_eq!(error.translation_key(), "errors.task.concurrent_update");
    let completed_task = sqlite_repository.get(task.id).unwrap().unwrap();
    assert!(completed_task.completed_at.is_some());
    assert_eq!(completed_task.note, task.note);
    let next_tasks = sqlite_repository.list_inbox().unwrap();
    assert_eq!(next_tasks.len(), 1);
    assert_eq!(next_tasks[0].instance_number, 2);
    assert_eq!(next_tasks[0].completed_at, None);
}

#[test]
fn stale_patch_cannot_reopen_a_non_recurring_task_completed_after_the_patch_read() {
    let sqlite_repository = SqliteTaskRepository::in_memory().unwrap();
    let task = Task::for_test("Prepare release".into());
    sqlite_repository.insert(&task).unwrap();
    let repository = ReadBarrierSqliteTaskRepository::new(sqlite_repository.clone(), task.id);

    let error = std::thread::scope(|scope| {
        let patch = scope.spawn(|| {
            TaskService::new(&repository).patch(
                task.id,
                TaskPatch {
                    note: Some("Publish the final review".into()),
                    ..Default::default()
                },
            )
        });
        repository.wait_until_read();
        let completion = TaskService::new(sqlite_repository.clone()).complete(task.id);
        repository.resume_after_interleaving();
        completion.unwrap();

        patch.join().unwrap().unwrap_err()
    });

    assert_eq!(error.code(), "task.concurrent_update");
    let completed_task = sqlite_repository.get(task.id).unwrap().unwrap();
    assert!(completed_task.completed_at.is_some());
    assert_eq!(completed_task.note, task.note);
    assert!(sqlite_repository.list_inbox().unwrap().is_empty());
}

#[test]
fn stale_completion_cannot_finish_an_updated_non_recurring_task_snapshot() {
    let sqlite_repository = SqliteTaskRepository::in_memory().unwrap();
    let task = Task::for_test("Prepare release".into());
    sqlite_repository.insert(&task).unwrap();
    let repository = ReadBarrierSqliteTaskRepository::new(sqlite_repository.clone(), task.id);

    let error = std::thread::scope(|scope| {
        let completion = scope.spawn(|| TaskService::new(&repository).complete(task.id));
        repository.wait_until_read();
        let patch = TaskService::new(sqlite_repository.clone()).patch(
            task.id,
            TaskPatch {
                note: Some("Use the updated checklist".into()),
                ..Default::default()
            },
        );
        repository.resume_after_interleaving();
        patch.unwrap();

        completion.join().unwrap().unwrap_err()
    });

    assert_eq!(error.code(), "task.concurrent_update");
    let persisted_task = sqlite_repository.get(task.id).unwrap().unwrap();
    assert_eq!(persisted_task.completed_at, None);
    assert_eq!(persisted_task.note, "Use the updated checklist");
}

#[test]
fn stale_restore_cannot_overwrite_an_updated_completed_task_snapshot() {
    let sqlite_repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Prepare release".into());
    task.completed_at = Some(fixed_utc(2026, 9, 8, 10, 0, 0));
    sqlite_repository.insert(&task).unwrap();
    let repository = ReadBarrierSqliteTaskRepository::new(sqlite_repository.clone(), task.id);

    let error = std::thread::scope(|scope| {
        let restore = scope.spawn(|| {
            TaskService::new(&repository).patch(
                task.id,
                TaskPatch {
                    completed_at: Some(None),
                    ..Default::default()
                },
            )
        });
        repository.wait_until_read();
        let patch = TaskService::new(sqlite_repository.clone()).patch(
            task.id,
            TaskPatch {
                note: Some("Keep this completed-task edit".into()),
                ..Default::default()
            },
        );
        repository.resume_after_interleaving();
        patch.unwrap();

        restore.join().unwrap().unwrap_err()
    });

    assert_eq!(error.code(), "task.concurrent_update");
    let persisted_task = sqlite_repository.get(task.id).unwrap().unwrap();
    assert!(persisted_task.completed_at.is_some());
    assert_eq!(persisted_task.note, "Keep this completed-task edit");
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
fn patching_a_schedule_clears_an_existing_reminder_marker() {
    let mut task = Task::for_test("Draft API".into());
    task.scheduled_at = Some(fixed_utc(2026, 9, 8, 9, 0, 0));
    task.reminder_sent_at = Some(fixed_utc(2026, 9, 8, 8, 45, 0));

    let patched = task
        .apply_patch(TaskPatch {
            scheduled_at: Some(Some(fixed_utc(2026, 9, 9, 9, 0, 0))),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(patched.reminder_sent_at, None);
}

#[test]
fn patching_with_the_same_schedule_preserves_an_existing_reminder_marker() {
    let mut task = Task::for_test("Draft API".into());
    let scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let reminder_sent_at = fixed_utc(2026, 9, 8, 8, 45, 0);
    task.scheduled_at = Some(scheduled_at);
    task.reminder_sent_at = Some(reminder_sent_at);

    let patched = task
        .apply_patch(TaskPatch {
            scheduled_at: Some(Some(scheduled_at)),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(patched.reminder_sent_at, Some(reminder_sent_at));
}

#[test]
fn restoring_a_completed_non_recurring_task_clears_an_existing_reminder_marker() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Prepare release".into());
    task.completed_at = Some(fixed_utc(2026, 9, 8, 10, 0, 0));
    task.reminder_sent_at = Some(fixed_utc(2026, 9, 8, 8, 45, 0));
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    let restored = service
        .patch(
            task.id,
            TaskPatch {
                completed_at: Some(None),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();

    assert_eq!(restored.completed_at, None);
    assert_eq!(restored.reminder_sent_at, None);
    assert_eq!(repository.get(task.id).unwrap(), Some(restored));
}

#[test]
fn task_service_stale_schedule_patch_conflicts_without_clearing_the_scheduler_claim() {
    let initial_scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let rescheduled_at = fixed_utc(2026, 9, 8, 10, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 10, 0, 5);
    let mut task = Task::for_test("Prepare release".into());
    task.scheduled_at = Some(initial_scheduled_at);
    let sqlite_repository = SqliteTaskRepository::in_memory().unwrap();
    sqlite_repository.insert(&task).unwrap();
    let repository = InterleavingSqliteTaskRepository::new(
        sqlite_repository.clone(),
        task.id,
        rescheduled_at,
        claimed_at,
    );
    let service = TaskService::new(&repository);

    let error = service
        .patch(
            task.id,
            TaskPatch {
                scheduled_at: Some(Some(rescheduled_at)),
                ..Default::default()
            },
        )
        .unwrap_err();

    assert_eq!(error.code(), "task.concurrent_update");
    assert_eq!(
        sqlite_repository
            .get(task.id)
            .unwrap()
            .unwrap()
            .reminder_sent_at,
        Some(claimed_at)
    );
    let claim_token = repository.claim_token();
    assert!(!sqlite_repository
        .release_reminder_claim(task.id, rescheduled_at, claim_token)
        .unwrap());
}

#[test]
fn task_service_content_patch_preserves_a_reminder_claim_created_after_its_read() {
    let scheduled_at = fixed_utc(2026, 9, 8, 10, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 10, 0, 5);
    let claim_token = Uuid::new_v4();
    let mut task = Task::for_test("Prepare release".into());
    task.scheduled_at = Some(scheduled_at);
    let sqlite_repository = SqliteTaskRepository::in_memory().unwrap();
    sqlite_repository.insert(&task).unwrap();
    let repository = ReadBarrierSqliteTaskRepository::new(sqlite_repository.clone(), task.id);

    let patched = std::thread::scope(|scope| {
        let patch = scope.spawn(|| {
            TaskService::new(&repository).patch(
                task.id,
                TaskPatch {
                    note: Some("Notify the release channel".into()),
                    ..Default::default()
                },
            )
        });
        repository.wait_until_read();
        let claimed = sqlite_repository.claim_reminder(
            task.id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            claim_token,
        );
        repository.resume_after_interleaving();
        assert!(claimed.unwrap());

        patch.join().unwrap().unwrap().unwrap()
    });

    assert_eq!(patched.note, "Notify the release channel");
    assert_eq!(
        sqlite_repository
            .get(task.id)
            .unwrap()
            .unwrap()
            .reminder_sent_at,
        None
    );
    assert!(sqlite_repository
        .release_reminder_claim(task.id, scheduled_at, claim_token)
        .unwrap());
}

#[test]
fn task_service_schedule_patch_clears_an_existing_reminder_marker_and_token() {
    let initial_scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let rescheduled_at = fixed_utc(2026, 9, 8, 10, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 9, 0, 5);
    let claim_token = Uuid::new_v4();
    let mut task = Task::for_test("Prepare release".into());
    task.scheduled_at = Some(initial_scheduled_at);
    let repository = SqliteTaskRepository::in_memory().unwrap();
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    assert!(service
        .claim_reminder(
            task.id,
            initial_scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            claim_token,
        )
        .unwrap());
    service
        .patch(
            task.id,
            TaskPatch {
                scheduled_at: Some(Some(rescheduled_at)),
                ..Default::default()
            },
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
fn task_service_schedule_patch_from_none_to_some_clears_an_existing_reminder_marker() {
    let mut task = Task::for_test("Prepare release".into());
    task.reminder_sent_at = Some(fixed_utc(2026, 9, 8, 9, 0, 5));
    let repository = SqliteTaskRepository::in_memory().unwrap();
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    service
        .patch(
            task.id,
            TaskPatch {
                scheduled_at: Some(Some(fixed_utc(2026, 9, 8, 10, 0, 0))),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        None
    );
}

#[test]
fn task_service_schedule_patch_from_some_to_none_clears_an_existing_reminder_marker() {
    let scheduled_at = fixed_utc(2026, 9, 8, 9, 0, 0);
    let claimed_at = fixed_utc(2026, 9, 8, 9, 0, 5);
    let claim_token = Uuid::new_v4();
    let mut task = Task::for_test("Prepare release".into());
    task.scheduled_at = Some(scheduled_at);
    let repository = SqliteTaskRepository::in_memory().unwrap();
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    assert!(service
        .claim_reminder(
            task.id,
            scheduled_at,
            claimed_at,
            claimed_at - chrono::Duration::minutes(2),
            claim_token,
        )
        .unwrap());
    service
        .patch(
            task.id,
            TaskPatch {
                scheduled_at: Some(None),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        None
    );
    assert!(!repository
        .release_reminder_claim(task.id, scheduled_at, claim_token)
        .unwrap());
}

#[test]
fn task_service_schedule_patch_from_none_to_none_preserves_an_existing_reminder_marker() {
    let reminder_sent_at = fixed_utc(2026, 9, 8, 9, 0, 5);
    let mut task = Task::for_test("Prepare release".into());
    task.reminder_sent_at = Some(reminder_sent_at);
    let repository = SqliteTaskRepository::in_memory().unwrap();
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    service
        .patch(
            task.id,
            TaskPatch {
                scheduled_at: Some(None),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(
        repository.get(task.id).unwrap().unwrap().reminder_sent_at,
        Some(reminder_sent_at)
    );
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
fn patch_accepts_an_explicitly_unchanged_legacy_yearly_rule() {
    let mut task = Task::for_test("Renew certificate".into());
    task.scheduled_at = Some(fixed_utc(2026, 2, 28, 9, 0, 0));
    task.recurrence = Some(legacy_yearly_rule());
    task.monthly_anchor_day = Some(29);

    let patched = task
        .apply_patch(TaskPatch {
            note: Some("Keep legacy schedule".into()),
            recurrence: Some(task.recurrence.clone()),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(patched.recurrence, task.recurrence);
    assert_eq!(patched.monthly_anchor_day, Some(29));
}

#[test]
fn patch_rejects_a_changed_legacy_yearly_rule() {
    let mut task = Task::for_test("Renew certificate".into());
    task.scheduled_at = Some(fixed_utc(2026, 2, 28, 9, 0, 0));
    task.recurrence = Some(legacy_yearly_rule());

    let changed_yearly_rule =
        serde_json::from_str(r#"{"frequency":"yearly","interval":2,"until":null,"count":null}"#)
            .unwrap();
    let error = task
        .apply_patch(TaskPatch {
            recurrence: Some(Some(changed_yearly_rule)),
            ..Default::default()
        })
        .unwrap_err();

    assert_eq!(error.code(), "recurrence.frequency.unsupported");
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

struct InterleavingSqliteTaskRepository {
    repository: SqliteTaskRepository,
    task_id: Uuid,
    rescheduled_at: chrono::DateTime<chrono::Utc>,
    claimed_at: chrono::DateTime<chrono::Utc>,
    claimed_tokens: Arc<Mutex<Vec<Uuid>>>,
    has_interleaved: AtomicUsize,
}

struct ReadBarrierSqliteTaskRepository {
    repository: SqliteTaskRepository,
    task_id: Uuid,
    read_count: AtomicUsize,
    task_was_read: Barrier,
    resume_read: Barrier,
}

impl ReadBarrierSqliteTaskRepository {
    fn new(repository: SqliteTaskRepository, task_id: Uuid) -> Self {
        Self {
            repository,
            task_id,
            read_count: AtomicUsize::new(0),
            task_was_read: Barrier::new(2),
            resume_read: Barrier::new(2),
        }
    }

    fn wait_until_read(&self) {
        self.task_was_read.wait();
    }

    fn resume_after_interleaving(&self) {
        self.resume_read.wait();
    }
}

impl TaskRepository for &ReadBarrierSqliteTaskRepository {
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
        completion: &crate::domain::recurrence::TaskCompletion,
        expected_revision: i64,
    ) -> Result<(), AppError> {
        self.repository
            .save_completion(completion, expected_revision)
    }

    fn get(&self, id: Uuid) -> Result<Option<Task>, AppError> {
        let task = self.repository.get(id)?;
        if id == self.task_id && self.read_count.fetch_add(1, Ordering::Relaxed) == 0 {
            self.task_was_read.wait();
            self.resume_read.wait();
        }

        Ok(task)
    }

    fn list_inbox(&self) -> Result<Vec<Task>, AppError> {
        self.repository.list_inbox()
    }

    fn list_tasks(
        &self,
        view: &crate::domain::task_query::TaskView,
    ) -> Result<Vec<crate::domain::task_query::TaskSummaryDto>, AppError> {
        self.repository.list_tasks(view)
    }

    fn list_due_reminder_candidates(
        &self,
        now: chrono::DateTime<chrono::Utc>,
        expired_before: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<Task>, AppError> {
        self.repository
            .list_due_reminder_candidates(now, expired_before)
    }

    fn claim_reminder(
        &self,
        task_id: Uuid,
        scheduled_at: chrono::DateTime<chrono::Utc>,
        claimed_at: chrono::DateTime<chrono::Utc>,
        expired_before: chrono::DateTime<chrono::Utc>,
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
        scheduled_at: chrono::DateTime<chrono::Utc>,
        delivered_at: chrono::DateTime<chrono::Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.repository
            .mark_reminder_delivered(task_id, scheduled_at, delivered_at, claim_token)
    }

    fn release_reminder_claim(
        &self,
        task_id: Uuid,
        scheduled_at: chrono::DateTime<chrono::Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.repository
            .release_reminder_claim(task_id, scheduled_at, claim_token)
    }
}

impl InterleavingSqliteTaskRepository {
    fn new(
        repository: SqliteTaskRepository,
        task_id: Uuid,
        rescheduled_at: chrono::DateTime<chrono::Utc>,
        claimed_at: chrono::DateTime<chrono::Utc>,
    ) -> Self {
        Self {
            repository,
            task_id,
            rescheduled_at,
            claimed_at,
            claimed_tokens: Arc::new(Mutex::new(Vec::new())),
            has_interleaved: AtomicUsize::new(0),
        }
    }

    fn claim_token(&self) -> Uuid {
        let tokens = self
            .claimed_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        assert_eq!(tokens.len(), 1);
        tokens[0]
    }
}

impl TaskRepository for &InterleavingSqliteTaskRepository {
    fn insert(&self, task: &Task) -> Result<(), AppError> {
        self.repository.insert(task)
    }

    fn update(
        &self,
        task: &Task,
        expected_revision: i64,
        reminder_claim_state_update: ReminderClaimStateUpdate,
    ) -> Result<(), AppError> {
        if self.has_interleaved.fetch_add(1, Ordering::Relaxed) == 0 {
            let concurrent_service = TaskService::new(self.repository.clone());
            concurrent_service.patch(
                self.task_id,
                TaskPatch {
                    scheduled_at: Some(Some(self.rescheduled_at)),
                    ..Default::default()
                },
            )?;
            let scheduler_repository = ClaimCapturingSqliteTaskRepository::new(
                self.repository.clone(),
                Arc::clone(&self.claimed_tokens),
            );
            let scheduler =
                ReminderScheduler::new(TaskService::new(&scheduler_repository), SuccessfulNotifier);

            scheduler.run_once(self.claimed_at)?;
        }

        self.repository
            .update(task, expected_revision, reminder_claim_state_update)
    }

    fn save_completion(
        &self,
        _completion: &crate::domain::recurrence::TaskCompletion,
        _expected_revision: i64,
    ) -> Result<(), AppError> {
        Ok(())
    }

    fn get(&self, id: Uuid) -> Result<Option<Task>, AppError> {
        self.repository.get(id)
    }

    fn list_inbox(&self) -> Result<Vec<Task>, AppError> {
        self.repository.list_inbox()
    }

    fn list_tasks(
        &self,
        _view: &crate::domain::task_query::TaskView,
    ) -> Result<Vec<crate::domain::task_query::TaskSummaryDto>, AppError> {
        self.repository.list_tasks(_view)
    }

    fn list_due_reminder_candidates(
        &self,
        _now: chrono::DateTime<chrono::Utc>,
        _expired_before: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<Task>, AppError> {
        self.repository
            .list_due_reminder_candidates(_now, _expired_before)
    }

    fn claim_reminder(
        &self,
        _task_id: Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _claimed_at: chrono::DateTime<chrono::Utc>,
        _expired_before: chrono::DateTime<chrono::Utc>,
        _claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.repository.claim_reminder(
            _task_id,
            _scheduled_at,
            _claimed_at,
            _expired_before,
            _claim_token,
        )
    }

    fn mark_reminder_delivered(
        &self,
        _task_id: Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _delivered_at: chrono::DateTime<chrono::Utc>,
        _claim_token: Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }

    fn release_reminder_claim(
        &self,
        _task_id: Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.repository
            .release_reminder_claim(_task_id, _scheduled_at, _claim_token)
    }
}

struct ClaimCapturingSqliteTaskRepository {
    repository: SqliteTaskRepository,
    claimed_tokens: Arc<Mutex<Vec<Uuid>>>,
}

impl ClaimCapturingSqliteTaskRepository {
    fn new(repository: SqliteTaskRepository, claimed_tokens: Arc<Mutex<Vec<Uuid>>>) -> Self {
        Self {
            repository,
            claimed_tokens,
        }
    }
}

impl TaskRepository for &ClaimCapturingSqliteTaskRepository {
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
        completion: &crate::domain::recurrence::TaskCompletion,
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

    fn list_tasks(
        &self,
        view: &crate::domain::task_query::TaskView,
    ) -> Result<Vec<crate::domain::task_query::TaskSummaryDto>, AppError> {
        self.repository.list_tasks(view)
    }

    fn list_due_reminder_candidates(
        &self,
        now: chrono::DateTime<chrono::Utc>,
        expired_before: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<Task>, AppError> {
        self.repository
            .list_due_reminder_candidates(now, expired_before)
    }

    fn claim_reminder(
        &self,
        task_id: Uuid,
        scheduled_at: chrono::DateTime<chrono::Utc>,
        claimed_at: chrono::DateTime<chrono::Utc>,
        expired_before: chrono::DateTime<chrono::Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        let claimed = self.repository.claim_reminder(
            task_id,
            scheduled_at,
            claimed_at,
            expired_before,
            claim_token,
        )?;

        if claimed {
            self.claimed_tokens
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(claim_token);
        }

        Ok(claimed)
    }

    fn mark_reminder_delivered(
        &self,
        task_id: Uuid,
        scheduled_at: chrono::DateTime<chrono::Utc>,
        delivered_at: chrono::DateTime<chrono::Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.repository
            .mark_reminder_delivered(task_id, scheduled_at, delivered_at, claim_token)
    }

    fn release_reminder_claim(
        &self,
        task_id: Uuid,
        scheduled_at: chrono::DateTime<chrono::Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.repository
            .release_reminder_claim(task_id, scheduled_at, claim_token)
    }
}

struct SuccessfulNotifier;

impl ReminderNotifier for SuccessfulNotifier {
    fn notify(&self, _task: &Task) -> Result<(), AppError> {
        Ok(())
    }
}

impl TaskRepository for &CountingRepository {
    fn insert(&self, _task: &Task) -> Result<(), AppError> {
        self.insert_count.fetch_add(1, Ordering::Relaxed);

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
        _completion: &crate::domain::recurrence::TaskCompletion,
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

    fn list_tasks(
        &self,
        _view: &crate::domain::task_query::TaskView,
    ) -> Result<Vec<crate::domain::task_query::TaskSummaryDto>, AppError> {
        Ok(Vec::new())
    }

    fn list_due_reminder_candidates(
        &self,
        _now: chrono::DateTime<chrono::Utc>,
        _expired_before: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<Task>, AppError> {
        Ok(Vec::new())
    }

    fn claim_reminder(
        &self,
        _task_id: Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _claimed_at: chrono::DateTime<chrono::Utc>,
        _expired_before: chrono::DateTime<chrono::Utc>,
        _claim_token: Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }

    fn mark_reminder_delivered(
        &self,
        _task_id: Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _delivered_at: chrono::DateTime<chrono::Utc>,
        _claim_token: Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }

    fn release_reminder_claim(
        &self,
        _task_id: Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _claim_token: Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }
}
