use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use super::{project::Project, task::Task};

pub const SYNC_SNAPSHOT_FORMAT_VERSION: u16 = 1;
pub const CONFLICT_COPY_SUFFIX: &str = "（冲突副本）";

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncEntityKind {
    Project,
    Tag,
    Task,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SyncEntity {
    pub id: Uuid,
    pub kind: SyncEntityKind,
    pub fields: BTreeMap<String, Value>,
    pub deleted: bool,
}

impl SyncEntity {
    pub fn new(id: Uuid, kind: SyncEntityKind, fields: BTreeMap<String, Value>) -> Self {
        Self {
            id,
            kind,
            fields,
            deleted: false,
        }
    }

    pub fn from_task(task: &Task) -> Result<Self, serde_json::Error> {
        Self::from_serializable(task.id, SyncEntityKind::Task, task)
    }

    pub fn from_project(project: &Project) -> Result<Self, serde_json::Error> {
        Self::from_serializable(project.id, SyncEntityKind::Project, project)
    }

    fn from_serializable<T>(
        id: Uuid,
        kind: SyncEntityKind,
        value: &T,
    ) -> Result<Self, serde_json::Error>
    where
        T: Serialize,
    {
        let Value::Object(object) = serde_json::to_value(value)? else {
            return Err(serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "sync entity must serialize to an object",
            )));
        };

        Ok(Self::new(id, kind, object.into_iter().collect()))
    }

    pub fn to_task(&self) -> Result<Task, serde_json::Error> {
        serde_json::from_value(Value::Object(self.fields.clone().into_iter().collect()))
    }

    pub fn to_project(&self) -> Result<Project, serde_json::Error> {
        serde_json::from_value(Value::Object(self.fields.clone().into_iter().collect()))
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SyncSnapshot {
    pub format_version: u16,
    pub snapshot_id: Uuid,
    pub generated_at: DateTime<Utc>,
    pub entities: Vec<SyncEntity>,
}

impl SyncSnapshot {
    pub fn new(snapshot_id: Uuid, entities: Vec<SyncEntity>) -> Self {
        Self {
            format_version: SYNC_SNAPSHOT_FORMAT_VERSION,
            snapshot_id,
            generated_at: Utc::now(),
            entities,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncStatus {
    Unconfigured,
    Scanning,
    Syncing,
    Synced,
    RetryPending,
    ConflictsPending,
    Paused,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncStrategy {
    SmartMerge,
    KeepLocal,
    KeepRemote,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncFrequency {
    OneMinute,
    FiveMinutes,
    FifteenMinutes,
    ThirtyMinutes,
    OneHour,
    Manual,
}

impl SyncFrequency {
    pub fn automatic_interval(self) -> Option<Duration> {
        match self {
            Self::OneMinute => Some(Duration::from_secs(60)),
            Self::FiveMinutes => Some(Duration::from_secs(5 * 60)),
            Self::FifteenMinutes => Some(Duration::from_secs(15 * 60)),
            Self::ThirtyMinutes => Some(Duration::from_secs(30 * 60)),
            Self::OneHour => Some(Duration::from_secs(60 * 60)),
            Self::Manual => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    pub endpoint: String,
    pub remote_directory: String,
    pub username: String,
    pub encryption_enabled: bool,
    pub paused: bool,
    pub strategy: SyncStrategy,
    pub frequency: SyncFrequency,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCounters {
    pub pending_upload: u32,
    pub pending_download: u32,
    pub conflicts: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub status: SyncStatus,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub last_error_code: Option<String>,
    pub counters: SyncCounters,
    pub baseline_snapshot_id: Option<Uuid>,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            status: SyncStatus::Unconfigured,
            last_synced_at: None,
            last_error_code: None,
            counters: SyncCounters::default(),
            baseline_snapshot_id: None,
        }
    }
}
