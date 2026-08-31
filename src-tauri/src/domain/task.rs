use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppErrorKind};

pub use crate::domain::recurrence::RecurrenceRule;

const MAX_TITLE_LENGTH: usize = 500;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub enum Priority {
    Low,
    #[default]
    Normal,
    High,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Task {
    pub id: Uuid,
    pub title: String,
    pub note: String,
    pub project_id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
    pub priority: Priority,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub due_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub reminder_sent_at: Option<DateTime<Utc>>,
    pub recurrence: Option<RecurrenceRule>,
    pub instance_number: u32,
    pub monthly_anchor_day: Option<u8>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskDraft {
    pub title: String,
    pub note: String,
    pub project_id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
    pub priority: Priority,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub due_at: Option<DateTime<Utc>>,
    pub recurrence: Option<RecurrenceRule>,
}

impl TaskDraft {
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "M2 快速新增任务工作流接入前保留默认草稿工厂")
    )]
    pub fn new(title: String) -> Result<Self, AppError> {
        let title = validate_title(title)?;

        Ok(Self {
            title,
            note: String::new(),
            project_id: None,
            parent_id: None,
            priority: Priority::default(),
            scheduled_at: None,
            due_at: None,
            recurrence: None,
        })
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskPatch {
    pub title: Option<String>,
    pub note: Option<String>,
    pub project_id: Option<Option<Uuid>>,
    pub parent_id: Option<Option<Uuid>>,
    pub priority: Option<Priority>,
    pub scheduled_at: Option<Option<DateTime<Utc>>>,
    pub due_at: Option<Option<DateTime<Utc>>>,
    pub completed_at: Option<Option<DateTime<Utc>>>,
    pub recurrence: Option<Option<RecurrenceRule>>,
}

impl Task {
    pub fn from_draft(draft: TaskDraft) -> Result<Self, AppError> {
        let now = Utc::now();
        let title = validate_title(draft.title)?;
        let recurrence = draft.recurrence;
        if let Some(rule) = recurrence.as_ref() {
            rule.validate_new_task()?;
        }
        validate_recurrence(recurrence.as_ref(), draft.scheduled_at, draft.parent_id)?;
        let monthly_anchor_day = recurrence
            .as_ref()
            .filter(|rule| rule.uses_date_anchor())
            .and_then(|_| {
                draft
                    .scheduled_at
                    .map(|scheduled_at| scheduled_at.day() as u8)
            });

        Ok(Self {
            id: Uuid::new_v4(),
            title,
            note: draft.note,
            project_id: draft.project_id,
            parent_id: draft.parent_id,
            priority: draft.priority,
            scheduled_at: draft.scheduled_at,
            due_at: draft.due_at,
            completed_at: None,
            reminder_sent_at: None,
            recurrence,
            instance_number: 1,
            monthly_anchor_day,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn apply_patch(&self, patch: TaskPatch) -> Result<Self, AppError> {
        let mut task = self.clone();

        if let Some(title) = patch.title {
            task.title = validate_title(title)?;
        }
        if let Some(note) = patch.note {
            task.note = note;
        }
        if let Some(project_id) = patch.project_id {
            task.project_id = project_id;
        }
        if let Some(parent_id) = patch.parent_id {
            task.parent_id = parent_id;
        }
        if let Some(priority) = patch.priority {
            task.priority = priority;
        }
        if let Some(scheduled_at) = patch.scheduled_at {
            task.scheduled_at = scheduled_at;
        }
        if let Some(due_at) = patch.due_at {
            task.due_at = due_at;
        }
        if let Some(completed_at) = patch.completed_at {
            task.completed_at = completed_at;
        }
        if let Some(recurrence) = patch.recurrence {
            if let Some(rule) = recurrence.as_ref() {
                rule.validate_new_task()?;
            }
            task.recurrence = recurrence;
        }

        validate_recurrence(task.recurrence.as_ref(), task.scheduled_at, task.parent_id)?;
        if task
            .recurrence
            .as_ref()
            .is_some_and(|rule| !rule.uses_date_anchor())
        {
            task.monthly_anchor_day = None;
        } else if task.recurrence.is_some() && task.monthly_anchor_day.is_none() {
            task.monthly_anchor_day = task
                .scheduled_at
                .map(|scheduled_at| scheduled_at.day() as u8);
        }

        task.updated_at = Utc::now();

        Ok(task)
    }

    #[cfg(test)]
    pub fn for_test(title: String) -> Self {
        let draft = TaskDraft::new(title).unwrap_or_else(|error| {
            panic!("test task title must be valid: {}", error.code());
        });

        Self::from_draft(draft).unwrap_or_else(|error| {
            panic!("test task title must be valid: {}", error.code());
        })
    }
}

fn validate_recurrence(
    recurrence: Option<&RecurrenceRule>,
    scheduled_at: Option<DateTime<Utc>>,
    parent_id: Option<Uuid>,
) -> Result<(), AppError> {
    if recurrence.is_none() {
        return Ok(());
    }
    if scheduled_at.is_none() {
        return Err(AppError::new(
            "recurrence.scheduled_at.required",
            "errors.recurrence.scheduled_at.required",
            AppErrorKind::Validation,
        ));
    }
    if parent_id.is_some() {
        return Err(AppError::new(
            "recurrence.child.unsupported",
            "errors.recurrence.child.unsupported",
            AppErrorKind::Validation,
        ));
    }

    Ok(())
}

fn validate_title(title: String) -> Result<String, AppError> {
    let title = title.trim().to_owned();

    if title.is_empty() {
        return Err(AppError::new(
            "task.title.blank",
            "errors.task.title.blank",
            AppErrorKind::Validation,
        ));
    }
    if title.chars().count() > MAX_TITLE_LENGTH {
        return Err(AppError::new(
            "task.title.too_long",
            "errors.task.title.too_long",
            AppErrorKind::Validation,
        ));
    }

    Ok(title)
}
