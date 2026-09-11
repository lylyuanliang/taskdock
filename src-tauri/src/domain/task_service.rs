use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{
    domain::{
        ports::{
            SubtaskInsertOutcome, SubtaskRepository, TaskEditor, TaskEditorRepository,
            TaskRepository,
        },
        recurrence::{complete_task, TaskCompletion},
        task::{Task, TaskDraft, TaskPatch},
        task_query::{TaskSummaryDto, TaskView},
    },
    error::{AppError, AppErrorKind},
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
        validate_draft_structure(&draft)?;
        let task = Task::from_draft(draft)?;
        self.repository.insert(&task)?;

        Ok(task)
    }

    #[cfg(test)]
    pub fn patch(&self, id: Uuid, patch: TaskPatch) -> Result<Option<Task>, AppError> {
        self.patch_with_pre_update_validation(id, patch, |_, _| Ok(()))
    }

    pub fn patch_with_pre_update_validation<F>(
        &self,
        id: Uuid,
        patch: TaskPatch,
        validate: F,
    ) -> Result<Option<Task>, AppError>
    where
        F: FnOnce(&Task, &TaskPatch) -> Result<(), AppError>,
    {
        validate_patch_structure(&patch)?;
        validate_patch_completion(&patch)?;
        let Some(task) = self.repository.get(id)? else {
            return Ok(None);
        };
        validate(&task, &patch)?;
        validate_subtask_project_patch(&task, &patch)?;
        if task.completed_at.is_some()
            && task.recurrence.is_some()
            && patch
                .completed_at
                .as_ref()
                .is_some_and(|completed_at| completed_at.is_none())
        {
            return Err(AppError::new(
                "task.recurrence.restore.unsupported",
                "errors.task.recurrence.restore.unsupported",
                AppErrorKind::Conflict,
            ));
        }
        let expected_revision = task.revision;
        let reminder_claim_state_update = task.reminder_claim_state_update_for_patch(&patch);
        let task = task.apply_patch(patch)?;
        self.repository
            .update(&task, expected_revision, reminder_claim_state_update)?;

        Ok(Some(task))
    }

    pub fn complete(&self, id: Uuid) -> Result<Option<TaskCompletion>, AppError> {
        let Some(task) = self.repository.get(id)? else {
            return Ok(None);
        };
        if task.completed_at.is_some() {
            return Err(AppError::new(
                "task.already_completed",
                "errors.task.already_completed",
                AppErrorKind::Conflict,
            ));
        }
        let expected_revision = task.revision;
        let completion = complete_task(&task, Utc::now())?;
        self.repository
            .save_completion(&completion, expected_revision)?;

        Ok(Some(completion))
    }

    pub fn list_inbox(&self) -> Result<Vec<Task>, AppError> {
        self.repository.list_inbox()
    }

    pub fn list_tasks(&self, view: TaskView) -> Result<Vec<TaskSummaryDto>, AppError> {
        self.repository.list_tasks(&view)
    }

    pub fn list_due_reminder_candidates(
        &self,
        now: DateTime<Utc>,
        expired_before: DateTime<Utc>,
    ) -> Result<Vec<Task>, AppError> {
        self.repository
            .list_due_reminder_candidates(now, expired_before)
    }

    pub fn claim_reminder(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        claimed_at: DateTime<Utc>,
        expired_before: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.repository.claim_reminder(
            task_id,
            scheduled_at,
            claimed_at,
            expired_before,
            claim_token,
        )
    }

    pub fn mark_reminder_delivered(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        delivered_at: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.repository
            .mark_reminder_delivered(task_id, scheduled_at, delivered_at, claim_token)
    }

    pub fn release_reminder_claim(
        &self,
        task_id: Uuid,
        scheduled_at: DateTime<Utc>,
        claim_token: Uuid,
    ) -> Result<bool, AppError> {
        self.repository
            .release_reminder_claim(task_id, scheduled_at, claim_token)
    }
}

impl<R> TaskService<R>
where
    R: TaskRepository + TaskEditorRepository,
{
    pub fn create_editor(
        &self,
        draft: TaskDraft,
        tag_names: Vec<String>,
    ) -> Result<TaskEditor, AppError> {
        validate_draft_structure(&draft)?;
        let task = Task::from_draft(draft)?;
        self.repository.create_editor(&task, &tag_names)?;

        self.get_editor(task.id)?.ok_or_else(task_not_found)
    }

    #[cfg(test)]
    pub fn update_editor(
        &self,
        id: Uuid,
        expected_revision: i64,
        patch: TaskPatch,
        tag_names: Option<Vec<String>>,
    ) -> Result<Option<TaskEditor>, AppError> {
        self.update_editor_with_pre_update_validation(
            id,
            expected_revision,
            patch,
            tag_names,
            |_, _| Ok(()),
        )
    }

    pub fn update_editor_with_pre_update_validation<F>(
        &self,
        id: Uuid,
        expected_revision: i64,
        patch: TaskPatch,
        tag_names: Option<Vec<String>>,
        validate: F,
    ) -> Result<Option<TaskEditor>, AppError>
    where
        F: FnOnce(&Task, &TaskPatch) -> Result<(), AppError>,
    {
        validate_patch_completion(&patch)?;
        validate_patch_structure(&patch)?;
        let Some(editor) = self.repository.get_editor(id)? else {
            return Ok(None);
        };
        if editor.task.revision != expected_revision {
            return Err(concurrent_task_update_error());
        }
        validate(&editor.task, &patch)?;
        validate_subtask_project_patch(&editor.task, &patch)?;
        validate_recurring_restore(&editor.task, &patch)?;
        let reminder_claim_state_update = editor.task.reminder_claim_state_update_for_patch(&patch);
        let task = editor.task.apply_patch(patch)?;
        self.repository.update_editor(
            &task,
            expected_revision,
            reminder_claim_state_update,
            tag_names.as_deref(),
        )?;

        self.get_editor(id)
    }

    pub fn get_editor(&self, id: Uuid) -> Result<Option<TaskEditor>, AppError> {
        self.repository.get_editor(id)
    }
}

impl<R> TaskService<R>
where
    R: TaskRepository + SubtaskRepository,
{
    pub fn create_subtask(&self, parent_id: Uuid, title: String) -> Result<Task, AppError> {
        let Some(parent) = self.repository.get(parent_id)? else {
            return Err(AppError::new(
                "task.parent.not_found",
                "errors.task.parent.not_found",
                AppErrorKind::NotFound,
            ));
        };
        if parent.parent_id.is_some() {
            return Err(AppError::new(
                "task.subtask.nesting.unsupported",
                "errors.task.subtask.nesting.unsupported",
                AppErrorKind::Validation,
            ));
        }
        let mut draft = TaskDraft::new(title)?;
        draft.project_id = parent.project_id;
        draft.parent_id = Some(parent_id);
        let task = Task::from_draft(draft)?;
        match self.repository.insert_subtask(&parent, &task)? {
            SubtaskInsertOutcome::Inserted => Ok(task),
            SubtaskInsertOutcome::ParentMissing => Err(parent_not_found()),
            SubtaskInsertOutcome::ParentNested => Err(nested_subtask_error()),
            SubtaskInsertOutcome::ParentChanged => Err(AppError::new(
                "task.concurrent_update",
                "errors.task.concurrent_update",
                AppErrorKind::Conflict,
            )),
        }
    }
}

fn validate_draft_structure(draft: &TaskDraft) -> Result<(), AppError> {
    if draft.parent_id.is_some() {
        return Err(parent_write_unsupported_error());
    }

    Ok(())
}

fn validate_patch_structure(patch: &TaskPatch) -> Result<(), AppError> {
    if patch.parent_id.is_some() {
        return Err(parent_write_unsupported_error());
    }

    Ok(())
}

fn validate_subtask_project_patch(task: &Task, patch: &TaskPatch) -> Result<(), AppError> {
    if task.parent_id.is_some() && patch.project_id.is_some() {
        return Err(AppError::new(
            "task.subtask.project.inherited",
            "errors.task.subtask.project.inherited",
            AppErrorKind::Validation,
        ));
    }

    Ok(())
}

fn validate_patch_completion(patch: &TaskPatch) -> Result<(), AppError> {
    if patch
        .completed_at
        .as_ref()
        .is_some_and(|completed_at| completed_at.is_some())
    {
        return Err(AppError::new(
            "task.completion.use_complete",
            "errors.task.completion.use_complete",
            AppErrorKind::Validation,
        ));
    }

    Ok(())
}

fn validate_recurring_restore(task: &Task, patch: &TaskPatch) -> Result<(), AppError> {
    if task.completed_at.is_some()
        && task.recurrence.is_some()
        && patch
            .completed_at
            .as_ref()
            .is_some_and(|completed_at| completed_at.is_none())
    {
        return Err(AppError::new(
            "task.recurrence.restore.unsupported",
            "errors.task.recurrence.restore.unsupported",
            AppErrorKind::Conflict,
        ));
    }

    Ok(())
}

fn task_not_found() -> AppError {
    AppError::new(
        "task.not_found",
        "errors.task.not_found",
        AppErrorKind::NotFound,
    )
}

fn parent_not_found() -> AppError {
    AppError::new(
        "task.parent.not_found",
        "errors.task.parent.not_found",
        AppErrorKind::NotFound,
    )
}

fn nested_subtask_error() -> AppError {
    AppError::new(
        "task.subtask.nesting.unsupported",
        "errors.task.subtask.nesting.unsupported",
        AppErrorKind::Validation,
    )
}

fn parent_write_unsupported_error() -> AppError {
    AppError::new(
        "task.parent.write.unsupported",
        "errors.task.parent.write.unsupported",
        AppErrorKind::Validation,
    )
}

fn concurrent_task_update_error() -> AppError {
    AppError::new(
        "task.concurrent_update",
        "errors.task.concurrent_update",
        AppErrorKind::Conflict,
    )
}
