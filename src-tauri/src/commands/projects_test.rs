use serde_json::json;
use uuid::Uuid;

use super::projects::{
    archive_project_with_body, create_project_with_body, create_project_with_service,
    list_projects_with_body, rename_project_with_body, rename_project_with_service, CommandError,
};
use crate::{
    domain::project_service::ProjectService, infrastructure::sqlite::SqliteTaskRepository,
};

#[test]
fn project_commands_reject_unknown_fields_and_malformed_ids() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let service = ProjectService::new(repository);

    assert_eq!(
        create_project_with_service(&service, Some(json!({ "name": "Inbox", "extra": true })))
            .unwrap_err(),
        CommandError::invalid_project_input()
    );
    assert_eq!(
        rename_project_with_service(&service, Some(json!({ "id": "bad-id", "name": "Inbox" })))
            .unwrap_err(),
        CommandError::invalid_project_input()
    );
}

#[test]
fn project_commands_validate_complete_raw_request_bodies() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let service = ProjectService::new(repository);

    for result in [
        create_project_with_body(
            &service,
            &tauri::ipc::InvokeBody::Json(json!({ "name": "Release", "extra": true })),
        )
        .map(|_| ()),
        create_project_with_body(&service, &tauri::ipc::InvokeBody::Json(json!({}))).map(|_| ()),
        rename_project_with_body(
            &service,
            &tauri::ipc::InvokeBody::Json(json!({ "id": "bad-id", "name": "Release" })),
        )
        .map(|_| ()),
        rename_project_with_body(
            &service,
            &tauri::ipc::InvokeBody::Json(json!({ "id": Uuid::new_v4() })),
        )
        .map(|_| ()),
        archive_project_with_body(
            &service,
            &tauri::ipc::InvokeBody::Json(json!({ "id": "bad-id", "extra": true })),
        )
        .map(|_| ()),
        archive_project_with_body(&service, &tauri::ipc::InvokeBody::Json(json!({}))).map(|_| ()),
        list_projects_with_body(
            &service,
            &tauri::ipc::InvokeBody::Json(json!({ "extra": true })),
        )
        .map(|_| ()),
    ] {
        let error = result.unwrap_err();
        assert_eq!(error, CommandError::invalid_project_input());
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({
                "code": "project.input.invalid",
                "message_key": "errors.project.input.invalid"
            })
        );
    }

    assert!(
        list_projects_with_body(&service, &tauri::ipc::InvokeBody::Json(json!({})))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn project_commands_create_and_report_case_insensitive_duplicate_names() {
    let repository = SqliteTaskRepository::in_memory().unwrap();
    let service = ProjectService::new(repository);

    let created =
        create_project_with_service(&service, Some(json!({ "name": "Release" }))).unwrap();

    assert_eq!(serde_json::to_value(created).unwrap()["name"], "Release");
    assert_eq!(
        create_project_with_service(&service, Some(json!({ "name": "release" }))).unwrap_err(),
        CommandError {
            code: "project.name.duplicate".into(),
            message_key: "errors.project.name.duplicate".into(),
        }
    );
}
