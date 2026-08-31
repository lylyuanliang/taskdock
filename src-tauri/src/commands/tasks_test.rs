use std::sync::Mutex;

use chrono::{TimeZone, Utc};
use uuid::Uuid;

use super::tasks::{
    create_task_with_service, create_task_with_services, list_inbox_with_service,
    list_tasks_with_service, update_task_with_service, update_task_with_services, CommandError,
    TaskDraftDto, TaskPatchDto, TaskViewDto,
};
use crate::{
    domain::{
        ports::TaskRepository,
        project_service::ProjectService,
        task::{Priority, Task, TaskDraft, TaskPatch},
        task_query::TaskView,
        task_service::TaskService,
    },
    error::AppError,
    infrastructure::sqlite::SqliteTaskRepository,
};

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
    archived_task.project_id = Some(archived_project.id);
    repository.update(&archived_task).unwrap();

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
fn create_task_returns_serializable_validation_error() {
    let service = TaskService::new(RecordingRepository::default());

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
fn list_inbox_with_service_returns_serializable_task_dtos() {
    let service = TaskService::new(RecordingRepository::default());

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

#[derive(Default)]
struct RecordingRepository;

impl TaskRepository for RecordingRepository {
    fn insert(&self, _task: &Task) -> Result<(), AppError> {
        Ok(())
    }

    fn update(&self, _task: &Task) -> Result<(), AppError> {
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
        view: &TaskView,
    ) -> Result<Vec<crate::domain::task_query::TaskSummaryDto>, AppError> {
        let mut captured_view = self
            .view
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *captured_view = Some(view.clone());

        Ok(Vec::new())
    }
}

impl TaskRepository for ExistingTaskRepository {
    fn insert(&self, _task: &Task) -> Result<(), AppError> {
        Ok(())
    }

    fn update(&self, _task: &Task) -> Result<(), AppError> {
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
}
