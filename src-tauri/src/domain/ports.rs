use uuid::Uuid;

use crate::{
    domain::{
        project::Project,
        task::Task,
        task_query::{TaskSummaryDto, TaskView},
    },
    error::AppError,
};

pub trait ProjectRepository: Send + Sync {
    fn insert_project(&self, project: &Project) -> Result<(), AppError>;
    fn get_project(&self, id: Uuid) -> Result<Option<Project>, AppError>;
    fn update_project(&self, project: &Project) -> Result<(), AppError>;
    fn list_active_projects(&self) -> Result<Vec<Project>, AppError>;
}

pub trait TaskRepository: Send + Sync {
    fn insert(&self, task: &Task) -> Result<(), AppError>;
    fn update(&self, task: &Task) -> Result<(), AppError>;
    fn get(&self, id: Uuid) -> Result<Option<Task>, AppError>;
    fn list_inbox(&self) -> Result<Vec<Task>, AppError>;
    fn list_tasks(&self, view: &TaskView) -> Result<Vec<TaskSummaryDto>, AppError>;
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
