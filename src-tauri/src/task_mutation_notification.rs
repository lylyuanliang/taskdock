use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::{AppError, AppErrorKind};

pub(crate) const TASK_MUTATED_EVENT: &str = "task://mutated";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskMutationEvent {
    task_id: String,
    revision: i64,
}

impl TaskMutationEvent {
    pub(crate) fn new(task_id: impl ToString, revision: i64) -> Self {
        Self {
            task_id: task_id.to_string(),
            revision,
        }
    }
}

pub(crate) trait TaskMutationNotifier: Send + Sync {
    fn notify(&self, event: TaskMutationEvent) -> Result<(), AppError>;
}

pub(crate) struct TauriTaskMutationNotifier<R: Runtime> {
    app_handle: AppHandle<R>,
}

impl<R: Runtime> TauriTaskMutationNotifier<R> {
    pub(crate) fn new(app_handle: AppHandle<R>) -> Self {
        Self { app_handle }
    }
}

impl<R: Runtime> TaskMutationNotifier for TauriTaskMutationNotifier<R> {
    fn notify(&self, event: TaskMutationEvent) -> Result<(), AppError> {
        self.app_handle
            .emit(TASK_MUTATED_EVENT, event)
            .map_err(|_| task_mutation_notification_error())
    }
}

fn task_mutation_notification_error() -> AppError {
    AppError::new(
        "task.mutation_notification.failed",
        "errors.task.mutation_notification.failed",
        AppErrorKind::Internal,
    )
}
