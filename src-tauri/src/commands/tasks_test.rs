use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

use chrono::{TimeZone, Utc};
use uuid::Uuid;

use super::tasks::{
    complete_task_with_service, complete_task_with_service_and_rescan,
    complete_task_with_service_and_rescan_and_notify, create_subtask_with_service_and_rescan,
    create_subtask_with_service_and_rescan_and_notify, create_task_editor_with_services_and_rescan,
    create_task_editor_with_services_and_rescan_and_notify, create_task_with_service,
    create_task_with_services, create_task_with_services_and_rescan,
    create_task_with_services_and_rescan_and_notify, get_task_editor_with_service,
    list_inbox_with_service, list_tasks_with_service, update_task_editor_with_services_and_rescan,
    update_task_editor_with_services_and_rescan_and_notify, update_task_with_service,
    update_task_with_services, update_task_with_services_and_rescan,
    update_task_with_services_and_rescan_and_notify, CommandError, TaskDraftDto, TaskPatchDto,
    TaskViewDto,
};
use crate::{
    domain::{
        ports::TaskRepository,
        project_service::ProjectService,
        task::{Priority, ReminderClaimStateUpdate, Task, TaskDraft, TaskPatch},
        task_query::TaskView,
        task_service::TaskService,
    },
    error::{AppError, AppErrorKind},
    infrastructure::sqlite::SqliteTaskRepository,
    reminder_worker::ReminderRescanRequester,
    task_mutation_notification::{TaskMutationEvent, TaskMutationNotifier},
};

#[test]
fn successful_task_mutations_request_rescan_without_propagating_request_errors() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository.clone());
    let rescan_requester = FailingRescanRequester::default();

    let created = create_task_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!({ "title": "Publish release" })),
    )
    .unwrap();
    let task_id = serde_json::to_value(created).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    update_task_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!(task_id.clone())),
        Some(serde_json::json!({ "note": "Ready" })),
    )
    .unwrap();
    complete_task_with_service_and_rescan(
        &task_service,
        &rescan_requester,
        Some(serde_json::json!(task_id)),
    )
    .unwrap();

    assert_eq!(rescan_requester.request_count(), 3);
}

#[test]
fn successful_task_mutations_broadcast_current_task_id_and_revision_once() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository.clone());
    let rescan_requester = FailingRescanRequester::default();
    let notifier = RecordingTaskMutationNotifier::default();

    let created = create_task_with_services_and_rescan_and_notify(
        &task_service,
        &project_service,
        &rescan_requester,
        &notifier,
        Some(serde_json::json!({ "title": "Publish release" })),
    )
    .unwrap();
    let created_json = serde_json::to_value(created).unwrap();

    let updated = update_task_with_services_and_rescan_and_notify(
        &task_service,
        &project_service,
        &rescan_requester,
        &notifier,
        Some(created_json["id"].clone()),
        Some(serde_json::json!({ "note": "Ready" })),
    )
    .unwrap();
    let updated_json = serde_json::to_value(updated).unwrap();

    let completed = complete_task_with_service_and_rescan_and_notify(
        &task_service,
        &rescan_requester,
        &notifier,
        Some(updated_json["id"].clone()),
    )
    .unwrap();
    let completed_json = serde_json::to_value(completed).unwrap();

    let editor_created = create_task_editor_with_services_and_rescan_and_notify(
        &task_service,
        &project_service,
        &rescan_requester,
        &notifier,
        Some(serde_json::json!({ "title": "Plan M2" })),
        Some(serde_json::json!(["m2"])),
    )
    .unwrap();
    let editor_created_json = serde_json::to_value(editor_created).unwrap();

    let editor_updated = update_task_editor_with_services_and_rescan_and_notify(
        &task_service,
        &project_service,
        &rescan_requester,
        &notifier,
        Some(editor_created_json["task"]["id"].clone()),
        Some(editor_created_json["task"]["revision"].clone()),
        Some(serde_json::json!({ "note": "Broadcast changes" })),
        None,
    )
    .unwrap();
    let editor_updated_json = serde_json::to_value(editor_updated).unwrap();

    let subtask = create_subtask_with_service_and_rescan_and_notify(
        &task_service,
        &rescan_requester,
        &notifier,
        Some(editor_updated_json["task"]["id"].clone()),
        Some(serde_json::json!("Verify broadcasts")),
    )
    .unwrap();
    let subtask_json = serde_json::to_value(subtask).unwrap();

    assert_eq!(
        notifier.events(),
        vec![
            mutation_event_from(&created_json),
            mutation_event_from(&updated_json),
            mutation_event_from(&completed_json),
            mutation_event_from(&editor_created_json["task"]),
            mutation_event_from(&editor_updated_json["task"]),
            mutation_event_from(&subtask_json),
        ]
    );
}

#[test]
fn failed_task_mutations_do_not_broadcast() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository);
    let rescan_requester = FailingRescanRequester::default();
    let notifier = RecordingTaskMutationNotifier::default();

    assert_eq!(
        update_task_with_services_and_rescan_and_notify(
            &task_service,
            &project_service,
            &rescan_requester,
            &notifier,
            Some(serde_json::json!(Uuid::new_v4().to_string())),
            Some(serde_json::json!({ "note": "Missing" })),
        )
        .unwrap_err()
        .code,
        "task.not_found"
    );

    let editor = task_service
        .create_editor(
            TaskDraft {
                due_at: None,
                note: String::new(),
                parent_id: None,
                priority: Priority::Normal,
                project_id: None,
                recurrence: None,
                scheduled_at: None,
                title: "Existing editor task".into(),
            },
            Vec::new(),
        )
        .unwrap();
    assert_eq!(
        update_task_editor_with_services_and_rescan_and_notify(
            &task_service,
            &project_service,
            &rescan_requester,
            &notifier,
            Some(serde_json::json!(editor.task.id.to_string())),
            Some(serde_json::json!(0)),
            Some(serde_json::json!({ "note": "Stale" })),
            None,
        )
        .unwrap_err()
        .code,
        "task.concurrent_update"
    );

    assert!(notifier.events().is_empty());
}

#[test]
fn task_mutation_notification_failures_do_not_change_successful_results() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository.clone());
    let rescan_requester = FailingRescanRequester::default();
    let notifier = RecordingTaskMutationNotifier::failing();

    let created = create_task_with_services_and_rescan_and_notify(
        &task_service,
        &project_service,
        &rescan_requester,
        &notifier,
        Some(serde_json::json!({ "title": "Persist despite notification failure" })),
    )
    .unwrap();
    let created_json = serde_json::to_value(created).unwrap();

    assert_eq!(notifier.events(), vec![mutation_event_from(&created_json)]);
    assert_eq!(
        repository
            .get(Uuid::parse_str(created_json["id"].as_str().unwrap()).unwrap())
            .unwrap()
            .unwrap()
            .revision,
        created_json["revision"].as_i64().unwrap()
    );
}

#[test]
fn task_mutation_responses_include_the_current_revision() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let service = TaskService::new(repository);

    let created = create_task_with_service(
        &service,
        Some(serde_json::json!({ "title": "Publish release" })),
    )
    .unwrap();
    let created_json = serde_json::to_value(&created).unwrap();
    assert_eq!(created_json["revision"], serde_json::json!(1));

    let updated = update_task_with_service(
        &service,
        Some(serde_json::json!(created_json["id"])),
        Some(serde_json::json!({ "note": "Ready" })),
    )
    .unwrap();
    let updated_json = serde_json::to_value(&updated).unwrap();
    assert_eq!(updated_json["revision"], serde_json::json!(2));

    let completed =
        complete_task_with_service(&service, Some(serde_json::json!(updated_json["id"]))).unwrap();
    assert_eq!(
        serde_json::to_value(completed).unwrap()["revision"],
        serde_json::json!(3)
    );
}

#[test]
fn create_task_rejects_unknown_and_archived_project_ids_through_the_command_path() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository.clone());
    let active_project = project_service.create("Release".into()).unwrap();
    let archived_project = project_service.create("Archive".into()).unwrap();
    project_service.archive(archived_project.id).unwrap();

    assert!(create_task_with_services(
        &task_service,
        &project_service,
        Some(serde_json::json!({ "title": "Publish", "projectId": active_project.id }))
    )
    .is_ok());
    assert_eq!(
        create_task_with_services(
            &task_service,
            &project_service,
            Some(serde_json::json!({ "title": "Blocked", "projectId": archived_project.id }))
        )
        .unwrap_err(),
        CommandError {
            code: "project.not_found".into(),
            message_key: "errors.project.not_found".into(),
        }
    );
}

#[test]
fn update_task_validates_project_changes_and_preserves_unchanged_archived_associations() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository.clone());
    let active_project = project_service.create("Release".into()).unwrap();
    let archived_project = project_service.create("Archive".into()).unwrap();
    let task = task_service
        .create(TaskDraft {
            due_at: None,
            note: "Original note".into(),
            parent_id: None,
            priority: Priority::Normal,
            project_id: Some(archived_project.id),
            recurrence: None,
            scheduled_at: None,
            title: "Publish notes".into(),
        })
        .unwrap();
    project_service.archive(archived_project.id).unwrap();

    assert!(update_task_with_services(
        &task_service,
        &project_service,
        Some(serde_json::json!(task.id.to_string())),
        Some(serde_json::json!({ "projectId": active_project.id })),
    )
    .is_ok());
    assert_eq!(
        update_task_with_services(
            &task_service,
            &project_service,
            Some(serde_json::json!(task.id.to_string())),
            Some(serde_json::json!({ "projectId": Uuid::new_v4() })),
        )
        .unwrap_err(),
        CommandError {
            code: "project.not_found".into(),
            message_key: "errors.project.not_found".into(),
        }
    );
    assert_eq!(
        update_task_with_services(
            &task_service,
            &project_service,
            Some(serde_json::json!(task.id.to_string())),
            Some(serde_json::json!({ "projectId": archived_project.id })),
        )
        .unwrap_err(),
        CommandError {
            code: "project.not_found".into(),
            message_key: "errors.project.not_found".into(),
        }
    );

    update_task_with_services(
        &task_service,
        &project_service,
        Some(serde_json::json!(task.id.to_string())),
        Some(serde_json::json!({ "projectId": null })),
    )
    .unwrap();
    assert_eq!(repository.get(task.id).unwrap().unwrap().project_id, None);

    let mut archived_task = repository.get(task.id).unwrap().unwrap();
    let expected_revision = archived_task.revision;
    archived_task.project_id = Some(archived_project.id);
    archived_task.increment_revision().unwrap();
    repository
        .update(
            &archived_task,
            expected_revision,
            ReminderClaimStateUpdate::Preserve,
        )
        .unwrap();

    update_task_with_services(
        &task_service,
        &project_service,
        Some(serde_json::json!(task.id.to_string())),
        Some(serde_json::json!({ "title": "Publish final notes" })),
    )
    .unwrap();
    let persisted = repository.get(task.id).unwrap().unwrap();
    assert_eq!(persisted.project_id, Some(archived_project.id));
    assert_eq!(persisted.title, "Publish final notes");
}

#[test]
fn editor_update_preserves_an_unchanged_archived_project_association() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository);
    let rescan_requester = FailingRescanRequester::default();
    let project = project_service.create("Release".into()).unwrap();
    let created = create_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!({
            "projectId": project.id,
            "title": "Publish notes",
        })),
        Some(serde_json::json!([])),
    )
    .unwrap();
    let created_json = serde_json::to_value(created).unwrap();

    project_service.archive(project.id).unwrap();

    let updated = update_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(created_json["task"]["id"].clone()),
        Some(created_json["task"]["revision"].clone()),
        Some(serde_json::json!({
            "dueAt": null,
            "note": "Ready for review",
            "priority": "Normal",
            "projectId": project.id,
            "recurrence": null,
            "scheduledAt": null,
            "title": "Publish final notes",
        })),
        Some(serde_json::json!([])),
    )
    .unwrap();
    let updated_json = serde_json::to_value(updated).unwrap();

    assert_eq!(updated_json["task"]["projectId"], project.id.to_string());
    assert_eq!(updated_json["task"]["title"], "Publish final notes");
}

#[test]
fn create_task_returns_serializable_validation_error() {
    let service = TaskService::new(RecordingRepository);

    let result = create_task_with_service(
        &service,
        Some(serde_json::json!({
            "title": "",
        })),
    );

    assert_eq!(
        result.unwrap_err(),
        CommandError {
            code: "task.title.blank".into(),
            message_key: "errors.task.title.blank".into(),
        }
    );
}

#[test]
fn task_draft_dto_accepts_the_minimum_frontend_payload_with_defaults() {
    let draft: TaskDraftDto =
        serde_json::from_str(r#"{"title":"Review schema","note":""}"#).unwrap();
    let domain_draft: TaskDraft = draft.try_into().unwrap();

    assert_eq!(domain_draft.title, "Review schema");
    assert_eq!(domain_draft.note, "");
    assert_eq!(domain_draft.project_id, None);
    assert_eq!(domain_draft.parent_id, None);
    assert_eq!(domain_draft.priority, Priority::Normal);
    assert_eq!(domain_draft.scheduled_at, None);
    assert_eq!(domain_draft.due_at, None);
    assert_eq!(domain_draft.recurrence, None);

    let service = TaskService::new(RecordingRepository);

    assert!(create_task_with_service(
        &service,
        Some(serde_json::json!({
            "title": "Review schema",
            "note": "",
        })),
    )
    .is_ok());
}

#[test]
fn task_draft_dto_with_missing_title_reaches_domain_validation() {
    let service = TaskService::new(RecordingRepository);

    assert_eq!(
        create_task_with_service(&service, Some(serde_json::json!({ "note": "" }))).unwrap_err(),
        CommandError {
            code: "task.title.blank".into(),
            message_key: "errors.task.title.blank".into(),
        }
    );
}

#[test]
fn task_patch_dto_missing_nullable_date_does_not_modify_it() {
    let patch: TaskPatchDto = serde_json::from_str(r#"{}"#).unwrap();
    let domain_patch: TaskPatch = patch.try_into().unwrap();

    assert_eq!(domain_patch.due_at, None);
}

#[test]
fn task_patch_dto_null_nullable_date_clears_it() {
    let patch: TaskPatchDto = serde_json::from_str(r#"{"dueAt":null}"#).unwrap();
    let domain_patch: TaskPatch = patch.try_into().unwrap();

    assert_eq!(domain_patch.due_at, Some(None));
}

#[test]
fn task_patch_dto_date_value_sets_it() {
    let patch: TaskPatchDto = serde_json::from_str(r#"{"dueAt":"2026-08-29T17:00:00Z"}"#).unwrap();
    let domain_patch: TaskPatch = patch.try_into().unwrap();

    assert_eq!(
        domain_patch.due_at,
        Some(Some(
            Utc.with_ymd_and_hms(2026, 8, 29, 17, 0, 0)
                .single()
                .unwrap()
        ))
    );
}

#[test]
fn malformed_draft_uuid_returns_a_stable_command_error() {
    let draft = serde_json::from_str(r#"{"title":"Review","projectId":"bad-id"}"#).unwrap();
    let result = create_task_with_service(&TaskService::new(RecordingRepository), Some(draft));

    assert_eq!(result.unwrap_err().message_key, "errors.task.input.invalid");
}

#[test]
fn malformed_patch_date_returns_a_stable_command_error() {
    let patch = serde_json::from_str(r#"{"dueAt":"not-a-date"}"#).unwrap();
    let result = update_task_with_service(
        &TaskService::new(RecordingRepository),
        Some(serde_json::json!(Uuid::new_v4().to_string())),
        Some(patch),
    );

    assert_eq!(result.unwrap_err().message_key, "errors.task.input.invalid");
}

#[test]
fn null_title_is_rejected_instead_of_becoming_a_no_op() {
    let patch: TaskPatchDto = serde_json::from_str(r#"{"title":null}"#).unwrap();
    let result: Result<TaskPatch, CommandError> = patch.try_into();

    assert_eq!(result.unwrap_err().message_key, "errors.task.input.invalid");
}

#[test]
fn non_object_draft_returns_a_stable_command_error() {
    let result = create_task_with_service(
        &TaskService::new(RecordingRepository),
        Some(serde_json::json!("not-an-object")),
    );

    assert_eq!(
        result.unwrap_err(),
        CommandError {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    );
}

#[test]
fn non_object_patch_returns_a_stable_command_error() {
    let result = update_task_with_service(
        &TaskService::new(RecordingRepository),
        Some(serde_json::json!(Uuid::new_v4().to_string())),
        Some(serde_json::json!(["not-an-object"])),
    );

    assert_eq!(
        result.unwrap_err(),
        CommandError {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    );
}

#[test]
fn non_string_task_id_returns_a_stable_command_error() {
    let result = update_task_with_service(
        &TaskService::new(RecordingRepository),
        Some(serde_json::json!(42)),
        Some(serde_json::json!({})),
    );

    assert_eq!(
        result.unwrap_err(),
        CommandError {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    );
}

#[test]
fn unknown_patch_field_returns_a_stable_command_error() {
    let task = Task::for_test("Review schema".into());
    let id = task.id;
    let service = TaskService::new(ExistingTaskRepository { task });

    let result = update_task_with_service(
        &service,
        Some(serde_json::json!(id.to_string())),
        Some(serde_json::json!({ "titel": "Review release" })),
    );

    assert_eq!(
        result.unwrap_err(),
        CommandError {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    );
}

#[test]
fn missing_draft_argument_returns_a_stable_command_error() {
    let result = create_task_with_service(&TaskService::new(RecordingRepository), None);

    assert_eq!(
        result.unwrap_err(),
        CommandError {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    );
}

#[test]
fn missing_task_id_argument_returns_a_stable_command_error() {
    let result = update_task_with_service(
        &TaskService::new(RecordingRepository),
        None,
        Some(serde_json::json!({})),
    );

    assert_eq!(
        result.unwrap_err(),
        CommandError {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    );
}

#[test]
fn missing_patch_argument_returns_a_stable_command_error() {
    let result = update_task_with_service(
        &TaskService::new(RecordingRepository),
        Some(serde_json::json!(Uuid::new_v4().to_string())),
        None,
    );

    assert_eq!(
        result.unwrap_err(),
        CommandError {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    );
}

#[test]
fn update_task_rejects_a_completed_at_value_with_a_stable_command_error() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task = Task::for_test("Publish release".into());
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    assert_eq!(
        update_task_with_service(
            &service,
            Some(serde_json::json!(task.id.to_string())),
            Some(serde_json::json!({ "completedAt": "2026-08-26T10:00:00Z" })),
        )
        .unwrap_err(),
        CommandError {
            code: "task.completion.use_complete".into(),
            message_key: "errors.task.completion.use_complete".into(),
        }
    );
    assert_eq!(repository.get(task.id).unwrap(), Some(task));
}

#[test]
fn update_task_rejects_restoring_a_completed_recurring_instance_and_preserves_the_next_instance() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let mut task = Task::for_test("Publish weekly release".into());
    task.scheduled_at = Some(Utc.with_ymd_and_hms(2026, 8, 26, 9, 0, 0).unwrap());
    task.recurrence = Some(
        crate::domain::recurrence::RecurrenceRule::new(
            crate::domain::recurrence::Frequency::Weekly,
            1,
            None,
            None,
        )
        .unwrap(),
    );
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());
    let completion = service.complete(task.id).unwrap().unwrap();
    let completed_task = completion.completed_task;
    let next_task = completion.next_task.unwrap();

    assert_eq!(
        update_task_with_service(
            &service,
            Some(serde_json::json!(task.id.to_string())),
            Some(serde_json::json!({ "completedAt": null })),
        )
        .unwrap_err(),
        CommandError {
            code: "task.recurrence.restore.unsupported".into(),
            message_key: "errors.task.recurrence.restore.unsupported".into(),
        }
    );
    assert_eq!(repository.get(task.id).unwrap(), Some(completed_task));
    assert_eq!(
        repository.get(next_task.id).unwrap(),
        Some(next_task.clone())
    );
    assert_eq!(repository.list_inbox().unwrap(), vec![next_task]);
}

#[test]
fn list_inbox_with_service_returns_serializable_task_dtos() {
    let service = TaskService::new(RecordingRepository);

    let result = list_inbox_with_service(&service).unwrap();

    assert!(result.is_empty());
}

#[test]
fn list_tasks_rejects_invalid_view_project_id_and_blank_search() {
    let service = TaskService::new(RecordingRepository);

    for view in [
        serde_json::json!({ "kind": "unknown" }),
        serde_json::json!({ "kind": "project", "projectId": "not-a-uuid" }),
        serde_json::json!({ "kind": "search", "query": "   " }),
    ] {
        assert_eq!(
            list_tasks_with_service(&service, Some(view)).unwrap_err(),
            CommandError {
                code: "task.input.invalid".into(),
                message_key: "errors.task.input.invalid".into(),
            }
        );
    }
}

#[test]
fn list_tasks_accepts_a_strict_inbox_view() {
    let service = TaskService::new(RecordingRepository);

    assert!(
        list_tasks_with_service(&service, Some(serde_json::json!({ "kind": "inbox" })))
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        list_tasks_with_service(
            &service,
            Some(serde_json::json!({ "kind": "inbox", "extra": true })),
        )
        .unwrap_err(),
        CommandError {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    );
}

#[test]
fn calendar_view_requires_an_exact_existing_zero_padded_month() {
    let service = TaskService::new(RecordingRepository);

    let view = TaskViewDto::try_from(serde_json::json!({
        "kind": "calendar",
        "month": "2026-02",
    }))
    .and_then(TaskView::try_from);
    assert!(matches!(view, Ok(TaskView::Calendar { .. })));

    for invalid_view in [
        serde_json::json!({ "kind": "calendar" }),
        serde_json::json!({ "kind": "calendar", "month": "2026-2" }),
        serde_json::json!({ "kind": "calendar", "month": "2026-13" }),
        serde_json::json!({ "kind": "calendar", "month": "2026-02", "extra": true }),
        serde_json::json!({ "kind": "calendar", "month": 202602 }),
    ] {
        assert_eq!(
            list_tasks_with_service(&service, Some(invalid_view)).unwrap_err(),
            CommandError {
                code: "task.input.invalid".into(),
                message_key: "errors.task.input.invalid".into(),
            }
        );
    }
}

#[test]
fn list_tasks_parses_a_camel_case_project_view_and_rejects_other_project_shapes() {
    let project_id = Uuid::new_v4();
    let repository = CapturingViewRepository::default();
    let service = TaskService::new(&repository);

    assert!(list_tasks_with_service(
        &service,
        Some(serde_json::json!({
            "kind": "project",
            "projectId": project_id.to_string(),
        })),
    )
    .unwrap()
    .is_empty());
    assert_eq!(
        repository.captured_view(),
        Some(TaskView::Project(project_id))
    );

    for view in [
        serde_json::json!({ "kind": "project", "project_id": project_id.to_string() }),
        serde_json::json!({ "kind": "project" }),
        serde_json::json!({
            "kind": "project",
            "projectId": project_id.to_string(),
            "extra": true,
        }),
    ] {
        assert_eq!(
            list_tasks_with_service(&service, Some(view)).unwrap_err(),
            CommandError {
                code: "task.input.invalid".into(),
                message_key: "errors.task.input.invalid".into(),
            }
        );
    }
}

#[test]
fn complete_task_accepts_only_a_string_task_id_and_returns_the_completed_task() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task = Task::for_test("Publish release".into());
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository.clone());

    let completed =
        complete_task_with_service(&service, Some(serde_json::json!(task.id.to_string()))).unwrap();

    let completed_json = serde_json::to_value(completed).unwrap();
    assert_eq!(completed_json["id"], serde_json::json!(task.id.to_string()));
    assert!(completed_json["completedAt"].is_string());
    assert!(repository
        .get(task.id)
        .unwrap()
        .unwrap()
        .completed_at
        .is_some());

    for invalid_id in [
        serde_json::json!(null),
        serde_json::json!(42),
        serde_json::json!({ "id": task.id.to_string() }),
    ] {
        assert_eq!(
            complete_task_with_service(&service, Some(invalid_id)).unwrap_err(),
            CommandError {
                code: "task.input.invalid".into(),
                message_key: "errors.task.input.invalid".into(),
            }
        );
    }

    assert_eq!(
        complete_task_with_service(&service, Some(serde_json::json!("not-a-uuid"))).unwrap_err(),
        CommandError {
            code: "task.id.invalid".into(),
            message_key: "errors.task.id.invalid".into(),
        }
    );
}

#[test]
fn complete_task_maps_not_found_and_conflict_to_stable_command_errors() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task = Task::for_test("Publish release".into());
    repository.insert(&task).unwrap();
    let service = TaskService::new(repository);

    assert_eq!(
        complete_task_with_service(
            &service,
            Some(serde_json::json!(Uuid::new_v4().to_string()))
        )
        .unwrap_err(),
        CommandError {
            code: "task.not_found".into(),
            message_key: "errors.task.not_found".into(),
        }
    );

    complete_task_with_service(&service, Some(serde_json::json!(task.id.to_string()))).unwrap();

    assert_eq!(
        complete_task_with_service(&service, Some(serde_json::json!(task.id.to_string())))
            .unwrap_err(),
        CommandError {
            code: "task.already_completed".into(),
            message_key: "errors.task.already_completed".into(),
        }
    );
}

#[test]
fn command_error_serializes_only_stable_client_fields() {
    let error = CommandError {
        code: "storage.unavailable".into(),
        message_key: "errors.storage.unavailable".into(),
    };

    assert_eq!(
        serde_json::to_value(error).unwrap(),
        serde_json::json!({
            "code": "storage.unavailable",
            "message_key": "errors.storage.unavailable"
        })
    );
}

#[test]
fn concurrent_task_update_error_keeps_its_stable_ipc_contract() {
    let error = CommandError::from(AppError::new(
        "task.concurrent_update",
        "errors.task.concurrent_update",
        AppErrorKind::Conflict,
    ));

    assert_eq!(
        error,
        CommandError {
            code: "task.concurrent_update".into(),
            message_key: "errors.task.concurrent_update".into(),
        }
    );
}

#[test]
fn editor_update_with_a_stale_revision_preserves_task_and_tag_associations() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository.clone());
    let rescan_requester = FailingRescanRequester::default();
    let created = create_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!({ "title": "Publish release" })),
        Some(serde_json::json!(["release"])),
    )
    .unwrap();
    let created_json = serde_json::to_value(created).unwrap();
    let task_id = created_json["task"]["id"].clone();

    update_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(task_id.clone()),
        Some(serde_json::json!(1)),
        Some(serde_json::json!({ "note": "Ready" })),
        None,
    )
    .unwrap();

    assert_eq!(
        update_task_editor_with_services_and_rescan(
            &task_service,
            &project_service,
            &rescan_requester,
            Some(task_id.clone()),
            Some(serde_json::json!(1)),
            Some(serde_json::json!({ "title": "Stale title" })),
            Some(serde_json::json!(["stale"])),
        )
        .unwrap_err(),
        CommandError {
            code: "task.concurrent_update".into(),
            message_key: "errors.task.concurrent_update".into(),
        }
    );

    let editor = get_task_editor_with_service(&task_service, Some(task_id)).unwrap();
    let editor_json = serde_json::to_value(editor).unwrap();
    assert_eq!(editor_json["task"]["title"], "Publish release");
    assert_eq!(editor_json["task"]["note"], "Ready");
    assert_eq!(editor_json["task"]["revision"], 2);
    assert_eq!(editor_json["tagNames"], serde_json::json!(["release"]));
}

#[test]
fn editor_update_with_an_empty_tag_list_clears_existing_tags() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository);
    let rescan_requester = FailingRescanRequester::default();
    let created = create_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!({ "title": "Publish release" })),
        Some(serde_json::json!(["release", "m2"])),
    )
    .unwrap();
    let created_json = serde_json::to_value(created).unwrap();

    let updated = update_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(created_json["task"]["id"].clone()),
        Some(created_json["task"]["revision"].clone()),
        Some(serde_json::json!({})),
        Some(serde_json::json!([])),
    )
    .unwrap();

    assert_eq!(
        serde_json::to_value(updated).unwrap()["tagNames"],
        serde_json::json!([])
    );
}

#[test]
fn editor_tag_names_are_trimmed_deduplicated_and_reject_invalid_values() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository);
    let rescan_requester = FailingRescanRequester::default();

    let created = create_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!({ "title": "Publish release" })),
        Some(serde_json::json!([" release ", "release", "M2"])),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(created).unwrap()["tagNames"],
        serde_json::json!(["M2", "release"])
    );

    for tag_names in [
        serde_json::json!([""]),
        serde_json::json!(["   "]),
        serde_json::json!(["x".repeat(81)]),
        serde_json::json!([42]),
    ] {
        assert_eq!(
            create_task_editor_with_services_and_rescan(
                &task_service,
                &project_service,
                &rescan_requester,
                Some(serde_json::json!({ "title": "Invalid tags" })),
                Some(tag_names),
            )
            .unwrap_err(),
            CommandError {
                code: "task.tag.invalid".into(),
                message_key: "errors.task.tag.invalid".into(),
            }
        );
    }
}

#[test]
fn editor_update_rolls_back_tag_replacement_when_the_task_write_fails() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository.clone());
    let rescan_requester = FailingRescanRequester::default();
    let created = create_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!({ "title": "Publish release" })),
        Some(serde_json::json!(["release"])),
    )
    .unwrap();
    let created_json = serde_json::to_value(created).unwrap();
    repository
        .fail_task_tag_association_inserts_for_test()
        .unwrap();

    assert_eq!(
        update_task_editor_with_services_and_rescan(
            &task_service,
            &project_service,
            &rescan_requester,
            Some(created_json["task"]["id"].clone()),
            Some(created_json["task"]["revision"].clone()),
            Some(serde_json::json!({ "note": "Replacement attempt" })),
            Some(serde_json::json!(["replacement"])),
        )
        .unwrap_err()
        .code,
        "storage.unavailable"
    );

    let editor =
        get_task_editor_with_service(&task_service, Some(created_json["task"]["id"].clone()))
            .unwrap();
    let editor_json = serde_json::to_value(editor).unwrap();
    assert_eq!(editor_json["task"]["parentId"], serde_json::Value::Null);
    assert_eq!(editor_json["tagNames"], serde_json::json!(["release"]));
}

#[test]
fn editor_returns_direct_subtasks_and_rejects_missing_or_nested_parents() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository);
    let rescan_requester = FailingRescanRequester::default();
    let parent = create_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!({ "title": "Parent" })),
        None,
    )
    .unwrap();
    let parent_id = serde_json::to_value(parent).unwrap()["task"]["id"].clone();

    let subtask = create_subtask_with_service_and_rescan(
        &task_service,
        &rescan_requester,
        Some(parent_id.clone()),
        Some(serde_json::json!("Child")),
    )
    .unwrap();
    let subtask_json = serde_json::to_value(subtask).unwrap();
    assert_eq!(subtask_json["parentId"], parent_id);
    assert_eq!(subtask_json["priority"], "Normal");
    assert_eq!(subtask_json["recurrence"], serde_json::Value::Null);

    let editor = get_task_editor_with_service(&task_service, Some(parent_id.clone())).unwrap();
    assert_eq!(
        serde_json::to_value(editor).unwrap()["subtasks"][0]["id"],
        subtask_json["id"]
    );

    assert_eq!(
        create_subtask_with_service_and_rescan(
            &task_service,
            &rescan_requester,
            Some(serde_json::json!(Uuid::new_v4().to_string())),
            Some(serde_json::json!("Missing")),
        )
        .unwrap_err()
        .code,
        "task.parent.not_found"
    );
    assert_eq!(
        create_subtask_with_service_and_rescan(
            &task_service,
            &rescan_requester,
            Some(subtask_json["id"].clone()),
            Some(serde_json::json!("Nested")),
        )
        .unwrap_err()
        .code,
        "task.subtask.nesting.unsupported"
    );
}

#[test]
fn editor_create_uses_existing_recurrence_validation() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository);
    let rescan_requester = FailingRescanRequester::default();

    assert_eq!(
        create_task_editor_with_services_and_rescan(
            &task_service,
            &project_service,
            &rescan_requester,
            Some(serde_json::json!({
                "title": "Recurring without a date",
                "recurrence": { "frequency": "daily", "interval": 1, "until": null, "count": null },
            })),
            None,
        )
        .unwrap_err(),
        CommandError {
            code: "recurrence.scheduled_at.required".into(),
            message_key: "errors.recurrence.scheduled_at.required".into(),
        }
    );
}

#[test]
fn editor_update_accepts_and_returns_a_structured_snake_case_recurrence() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository);
    let rescan_requester = FailingRescanRequester::default();
    let scheduled_at = "2026-09-11T10:30:00Z";
    let created = create_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!({
            "dueAt": null,
            "note": "",
            "priority": "Normal",
            "projectId": null,
            "recurrence": null,
            "scheduledAt": scheduled_at,
            "title": "Publish weekly release",
        })),
        Some(serde_json::json!([])),
    )
    .unwrap();
    let created_json = serde_json::to_value(created).unwrap();
    let recurrence = serde_json::json!({
        "frequency": "weekly",
        "interval": 1,
        "until": null,
        "count": null,
    });

    let updated = update_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(created_json["task"]["id"].clone()),
        Some(created_json["task"]["revision"].clone()),
        Some(serde_json::json!({
            "dueAt": null,
            "note": "",
            "priority": "Normal",
            "projectId": null,
            "recurrence": recurrence,
            "scheduledAt": scheduled_at,
            "title": "Publish weekly release",
        })),
        Some(serde_json::json!([])),
    )
    .unwrap();

    let updated_json = serde_json::to_value(updated).unwrap();
    assert_eq!(
        updated_json["task"]["recurrence"],
        serde_json::json!({
            "frequency": "weekly",
            "interval": 1,
            "until": null,
            "count": null,
        })
    );
    assert_eq!(
        update_task_editor_with_services_and_rescan(
            &task_service,
            &project_service,
            &rescan_requester,
            Some(updated_json["task"]["id"].clone()),
            Some(updated_json["task"]["revision"].clone()),
            Some(serde_json::json!({
                "dueAt": null,
                "note": "",
                "priority": "Normal",
                "projectId": null,
                "recurrence": {
                    "frequency": "Weekly",
                    "interval": 1,
                    "until": null,
                    "count": null,
                },
                "scheduledAt": scheduled_at,
                "title": "Publish weekly release",
            })),
            Some(serde_json::json!([])),
        )
        .unwrap_err(),
        CommandError {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    );
}

#[test]
fn editor_update_accepts_an_explicitly_unchanged_legacy_yearly_rule() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository.clone());
    let rescan_requester = FailingRescanRequester::default();
    let recurrence = serde_json::json!({
        "frequency": "yearly",
        "interval": 1,
        "until": null,
        "count": null,
    });
    let mut task = Task::for_test("Renew certificate".into());
    task.scheduled_at = Some(Utc.with_ymd_and_hms(2026, 2, 28, 9, 0, 0).single().unwrap());
    task.recurrence = Some(serde_json::from_value(recurrence.clone()).unwrap());
    repository.insert(&task).unwrap();

    let updated = update_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!(task.id.to_string())),
        Some(serde_json::json!(task.revision)),
        Some(serde_json::json!({
            "note": "Keep legacy schedule",
            "recurrence": recurrence,
        })),
        Some(serde_json::json!(["renewal"])),
    )
    .unwrap();

    let updated_json = serde_json::to_value(updated).unwrap();
    assert_eq!(updated_json["task"]["note"], "Keep legacy schedule");
    assert_eq!(
        updated_json["task"]["recurrence"],
        serde_json::json!({
            "frequency": "yearly",
            "interval": 1,
            "until": null,
            "count": null,
        })
    );
    assert_eq!(updated_json["tagNames"], serde_json::json!(["renewal"]));

    let reloaded =
        get_task_editor_with_service(&task_service, Some(serde_json::json!(task.id.to_string())))
            .unwrap();
    assert_eq!(
        serde_json::to_value(reloaded).unwrap()["task"]["recurrence"],
        updated_json["task"]["recurrence"]
    );
}

#[test]
fn editor_update_rejects_a_legacy_yearly_recurrence_string() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository.clone());
    let rescan_requester = FailingRescanRequester::default();
    let mut task = Task::for_test("Renew certificate".into());
    task.scheduled_at = Some(Utc.with_ymd_and_hms(2026, 2, 28, 9, 0, 0).single().unwrap());
    task.recurrence = Some(serde_json::from_value(serde_json::json!("Yearly")).unwrap());
    repository.insert(&task).unwrap();

    let result = update_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!(task.id.to_string())),
        Some(serde_json::json!(task.revision)),
        Some(serde_json::json!({
            "note": "Keep legacy schedule",
            "recurrence": "Yearly",
        })),
        Some(serde_json::json!([])),
    );

    let error = result.expect_err("editor patches must reject legacy recurrence strings");
    assert_eq!(
        error,
        CommandError {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    );
}

#[test]
fn task_commands_reject_parent_and_subtask_project_bypasses() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository);
    let rescan_requester = FailingRescanRequester::default();
    let inherited_project = project_service.create("Parent project".into()).unwrap();
    let parent_id = Uuid::new_v4().to_string();
    let parent_write_error = CommandError {
        code: "task.parent.write.unsupported".into(),
        message_key: "errors.task.parent.write.unsupported".into(),
    };

    assert_eq!(
        create_task_with_services(
            &task_service,
            &project_service,
            Some(serde_json::json!({ "title": "Bypass", "parentId": parent_id })),
        )
        .unwrap_err(),
        parent_write_error
    );
    assert_eq!(
        create_task_editor_with_services_and_rescan(
            &task_service,
            &project_service,
            &rescan_requester,
            Some(serde_json::json!({ "title": "Bypass", "parentId": Uuid::new_v4().to_string() })),
            None,
        )
        .unwrap_err(),
        parent_write_error
    );

    let parent = create_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!({
            "title": "Parent",
            "projectId": inherited_project.id.to_string(),
        })),
        None,
    )
    .unwrap();
    let parent_json = serde_json::to_value(parent).unwrap();
    let child = create_subtask_with_service_and_rescan(
        &task_service,
        &rescan_requester,
        Some(parent_json["task"]["id"].clone()),
        Some(serde_json::json!("Child")),
    )
    .unwrap();
    let child_json = serde_json::to_value(child).unwrap();
    assert_eq!(
        child_json["projectId"],
        serde_json::json!(inherited_project.id.to_string())
    );
    let updated_child = update_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(child_json["id"].clone()),
        Some(child_json["revision"].clone()),
        Some(serde_json::json!({
            "note": "Child details",
            "priority": "Low",
            "title": "Edited child",
        })),
        Some(serde_json::json!(["inbox"])),
    )
    .unwrap();
    let updated_child_json = serde_json::to_value(updated_child).unwrap();
    assert_eq!(
        updated_child_json["task"]["parentId"],
        parent_json["task"]["id"]
    );
    assert_eq!(
        updated_child_json["task"]["projectId"],
        serde_json::json!(inherited_project.id.to_string())
    );
    assert_eq!(updated_child_json["task"]["title"], "Edited child");
    assert_eq!(updated_child_json["task"]["note"], "Child details");
    assert_eq!(updated_child_json["task"]["priority"], "Low");
    assert_eq!(updated_child_json["tagNames"], serde_json::json!(["inbox"]));

    assert_eq!(
        update_task_with_services(
            &task_service,
            &project_service,
            Some(parent_json["task"]["id"].clone()),
            Some(serde_json::json!({ "parentId": null })),
        )
        .unwrap_err(),
        parent_write_error
    );
    assert_eq!(
        update_task_editor_with_services_and_rescan(
            &task_service,
            &project_service,
            &rescan_requester,
            Some(parent_json["task"]["id"].clone()),
            Some(parent_json["task"]["revision"].clone()),
            Some(serde_json::json!({ "parentId": null })),
            None,
        )
        .unwrap_err(),
        parent_write_error
    );

    let project = project_service.create("Inherited".into()).unwrap();
    let inherited_project_error = CommandError {
        code: "task.subtask.project.inherited".into(),
        message_key: "errors.task.subtask.project.inherited".into(),
    };
    assert_eq!(
        update_task_with_services(
            &task_service,
            &project_service,
            Some(child_json["id"].clone()),
            Some(serde_json::json!({ "projectId": project.id.to_string() })),
        )
        .unwrap_err(),
        inherited_project_error
    );
    assert_eq!(
        update_task_editor_with_services_and_rescan(
            &task_service,
            &project_service,
            &rescan_requester,
            Some(updated_child_json["task"]["id"].clone()),
            Some(updated_child_json["task"]["revision"].clone()),
            Some(serde_json::json!({ "projectId": project.id.to_string() })),
            None,
        )
        .unwrap_err(),
        inherited_project_error
    );
}

#[test]
fn editor_mutations_request_rescan_only_after_success() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let task_service = TaskService::new(repository.clone());
    let project_service = ProjectService::new(repository);
    let rescan_requester = FailingRescanRequester::default();

    let created = create_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(serde_json::json!({ "title": "Parent" })),
        None,
    )
    .unwrap();
    let created_json = serde_json::to_value(created).unwrap();
    assert_eq!(rescan_requester.request_count(), 1);

    get_task_editor_with_service(&task_service, Some(created_json["task"]["id"].clone())).unwrap();
    assert_eq!(rescan_requester.request_count(), 1);

    let updated = update_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(created_json["task"]["id"].clone()),
        Some(created_json["task"]["revision"].clone()),
        Some(serde_json::json!({ "note": "Ready" })),
        None,
    )
    .unwrap();
    let updated_json = serde_json::to_value(updated).unwrap();
    assert_eq!(rescan_requester.request_count(), 2);

    assert!(update_task_editor_with_services_and_rescan(
        &task_service,
        &project_service,
        &rescan_requester,
        Some(updated_json["task"]["id"].clone()),
        Some(updated_json["task"]["revision"].clone()),
        Some(serde_json::json!({ "parentId": null })),
        None,
    )
    .is_err());
    assert_eq!(rescan_requester.request_count(), 2);

    create_subtask_with_service_and_rescan(
        &task_service,
        &rescan_requester,
        Some(updated_json["task"]["id"].clone()),
        Some(serde_json::json!("Child")),
    )
    .unwrap();
    assert_eq!(rescan_requester.request_count(), 3);

    assert!(create_subtask_with_service_and_rescan(
        &task_service,
        &rescan_requester,
        Some(serde_json::json!(Uuid::new_v4().to_string())),
        Some(serde_json::json!("Missing")),
    )
    .is_err());
    assert_eq!(rescan_requester.request_count(), 3);
}

fn mutation_event_from(task: &serde_json::Value) -> TaskMutationEvent {
    TaskMutationEvent::new(
        Uuid::parse_str(task["id"].as_str().unwrap()).unwrap(),
        task["revision"].as_i64().unwrap(),
    )
}

#[derive(Default)]
struct RecordingTaskMutationNotifier {
    events: Mutex<Vec<TaskMutationEvent>>,
    fails: bool,
}

impl RecordingTaskMutationNotifier {
    fn failing() -> Self {
        Self {
            events: Mutex::new(Vec::new()),
            fails: true,
        }
    }

    fn events(&self) -> Vec<TaskMutationEvent> {
        self.events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

impl TaskMutationNotifier for RecordingTaskMutationNotifier {
    fn notify(&self, event: TaskMutationEvent) -> Result<(), AppError> {
        self.events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(event);

        if self.fails {
            return Err(AppError::new(
                "task.mutation_notification.failed",
                "errors.task.mutation_notification.failed",
                AppErrorKind::Internal,
            ));
        }

        Ok(())
    }
}

#[derive(Default)]
struct FailingRescanRequester {
    request_count: AtomicUsize,
}

impl FailingRescanRequester {
    fn request_count(&self) -> usize {
        self.request_count.load(Ordering::SeqCst)
    }
}

impl ReminderRescanRequester for FailingRescanRequester {
    fn request_rescan(&self) -> Result<(), AppError> {
        self.request_count.fetch_add(1, Ordering::SeqCst);

        Err(AppError::new(
            "reminder.worker.unavailable",
            "errors.reminder.worker.unavailable",
            AppErrorKind::Internal,
        ))
    }
}

#[derive(Default)]
struct RecordingRepository;

impl TaskRepository for RecordingRepository {
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
        _completion: &crate::domain::recurrence::TaskCompletion,
        _expected_revision: i64,
    ) -> Result<(), AppError> {
        Ok(())
    }

    fn get(&self, _id: uuid::Uuid) -> Result<Option<Task>, AppError> {
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
        _task_id: uuid::Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _claimed_at: chrono::DateTime<chrono::Utc>,
        _expired_before: chrono::DateTime<chrono::Utc>,
        _claim_token: uuid::Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }

    fn mark_reminder_delivered(
        &self,
        _task_id: uuid::Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _delivered_at: chrono::DateTime<chrono::Utc>,
        _claim_token: uuid::Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }

    fn release_reminder_claim(
        &self,
        _task_id: uuid::Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _claim_token: uuid::Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }
}

struct ExistingTaskRepository {
    task: Task,
}

#[derive(Default)]
struct CapturingViewRepository {
    view: Mutex<Option<TaskView>>,
}

impl CapturingViewRepository {
    fn captured_view(&self) -> Option<TaskView> {
        self.view
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

impl TaskRepository for &CapturingViewRepository {
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
        view: &TaskView,
    ) -> Result<Vec<crate::domain::task_query::TaskSummaryDto>, AppError> {
        let mut captured_view = self
            .view
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *captured_view = Some(view.clone());

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

impl TaskRepository for ExistingTaskRepository {
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
        _completion: &crate::domain::recurrence::TaskCompletion,
        _expected_revision: i64,
    ) -> Result<(), AppError> {
        Ok(())
    }

    fn get(&self, _id: Uuid) -> Result<Option<Task>, AppError> {
        Ok(Some(self.task.clone()))
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
        _task_id: uuid::Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _claimed_at: chrono::DateTime<chrono::Utc>,
        _expired_before: chrono::DateTime<chrono::Utc>,
        _claim_token: uuid::Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }

    fn mark_reminder_delivered(
        &self,
        _task_id: uuid::Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _delivered_at: chrono::DateTime<chrono::Utc>,
        _claim_token: uuid::Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }

    fn release_reminder_claim(
        &self,
        _task_id: uuid::Uuid,
        _scheduled_at: chrono::DateTime<chrono::Utc>,
        _claim_token: uuid::Uuid,
    ) -> Result<bool, AppError> {
        Ok(false)
    }
}
