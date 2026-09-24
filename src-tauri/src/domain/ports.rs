use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{
    domain::{
        project::Project,
        recurrence::TaskCompletion,
        sync::{SyncConfig, SyncEntityKind, SyncSnapshot, SyncState},
        sync_merge::SyncFieldConflict,
        task::{ReminderClaimStateUpdate, Task},
        task_query::{TaskSummaryDto, TaskView},
    },
    error::AppError,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskEditor {
    pub task: Task,
    pub tag_names: Vec<String>,
    pub subtasks: Vec<Task>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubtaskInsertOutcome {
    Inserted,
    ParentMissing,
    ParentNested,
    ParentChanged,
}

pub trait ProjectRepository: Send + Sync {
    fn insert_project(&self, project: &Project) -> Result<(), AppError>;
    fn get_project(&self, id: Uuid) -> Result<Option<Project>, AppError>;
    fn update_project(&self, project: &Project) -> Result<(), AppError>;
    fn list_active_projects(&self) -> Result<Vec<Project>, AppError>;
}

pub trait TaskRepository: Send + Sync {
    fn insert(&self, task: &Task) -> Result<(), AppError>;
    fn update(
        &self,
        task: &Task,
        expected_revision: i64,
        reminder_claim_state_update: ReminderClaimStateUpdate,
    ) -> Result<(), AppError>;
    fn save_completion(
        &self,
        completion: &TaskCompletion,
        expected_revision: i64,
    ) -> Result<(), AppError>;
    fn get(&self, id: Uuid) -> Result<Option<Task>, AppError>;
    fn list_inbox(&self) -> Result<Vec<Task>, AppError>;
    fn list_tasks(&self, view: &TaskView) -> Result<Vec<TaskSummaryDto>, AppError>;
    fn list_due_reminder_candidates(
        &self,
        now: DateTime<Utc>,
        expired_before: DateTime<Utc>,
    ) -> Result<Vec<Task>, AppError>;
    fn claim_reminder(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        claimed_at: DateTime<Utc>,
        expired_before: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError>;
    fn mark_reminder_delivered(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        delivered_at: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError>;
    fn release_reminder_claim(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError>;
}

pub trait TaskEditorRepository: Send + Sync {
    fn create_editor(&self, task: &Task, tag_names: &[String]) -> Result<(), AppError>;
    fn update_editor(
        &self,
        task: &Task,
        expected_revision: i64,
        reminder_claim_state_update: ReminderClaimStateUpdate,
        tag_names: Option<&[String]>,
    ) -> Result<(), AppError>;
    fn get_editor(&self, id: Uuid) -> Result<Option<TaskEditor>, AppError>;
}

pub trait SubtaskRepository: Send + Sync {
    fn insert_subtask(
        &self,
        parent_snapshot: &Task,
        subtask: &Task,
    ) -> Result<SubtaskInsertOutcome, AppError>;
}

#[expect(dead_code, reason = "M2 AI 提示与配置流程接入前预留 provider 端口")]
pub trait AiProvider: Send + Sync {
    fn provider_id(&self) -> &str;
    fn validate_configuration(&self, base_url: &str) -> Result<(), AppError>;
}

#[expect(dead_code, reason = "M2 WebDAV 同步流程接入前预留同步后端端口")]
pub trait SyncBackend: Send + Sync {
    fn backend_kind(&self) -> SyncBackendKind;
}

pub trait SyncRepository: Send + Sync {
    fn get_local_sync_snapshot(&self) -> Result<SyncSnapshot, AppError>;
    fn apply_sync_snapshot(&self, snapshot: &SyncSnapshot) -> Result<(), AppError>;
    fn replace_sync_snapshot(&self, snapshot: &SyncSnapshot) -> Result<(), AppError>;
    fn get_sync_config(&self) -> Result<Option<SyncConfig>, AppError>;
    fn save_sync_config(&self, config: &SyncConfig) -> Result<(), AppError>;
    fn get_sync_state(&self) -> Result<SyncState, AppError>;
    fn save_sync_state(&self, state: &SyncState) -> Result<(), AppError>;
    fn save_sync_baseline(&self, snapshot: &SyncSnapshot) -> Result<(), AppError>;
    fn get_sync_baseline(&self) -> Result<Option<SyncSnapshot>, AppError>;
    fn save_sync_conflict(&self, conflict: &SyncFieldConflict) -> Result<(), AppError>;
    fn list_sync_conflicts(&self) -> Result<Vec<SyncFieldConflict>, AppError>;
    fn resolve_sync_conflict(
        &self,
        entity_id: Uuid,
        entity_kind: SyncEntityKind,
        field_name: &str,
        decision: &str,
    ) -> Result<(), AppError>;
}

#[expect(dead_code, reason = "M2 WebDAV 同步流程接入前预留后端类型")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyncBackendKind {
    WebDav,
}

#[expect(dead_code, reason = "M3 附件工作流接入前预留附件草稿")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttachmentDraft {
    pub task_id: Uuid,
    pub file_name: String,
    pub media_type: String,
}

#[expect(dead_code, reason = "M2 评论工作流接入前预留评论草稿")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommentDraft {
    pub task_id: Uuid,
    pub body: String,
}
