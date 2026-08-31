use uuid::Uuid;

use crate::{
    domain::{
        ports::TaskRepository,
        task::{Task, TaskDraft, TaskPatch},
        task_query::{TaskSummaryDto, TaskView},
    },
    error::AppError,
};

pub struct TaskService<R>
where
    R: TaskRepository,
{
    repository: R,
}

impl<R> TaskService<R>
where
    R: TaskRepository,
{
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    pub fn create(&self, draft: TaskDraft) -> Result<Task, AppError> {
        let task = Task::from_draft(draft)?;
        self.repository.insert(&task)?;

        Ok(task)
    }

    pub fn patch(&self, id: Uuid, patch: TaskPatch) -> Result<Option<Task>, AppError> {
        let Some(task) = self.repository.get(id)? else {
            return Ok(None);
        };
        let task = task.apply_patch(patch)?;
        self.repository.update(&task)?;

        Ok(Some(task))
    }

    pub fn list_inbox(&self) -> Result<Vec<Task>, AppError> {
        self.repository.list_inbox()
    }

    pub fn list_tasks(&self, view: TaskView) -> Result<Vec<TaskSummaryDto>, AppError> {
        self.repository.list_tasks(&view)
    }
}
