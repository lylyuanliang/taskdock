use std::sync::Arc;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    ports::SyncRepository,
    sync::{SyncSnapshot, SyncState, SyncStatus, SyncStrategy},
    sync_merge::{merge_snapshots, MergePlan, MergeSummary},
};
use crate::{
    error::{AppError, AppErrorKind},
    infrastructure::{
        sync_crypto::{decrypt_snapshot, encrypt_snapshot, CredentialStore},
        webdav::WebDavTransport,
    },
};

const CONFIG_ERROR_CODE: &str = "sync.configuration.missing";
const CONFIG_ERROR_KEY: &str = "errors.sync.configuration.missing";
const SNAPSHOT_ERROR_CODE: &str = "sync.snapshot.invalid";
const SNAPSHOT_ERROR_KEY: &str = "errors.sync.snapshot.invalid";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRunSummary {
    pub status: SyncStatus,
    pub local_only: u32,
    pub remote_only: u32,
    pub merged: u32,
    pub conflicts: u32,
    pub uploaded: bool,
}

impl Default for SyncRunSummary {
    fn default() -> Self {
        Self {
            status: SyncStatus::Unconfigured,
            local_only: 0,
            remote_only: 0,
            merged: 0,
            conflicts: 0,
            uploaded: false,
        }
    }
}

pub struct SyncService<R, T, C> {
    repository: Arc<R>,
    transport: Arc<T>,
    credentials: Arc<C>,
}

impl<R, T, C> SyncService<R, T, C>
where
    R: SyncRepository + 'static,
    T: WebDavTransport + 'static,
    C: CredentialStore + 'static,
{
    pub fn new(repository: Arc<R>, transport: Arc<T>, credentials: Arc<C>) -> Self {
        Self {
            repository,
            transport,
            credentials,
        }
    }

    pub async fn sync_now(&self) -> Result<SyncRunSummary, AppError> {
        self.sync_now_with_strategy(SyncStrategy::SmartMerge).await
    }

    pub async fn sync_now_with_strategy(
        &self,
        strategy: SyncStrategy,
    ) -> Result<SyncRunSummary, AppError> {
        let config = self
            .repository
            .get_sync_config()?
            .ok_or_else(configuration_error)?;
        if config.paused {
            return Ok(SyncRunSummary {
                status: SyncStatus::Paused,
                ..SyncRunSummary::default()
            });
        }
        let password_key = webdav_password_key(&config.username);
        let password = self
            .credentials
            .load_secret(&password_key)?
            .ok_or_else(configuration_error)?;
        let encryption_passphrase = if config.encryption_enabled {
            self.credentials
                .load_secret(&encryption_key(&config.username))?
                .ok_or_else(configuration_error)?
        } else {
            String::new()
        };
        let local = self.repository.get_local_sync_snapshot()?;
        let baseline = self
            .repository
            .get_sync_baseline()?
            .unwrap_or_else(|| SyncSnapshot::new(Uuid::nil(), Vec::new()));
        let remote_payload = match self.transport.fetch_snapshot(&config, &password).await {
            Ok(payload) => payload,
            Err(error) => {
                self.record_sync_failure(&error)?;
                return Err(error);
            }
        };

        let Some(remote_payload) = remote_payload else {
            let payload = encode_snapshot(&local, &config, &encryption_passphrase)?;
            if let Err(error) = self
                .transport
                .store_snapshot(&config, &password, &payload)
                .await
            {
                self.record_sync_failure(&error)?;
                return Err(error);
            }
            self.repository.save_sync_baseline(&local)?;
            self.repository.save_sync_state(&synced_state(&local))?;
            return Ok(SyncRunSummary {
                status: SyncStatus::Synced,
                uploaded: true,
                ..SyncRunSummary::default()
            });
        };

        let remote = decode_snapshot(&remote_payload, &config, &encryption_passphrase)?;
        let plan = match strategy {
            SyncStrategy::SmartMerge => {
                merge_snapshots(&baseline.entities, &local.entities, &remote.entities)
            }
            SyncStrategy::KeepLocal => preferred_snapshot_plan(&local),
            SyncStrategy::KeepRemote => preferred_snapshot_plan(&remote),
        };
        for conflict in &plan.conflicts {
            self.repository.save_sync_conflict(conflict)?;
        }
        if !plan.conflicts.is_empty() {
            let mut state = self.repository.get_sync_state()?;
            state.status = SyncStatus::ConflictsPending;
            state.counters.conflicts = plan.conflicts.len() as u32;
            self.repository.save_sync_state(&state)?;
            return Ok(summary_from_plan(
                &plan,
                SyncStatus::ConflictsPending,
                false,
            ));
        }

        let merged_snapshot = SyncSnapshot::new(Uuid::new_v4(), plan.entities.clone());
        if strategy == SyncStrategy::KeepRemote {
            self.repository.replace_sync_snapshot(&merged_snapshot)?;
        } else {
            self.repository.apply_sync_snapshot(&merged_snapshot)?;
        }
        let final_local = self.repository.get_local_sync_snapshot()?;
        let payload = encode_snapshot(&final_local, &config, &encryption_passphrase)?;
        if let Err(error) = self
            .transport
            .store_snapshot(&config, &password, &payload)
            .await
        {
            self.record_sync_failure(&error)?;
            return Err(error);
        }
        self.repository.save_sync_baseline(&final_local)?;
        self.repository
            .save_sync_state(&synced_state(&final_local))?;

        Ok(summary_from_plan(&plan, SyncStatus::Synced, true))
    }

    pub async fn test_connection(&self) -> Result<(), AppError> {
        let config = self
            .repository
            .get_sync_config()?
            .ok_or_else(configuration_error)?;
        let password_key = webdav_password_key(&config.username);
        let password = self
            .credentials
            .load_secret(&password_key)?
            .ok_or_else(configuration_error)?;
        self.transport.test_connection(&config, &password).await
    }

    fn record_sync_failure(&self, error: &AppError) -> Result<(), AppError> {
        let mut state = self.repository.get_sync_state()?;
        state.status = if error.code() == "sync.remote.authentication_failed" {
            SyncStatus::Paused
        } else {
            SyncStatus::RetryPending
        };
        state.last_error_code = Some(error.code().to_owned());
        self.repository.save_sync_state(&state)
    }
}

fn preferred_snapshot_plan(snapshot: &SyncSnapshot) -> MergePlan {
    MergePlan {
        entities: snapshot.entities.clone(),
        conflicts: Vec::new(),
        summary: MergeSummary {
            merged: snapshot.entities.len() as u32,
            ..MergeSummary::default()
        },
    }
}

fn encode_snapshot(
    snapshot: &SyncSnapshot,
    config: &super::sync::SyncConfig,
    passphrase: &str,
) -> Result<Vec<u8>, AppError> {
    let json = serde_json::to_vec(snapshot).map_err(|_| snapshot_error())?;
    if config.encryption_enabled {
        Ok(encrypt_snapshot(&json, passphrase)?.into_bytes())
    } else {
        Ok(json)
    }
}

fn decode_snapshot(
    payload: &[u8],
    config: &super::sync::SyncConfig,
    passphrase: &str,
) -> Result<SyncSnapshot, AppError> {
    let json = if config.encryption_enabled {
        let encoded = std::str::from_utf8(payload).map_err(|_| snapshot_error())?;
        decrypt_snapshot(encoded, passphrase)?
    } else {
        payload.to_vec()
    };
    serde_json::from_slice(&json).map_err(|_| snapshot_error())
}

fn summary_from_plan(plan: &MergePlan, status: SyncStatus, uploaded: bool) -> SyncRunSummary {
    SyncRunSummary {
        status,
        local_only: plan.summary.local_only,
        remote_only: plan.summary.remote_only,
        merged: plan.summary.merged,
        conflicts: plan.summary.conflicts,
        uploaded,
    }
}

fn synced_state(snapshot: &SyncSnapshot) -> SyncState {
    SyncState {
        status: SyncStatus::Synced,
        last_synced_at: Some(snapshot.generated_at),
        last_error_code: None,
        counters: Default::default(),
        baseline_snapshot_id: Some(snapshot.snapshot_id),
    }
}

fn webdav_password_key(username: &str) -> String {
    format!("webdav:{username}")
}

fn encryption_key(username: &str) -> String {
    format!("encryption:{username}")
}

fn configuration_error() -> AppError {
    AppError::new(
        CONFIG_ERROR_CODE,
        CONFIG_ERROR_KEY,
        AppErrorKind::Configuration,
    )
}

fn snapshot_error() -> AppError {
    AppError::new(
        SNAPSHOT_ERROR_CODE,
        SNAPSHOT_ERROR_KEY,
        AppErrorKind::Conflict,
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use crate::{
        domain::{
            ports::{SyncRepository, TaskRepository},
            sync::{SyncConfig, SyncEntity, SyncSnapshot, SyncStrategy},
            task::Task,
        },
        infrastructure::{
            sqlite::SqliteTaskRepository,
            sync_crypto::{encrypt_snapshot, CredentialStore},
            webdav::{TransportFuture, WebDavTransport},
        },
    };

    use super::*;

    #[derive(Clone, Default)]
    struct FakeCredentials {
        values: Arc<Mutex<std::collections::HashMap<String, String>>>,
    }

    impl CredentialStore for FakeCredentials {
        fn save_secret(&self, key: &str, secret: &str) -> Result<(), AppError> {
            self.values
                .lock()
                .map_err(|_| configuration_error())?
                .insert(key.to_owned(), secret.to_owned());
            Ok(())
        }

        fn load_secret(&self, key: &str) -> Result<Option<String>, AppError> {
            Ok(self
                .values
                .lock()
                .map_err(|_| configuration_error())?
                .get(key)
                .cloned())
        }

        fn delete_secret(&self, key: &str) -> Result<(), AppError> {
            self.values
                .lock()
                .map_err(|_| configuration_error())?
                .remove(key);
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct FakeTransport {
        payload: Arc<Mutex<Option<Vec<u8>>>>,
    }

    impl WebDavTransport for FakeTransport {
        fn test_connection<'a>(
            &'a self,
            _config: &'a SyncConfig,
            _password: &'a str,
        ) -> TransportFuture<'a, ()> {
            Box::pin(async { Ok(()) })
        }

        fn fetch_snapshot<'a>(
            &'a self,
            _config: &'a SyncConfig,
            _password: &'a str,
        ) -> TransportFuture<'a, Option<Vec<u8>>> {
            let payload = Arc::clone(&self.payload);
            Box::pin(async move { Ok(payload.lock().map_err(|_| configuration_error())?.clone()) })
        }

        fn store_snapshot<'a>(
            &'a self,
            _config: &'a SyncConfig,
            _password: &'a str,
            payload: &'a [u8],
        ) -> TransportFuture<'a, ()> {
            let stored = Arc::clone(&self.payload);
            let payload = payload.to_vec();
            Box::pin(async move {
                stored
                    .lock()
                    .map_err(|_| configuration_error())?
                    .replace(payload);
                Ok(())
            })
        }
    }

    #[test]
    fn password_key_is_namespaced() {
        assert_eq!(webdav_password_key("alice"), "webdav:alice");
    }

    #[tokio::test]
    async fn first_sync_uploads_local_snapshot_and_persists_baseline() {
        let repository = Arc::new(SqliteTaskRepository::in_memory().unwrap());
        let config = SyncConfig {
            endpoint: "https://dav.example.test".to_owned(),
            remote_directory: "todo".to_owned(),
            username: "alice".to_owned(),
            encryption_enabled: true,
            paused: false,
        };
        repository.save_sync_config(&config).unwrap();
        let task = Task::for_test("First sync".to_owned());
        repository.insert(&task).unwrap();
        let credentials = Arc::new(FakeCredentials::default());
        credentials
            .save_secret("webdav:alice", "dav-password")
            .unwrap();
        credentials
            .save_secret("encryption:alice", "sync-passphrase")
            .unwrap();
        let transport = Arc::new(FakeTransport::default());
        let service = SyncService::new(
            Arc::clone(&repository),
            Arc::clone(&transport),
            Arc::clone(&credentials),
        );

        let result = service.sync_now().await.unwrap();

        assert_eq!(result.status, SyncStatus::Synced);
        assert!(result.uploaded);
        assert!(repository.get_sync_baseline().unwrap().is_some());
        assert!(transport.payload.lock().unwrap().is_some());
    }

    #[tokio::test]
    async fn unencrypted_sync_does_not_require_an_encryption_passphrase() {
        let repository = Arc::new(SqliteTaskRepository::in_memory().unwrap());
        let config = SyncConfig {
            endpoint: "https://dav.example.test".to_owned(),
            remote_directory: "todo".to_owned(),
            username: "alice".to_owned(),
            encryption_enabled: false,
            paused: false,
        };
        repository.save_sync_config(&config).unwrap();
        repository
            .insert(&Task::for_test("Plain snapshot".to_owned()))
            .unwrap();
        let credentials = Arc::new(FakeCredentials::default());
        credentials
            .save_secret("webdav:alice", "dav-password")
            .unwrap();
        let transport = Arc::new(FakeTransport::default());
        let service = SyncService::new(
            Arc::clone(&repository),
            Arc::clone(&transport),
            Arc::clone(&credentials),
        );

        let result = service.sync_now().await.unwrap();

        assert_eq!(result.status, SyncStatus::Synced);
        assert!(result.uploaded);
    }

    #[tokio::test]
    async fn same_field_changes_are_recorded_as_conflicts_without_uploading() {
        let repository = Arc::new(SqliteTaskRepository::in_memory().unwrap());
        let config = SyncConfig {
            endpoint: "https://dav.example.test".to_owned(),
            remote_directory: "todo".to_owned(),
            username: "alice".to_owned(),
            encryption_enabled: true,
            paused: false,
        };
        repository.save_sync_config(&config).unwrap();
        let task = Task::for_test("Base title".to_owned());
        repository.insert(&task).unwrap();
        let credentials = Arc::new(FakeCredentials::default());
        credentials
            .save_secret("webdav:alice", "dav-password")
            .unwrap();
        credentials
            .save_secret("encryption:alice", "sync-passphrase")
            .unwrap();
        let transport = Arc::new(FakeTransport::default());
        let service = SyncService::new(
            Arc::clone(&repository),
            Arc::clone(&transport),
            Arc::clone(&credentials),
        );
        service.sync_now().await.unwrap();
        let mut local = repository.get(task.id).unwrap().unwrap();
        local.title = "Local title".to_owned();
        local.revision += 1;
        repository
            .update(
                &local,
                task.revision,
                crate::domain::task::ReminderClaimStateUpdate::Preserve,
            )
            .unwrap();
        let mut remote = local.clone();
        remote.title = "Remote title".to_owned();
        remote.revision += 1;
        let remote_snapshot = SyncSnapshot::new(
            Uuid::new_v4(),
            vec![SyncEntity::from_task(&remote).unwrap()],
        );
        let encoded = serde_json::to_vec(&remote_snapshot).unwrap();
        transport.payload.lock().unwrap().replace(
            encrypt_snapshot(&encoded, "sync-passphrase")
                .unwrap()
                .into_bytes(),
        );

        let result = service.sync_now().await.unwrap();

        assert_eq!(result.status, SyncStatus::ConflictsPending);
        assert_eq!(result.conflicts, 1);
        assert_eq!(repository.list_sync_conflicts().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn keep_remote_strategy_replaces_local_entities_absent_from_remote() {
        let repository = Arc::new(SqliteTaskRepository::in_memory().unwrap());
        let config = SyncConfig {
            endpoint: "https://dav.example.test".to_owned(),
            remote_directory: "todo".to_owned(),
            username: "alice".to_owned(),
            encryption_enabled: false,
            paused: false,
        };
        repository.save_sync_config(&config).unwrap();
        let credentials = Arc::new(FakeCredentials::default());
        credentials
            .save_secret("webdav:alice", "dav-password")
            .unwrap();
        let transport = Arc::new(FakeTransport::default());
        let service = SyncService::new(
            Arc::clone(&repository),
            Arc::clone(&transport),
            Arc::clone(&credentials),
        );
        repository
            .insert(&Task::for_test("Local only".to_owned()))
            .unwrap();
        service.sync_now().await.unwrap();

        let remote_task = Task::for_test("Remote only".to_owned());
        let remote_snapshot = SyncSnapshot::new(
            Uuid::new_v4(),
            vec![SyncEntity::from_task(&remote_task).unwrap()],
        );
        transport
            .payload
            .lock()
            .unwrap()
            .replace(serde_json::to_vec(&remote_snapshot).unwrap());

        let result = service
            .sync_now_with_strategy(SyncStrategy::KeepRemote)
            .await
            .unwrap();

        assert_eq!(result.status, SyncStatus::Synced);
        assert_eq!(
            repository.get(remote_task.id).unwrap().unwrap().title,
            "Remote only"
        );
        assert_eq!(
            repository.get_local_sync_snapshot().unwrap().entities.len(),
            1
        );
    }
}
