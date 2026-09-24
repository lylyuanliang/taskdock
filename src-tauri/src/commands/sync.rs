use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    domain::{
        ports::SyncRepository,
        sync::{SyncConfig, SyncEntityKind, SyncState, SyncStatus, SyncStrategy},
        sync_merge::SyncFieldConflict,
        sync_service::SyncRunSummary,
    },
    error::AppError,
    infrastructure::sync_crypto::CredentialStore,
    AppState,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SaveSyncConfigInput {
    pub(crate) endpoint: String,
    pub(crate) remote_directory: String,
    pub(crate) username: String,
    pub(crate) webdav_password: String,
    pub(crate) encryption_passphrase: String,
    pub(crate) encryption_enabled: bool,
    pub(crate) paused: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TestSyncConnectionInput {
    pub(crate) endpoint: String,
    pub(crate) remote_directory: String,
    pub(crate) username: String,
    pub(crate) webdav_password: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncConfigDto {
    endpoint: String,
    remote_directory: String,
    username: String,
    encryption_enabled: bool,
    paused: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncStateDto {
    status: SyncStatus,
    last_synced_at: Option<chrono::DateTime<chrono::Utc>>,
    last_error_code: Option<String>,
    pending_upload: u32,
    pending_download: u32,
    conflicts: u32,
    baseline_snapshot_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncConflictDto {
    entity_id: String,
    entity_kind: SyncEntityKind,
    field_name: String,
    local_value: Option<serde_json::Value>,
    remote_value: Option<serde_json::Value>,
    base_value: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ResolveSyncConflictInput {
    pub(crate) entity_id: String,
    pub(crate) entity_kind: String,
    pub(crate) field_name: String,
    pub(crate) decision: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncConnectionDto {
    pub(crate) ok: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SyncNowInput {
    pub(crate) strategy: SyncStrategy,
}

#[tauri::command]
pub(crate) fn get_sync_config(
    state: State<'_, AppState>,
) -> Result<Option<SyncConfigDto>, SyncCommandError> {
    state
        .sync_repository
        .get_sync_config()
        .map(|config| config.map(SyncConfigDto::from))
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn save_sync_config(
    state: State<'_, AppState>,
    input: SaveSyncConfigInput,
) -> Result<SyncConfigDto, SyncCommandError> {
    let endpoint = input.endpoint.trim().to_owned();
    let remote_directory = input.remote_directory.trim().to_owned();
    let username = input.username.trim().to_owned();
    if endpoint.is_empty()
        || remote_directory.is_empty()
        || username.is_empty()
        || input.webdav_password.is_empty()
        || (input.encryption_enabled && input.encryption_passphrase.is_empty())
    {
        return Err(SyncCommandError::invalid_input());
    }

    let config = SyncConfig {
        endpoint,
        remote_directory,
        username: username.clone(),
        encryption_enabled: input.encryption_enabled,
        paused: input.paused,
    };
    state
        .sync_credentials
        .save_secret(&format!("webdav:{username}"), &input.webdav_password)
        .map_err(SyncCommandError::from)?;
    if input.encryption_enabled {
        state
            .sync_credentials
            .save_secret(
                &format!("encryption:{username}"),
                &input.encryption_passphrase,
            )
            .map_err(SyncCommandError::from)?;
    } else {
        state
            .sync_credentials
            .delete_secret(&format!("encryption:{username}"))
            .map_err(SyncCommandError::from)?;
    }
    state
        .sync_repository
        .save_sync_config(&config)
        .map_err(SyncCommandError::from)?;
    if let Err(error) = state.sync_worker.request_sync() {
        eprintln!("sync background request failed: {error}");
    }

    Ok(SyncConfigDto::from(config))
}

#[tauri::command]
pub(crate) async fn test_sync_connection(
    state: State<'_, AppState>,
    input: TestSyncConnectionInput,
) -> Result<SyncConnectionDto, SyncCommandError> {
    let (config, password) = normalize_test_connection_input(input)?;
    state
        .sync_service
        .test_connection_with_config(&config, &password)
        .await
        .map(|_| SyncConnectionDto { ok: true })
        .map_err(Into::into)
}

fn normalize_test_connection_input(
    input: TestSyncConnectionInput,
) -> Result<(SyncConfig, String), SyncCommandError> {
    let endpoint = input.endpoint.trim().to_owned();
    let remote_directory = input.remote_directory.trim().to_owned();
    let username = input.username.trim().to_owned();
    if endpoint.is_empty() || remote_directory.is_empty() || username.is_empty() {
        return Err(SyncCommandError::invalid_input());
    }
    if input.webdav_password.is_empty() {
        return Err(SyncCommandError::invalid_input());
    }

    Ok((
        SyncConfig {
            endpoint,
            remote_directory,
            username,
            encryption_enabled: false,
            paused: false,
        },
        input.webdav_password,
    ))
}

#[tauri::command]
pub(crate) fn get_sync_status(
    state: State<'_, AppState>,
) -> Result<SyncStateDto, SyncCommandError> {
    state
        .sync_repository
        .get_sync_state()
        .map(SyncStateDto::from)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn sync_now(
    state: State<'_, AppState>,
    input: Option<SyncNowInput>,
) -> Result<SyncRunSummary, SyncCommandError> {
    match input {
        Some(input) => state
            .sync_service
            .sync_now_with_strategy(input.strategy)
            .await
            .map_err(Into::into),
        None => state.sync_service.sync_now().await.map_err(Into::into),
    }
}

#[tauri::command]
pub(crate) fn pause_sync(state: State<'_, AppState>) -> Result<SyncStateDto, SyncCommandError> {
    update_paused_state(&state, true)
}

#[tauri::command]
pub(crate) fn resume_sync(state: State<'_, AppState>) -> Result<SyncStateDto, SyncCommandError> {
    update_paused_state(&state, false)
}

#[tauri::command]
pub(crate) fn list_sync_conflicts(
    state: State<'_, AppState>,
) -> Result<Vec<SyncConflictDto>, SyncCommandError> {
    state
        .sync_repository
        .list_sync_conflicts()
        .map(|conflicts| conflicts.into_iter().map(SyncConflictDto::from).collect())
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn resolve_sync_conflict(
    state: State<'_, AppState>,
    input: ResolveSyncConflictInput,
) -> Result<(), SyncCommandError> {
    let entity_id =
        uuid::Uuid::parse_str(&input.entity_id).map_err(|_| SyncCommandError::invalid_input())?;
    let entity_kind = parse_entity_kind(&input.entity_kind)?;
    if !matches!(
        input.decision.as_str(),
        "keepLocal" | "acceptRemote" | "createConflictCopy"
    ) {
        return Err(SyncCommandError::invalid_input());
    }
    state
        .sync_repository
        .resolve_sync_conflict(entity_id, entity_kind, &input.field_name, &input.decision)
        .map_err(Into::into)
}

fn update_paused_state(
    state: &State<'_, AppState>,
    paused: bool,
) -> Result<SyncStateDto, SyncCommandError> {
    let mut config = state
        .sync_repository
        .get_sync_config()
        .map_err(SyncCommandError::from)?
        .ok_or_else(SyncCommandError::configuration_missing)?;
    config.paused = paused;
    state
        .sync_repository
        .save_sync_config(&config)
        .map_err(SyncCommandError::from)?;
    let mut sync_state = state
        .sync_repository
        .get_sync_state()
        .map_err(SyncCommandError::from)?;
    sync_state.status = if paused {
        SyncStatus::Paused
    } else {
        SyncStatus::RetryPending
    };
    state
        .sync_repository
        .save_sync_state(&sync_state)
        .map_err(SyncCommandError::from)?;
    if !paused {
        if let Err(error) = state.sync_worker.request_sync() {
            eprintln!("sync background request failed: {error}");
        }
    }

    Ok(SyncStateDto::from(sync_state))
}

fn parse_entity_kind(value: &str) -> Result<SyncEntityKind, SyncCommandError> {
    match value {
        "task" => Ok(SyncEntityKind::Task),
        "project" => Ok(SyncEntityKind::Project),
        "tag" => Ok(SyncEntityKind::Tag),
        _ => Err(SyncCommandError::invalid_input()),
    }
}

impl From<SyncConfig> for SyncConfigDto {
    fn from(config: SyncConfig) -> Self {
        Self {
            endpoint: config.endpoint,
            remote_directory: config.remote_directory,
            username: config.username,
            encryption_enabled: config.encryption_enabled,
            paused: config.paused,
        }
    }
}

impl From<SyncState> for SyncStateDto {
    fn from(state: SyncState) -> Self {
        Self {
            status: state.status,
            last_synced_at: state.last_synced_at,
            last_error_code: state.last_error_code,
            pending_upload: state.counters.pending_upload,
            pending_download: state.counters.pending_download,
            conflicts: state.counters.conflicts,
            baseline_snapshot_id: state.baseline_snapshot_id.map(|id| id.to_string()),
        }
    }
}

impl From<SyncFieldConflict> for SyncConflictDto {
    fn from(conflict: SyncFieldConflict) -> Self {
        Self {
            entity_id: conflict.entity_id.to_string(),
            entity_kind: conflict.entity_kind,
            field_name: conflict.field_name,
            local_value: conflict.local_value,
            remote_value: conflict.remote_value,
            base_value: conflict.base_value,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct SyncCommandError {
    code: String,
    message_key: String,
}

impl From<AppError> for SyncCommandError {
    fn from(error: AppError) -> Self {
        Self {
            code: error.code().to_owned(),
            message_key: error.translation_key().to_owned(),
        }
    }
}

impl SyncCommandError {
    fn invalid_input() -> Self {
        Self {
            code: "sync.input.invalid".to_owned(),
            message_key: "errors.sync.input.invalid".to_owned(),
        }
    }

    fn configuration_missing() -> Self {
        Self {
            code: "sync.configuration.missing".to_owned(),
            message_key: "errors.sync.configuration.missing".to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_test_connection_input, SyncCommandError, TestSyncConnectionInput};

    #[test]
    fn rejects_blank_test_connection_fields_without_touching_persistence() {
        let error = normalize_test_connection_input(TestSyncConnectionInput {
            endpoint: " ".to_owned(),
            remote_directory: "taskdock-sync".to_owned(),
            username: "user".to_owned(),
            webdav_password: "password".to_owned(),
        })
        .unwrap_err();

        assert_eq!(error, SyncCommandError::invalid_input());
    }
}
