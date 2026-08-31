use chrono::{DateTime, Datelike, Local, NaiveDate, Utc};
use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

use crate::{
    domain::{
        ports::{ProjectRepository, TaskRepository},
        project_service::ProjectService,
        task::{Priority, RecurrenceRule, Task, TaskDraft, TaskPatch},
        task_query::{TaskSummaryDto, TaskView},
        task_service::TaskService,
    },
    error::AppError,
    AppState,
};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TaskDraftDto {
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) title: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) note: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) project_id: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) parent_id: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) priority: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) scheduled_at: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) due_at: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) recurrence: Option<Value>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TaskPatchDto {
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) title: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) note: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) project_id: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) parent_id: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) priority: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) scheduled_at: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) due_at: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) completed_at: Option<Value>,
    #[serde(deserialize_with = "deserialize_present_value")]
    pub(crate) recurrence: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum TaskViewDto {
    Inbox,
    Today,
    Upcoming,
    Completed,
    Project {
        #[serde(rename = "projectId")]
        project_id: String,
    },
    Search {
        query: String,
    },
    Calendar {
        month: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct CommandError {
    pub(crate) code: String,
    pub(crate) message_key: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskDto {
    id: String,
    title: String,
    note: String,
    project_id: Option<String>,
    parent_id: Option<String>,
    priority: Priority,
    scheduled_at: Option<DateTime<Utc>>,
    due_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    recurrence: Option<RecurrenceRule>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[tauri::command]
pub(crate) fn create_task(
    state: State<'_, AppState>,
    draft: Option<Value>,
) -> Result<TaskDto, CommandError> {
    create_task_with_services(state.tasks.as_ref(), state.projects.as_ref(), draft)
}

#[tauri::command]
pub(crate) fn update_task(
    state: State<'_, AppState>,
    id: Option<Value>,
    patch: Option<Value>,
) -> Result<TaskDto, CommandError> {
    update_task_with_services(state.tasks.as_ref(), state.projects.as_ref(), id, patch)
}

#[tauri::command]
pub(crate) fn list_inbox(state: State<'_, AppState>) -> Result<Vec<TaskDto>, CommandError> {
    list_inbox_with_service(state.tasks.as_ref())
}

#[tauri::command]
pub(crate) fn list_tasks(
    state: State<'_, AppState>,
    view: Option<Value>,
) -> Result<Vec<TaskSummaryDto>, CommandError> {
    list_tasks_with_service(state.tasks.as_ref(), view)
}

#[cfg(test)]
pub(crate) fn create_task_with_service<R>(
    service: &TaskService<R>,
    draft: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
{
    let draft = draft.ok_or_else(CommandError::invalid_task_input)?;
    let draft = TaskDraftDto::try_from(draft)?.try_into()?;

    service.create(draft).map(TaskDto::from).map_err(Into::into)
}

pub(crate) fn create_task_with_services<R, P>(
    service: &TaskService<R>,
    projects: &ProjectService<P>,
    draft: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
    P: ProjectRepository,
{
    let draft = draft.ok_or_else(CommandError::invalid_task_input)?;
    let draft: TaskDraft = TaskDraftDto::try_from(draft)?.try_into()?;
    if let Some(project_id) = draft.project_id {
        projects
            .require_active(project_id)
            .map_err(CommandError::from)?;
    }

    service.create(draft).map(TaskDto::from).map_err(Into::into)
}

#[cfg(test)]
pub(crate) fn update_task_with_service<R>(
    service: &TaskService<R>,
    id: Option<Value>,
    patch: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
{
    let id = id.ok_or_else(CommandError::invalid_task_input)?;
    let patch = patch.ok_or_else(CommandError::invalid_task_input)?;
    let id: String = parse_json_value(id)?;
    let id = Uuid::parse_str(&id).map_err(|_| CommandError::invalid_task_id())?;
    let patch = TaskPatchDto::try_from(patch)?.try_into()?;

    service
        .patch(id, patch)
        .map_err(CommandError::from)?
        .map(TaskDto::from)
        .ok_or_else(CommandError::task_not_found)
}

pub(crate) fn update_task_with_services<R, P>(
    service: &TaskService<R>,
    projects: &ProjectService<P>,
    id: Option<Value>,
    patch: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
    P: ProjectRepository,
{
    let id = id.ok_or_else(CommandError::invalid_task_input)?;
    let patch = patch.ok_or_else(CommandError::invalid_task_input)?;
    let id: String = parse_json_value(id)?;
    let id = Uuid::parse_str(&id).map_err(|_| CommandError::invalid_task_id())?;
    let patch: TaskPatch = TaskPatchDto::try_from(patch)?.try_into()?;
    if let Some(Some(project_id)) = patch.project_id {
        projects
            .require_active(project_id)
            .map_err(CommandError::from)?;
    }

    service
        .patch(id, patch)
        .map_err(CommandError::from)?
        .map(TaskDto::from)
        .ok_or_else(CommandError::task_not_found)
}

pub(crate) fn list_inbox_with_service<R>(
    service: &TaskService<R>,
) -> Result<Vec<TaskDto>, CommandError>
where
    R: TaskRepository,
{
    service
        .list_inbox()
        .map(|tasks| tasks.into_iter().map(TaskDto::from).collect())
        .map_err(Into::into)
}

pub(crate) fn list_tasks_with_service<R>(
    service: &TaskService<R>,
    view: Option<Value>,
) -> Result<Vec<TaskSummaryDto>, CommandError>
where
    R: TaskRepository,
{
    let view = view.ok_or_else(CommandError::invalid_task_input)?;
    let view = TaskViewDto::try_from(view)?.try_into()?;

    service.list_tasks(view).map_err(Into::into)
}

impl TryFrom<Value> for TaskDraftDto {
    type Error = CommandError;

    fn try_from(value: Value) -> Result<Self, Self::Error> {
        parse_wire_object(value)
    }
}

impl TryFrom<Value> for TaskPatchDto {
    type Error = CommandError;

    fn try_from(value: Value) -> Result<Self, Self::Error> {
        parse_wire_object(value)
    }
}

impl TryFrom<Value> for TaskViewDto {
    type Error = CommandError;

    fn try_from(value: Value) -> Result<Self, Self::Error> {
        validate_task_view_fields(&value)?;
        parse_wire_object(value)
    }
}

impl TryFrom<TaskViewDto> for TaskView {
    type Error = CommandError;

    fn try_from(dto: TaskViewDto) -> Result<Self, Self::Error> {
        match dto {
            TaskViewDto::Inbox => Ok(Self::Inbox),
            TaskViewDto::Today => Ok(Self::Today {
                day: Local::now().date_naive(),
            }),
            TaskViewDto::Upcoming => Ok(Self::Upcoming {
                day: Local::now().date_naive(),
            }),
            TaskViewDto::Completed => Ok(Self::Completed),
            TaskViewDto::Project { project_id } => Uuid::parse_str(&project_id)
                .map(Self::Project)
                .map_err(|_| CommandError::invalid_task_input()),
            TaskViewDto::Search { query } => {
                let query = query.trim().to_owned();
                if query.is_empty() {
                    return Err(CommandError::invalid_task_input());
                }

                Ok(Self::Search(query))
            }
            TaskViewDto::Calendar { month } => {
                let start = parse_calendar_month(&month)?;
                let end = if start.month() == 12 {
                    NaiveDate::from_ymd_opt(start.year() + 1, 1, 1)
                } else {
                    NaiveDate::from_ymd_opt(start.year(), start.month() + 1, 1)
                }
                .ok_or_else(CommandError::invalid_task_input)?;

                Ok(Self::Calendar { start, end })
            }
        }
    }
}

impl TryFrom<TaskDraftDto> for TaskDraft {
    type Error = CommandError;

    fn try_from(dto: TaskDraftDto) -> Result<Self, Self::Error> {
        Ok(Self {
            title: parse_draft_field(dto.title)?,
            note: parse_draft_field(dto.note)?,
            project_id: parse_draft_field(dto.project_id)?,
            parent_id: parse_draft_field(dto.parent_id)?,
            priority: parse_draft_field(dto.priority)?,
            scheduled_at: parse_draft_field(dto.scheduled_at)?,
            due_at: parse_draft_field(dto.due_at)?,
            recurrence: parse_draft_field(dto.recurrence)?,
        })
    }
}

impl TryFrom<TaskPatchDto> for TaskPatch {
    type Error = CommandError;

    fn try_from(dto: TaskPatchDto) -> Result<Self, Self::Error> {
        Ok(Self {
            title: parse_patch_field(dto.title)?,
            note: parse_patch_field(dto.note)?,
            project_id: parse_nullable_patch_field(dto.project_id)?,
            parent_id: parse_nullable_patch_field(dto.parent_id)?,
            priority: parse_patch_field(dto.priority)?,
            scheduled_at: parse_nullable_patch_field(dto.scheduled_at)?,
            due_at: parse_nullable_patch_field(dto.due_at)?,
            completed_at: parse_nullable_patch_field(dto.completed_at)?,
            recurrence: parse_nullable_patch_field(dto.recurrence)?,
        })
    }
}

impl From<Task> for TaskDto {
    fn from(task: Task) -> Self {
        Self {
            id: task.id.to_string(),
            title: task.title,
            note: task.note,
            project_id: task.project_id.map(|value| value.to_string()),
            parent_id: task.parent_id.map(|value| value.to_string()),
            priority: task.priority,
            scheduled_at: task.scheduled_at,
            due_at: task.due_at,
            completed_at: task.completed_at,
            recurrence: task.recurrence,
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        Self {
            code: error.code().into(),
            message_key: error.translation_key().into(),
        }
    }
}

impl CommandError {
    fn invalid_task_input() -> Self {
        Self {
            code: "task.input.invalid".into(),
            message_key: "errors.task.input.invalid".into(),
        }
    }

    fn invalid_task_id() -> Self {
        Self {
            code: "task.id.invalid".into(),
            message_key: "errors.task.id.invalid".into(),
        }
    }

    fn task_not_found() -> Self {
        Self {
            code: "task.not_found".into(),
            message_key: "errors.task.not_found".into(),
        }
    }
}

fn parse_json_value<T>(value: Value) -> Result<T, CommandError>
where
    T: DeserializeOwned,
{
    serde_json::from_value(value).map_err(|_| CommandError::invalid_task_input())
}

fn parse_wire_object<T>(value: Value) -> Result<T, CommandError>
where
    T: DeserializeOwned,
{
    if !value.is_object() {
        return Err(CommandError::invalid_task_input());
    }

    parse_json_value(value)
}

fn validate_task_view_fields(value: &Value) -> Result<(), CommandError> {
    let object = value
        .as_object()
        .ok_or_else(CommandError::invalid_task_input)?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(CommandError::invalid_task_input)?;
    let allowed_fields: &[&str] = match kind {
        "inbox" | "today" | "upcoming" | "completed" => &["kind"],
        "project" => &["kind", "projectId"],
        "search" => &["kind", "query"],
        "calendar" => &["kind", "month"],
        _ => return Err(CommandError::invalid_task_input()),
    };

    if object.len() != allowed_fields.len()
        || allowed_fields
            .iter()
            .any(|field| !object.contains_key(*field))
    {
        return Err(CommandError::invalid_task_input());
    }

    Ok(())
}

fn parse_calendar_month(month: &str) -> Result<NaiveDate, CommandError> {
    let bytes = month.as_bytes();
    if bytes.len() != 7
        || bytes[4] != b'-'
        || !bytes[..4].iter().all(u8::is_ascii_digit)
        || !bytes[5..].iter().all(u8::is_ascii_digit)
    {
        return Err(CommandError::invalid_task_input());
    }

    let year = month[..4]
        .parse::<i32>()
        .map_err(|_| CommandError::invalid_task_input())?;
    let calendar_month = month[5..]
        .parse::<u32>()
        .map_err(|_| CommandError::invalid_task_input())?;

    NaiveDate::from_ymd_opt(year, calendar_month, 1).ok_or_else(CommandError::invalid_task_input)
}

fn parse_draft_field<T>(value: Option<Value>) -> Result<T, CommandError>
where
    T: Default + DeserializeOwned,
{
    value
        .map(parse_json_value)
        .unwrap_or_else(|| Ok(T::default()))
}

fn parse_patch_field<T>(value: Option<Value>) -> Result<Option<T>, CommandError>
where
    T: DeserializeOwned,
{
    value.map(parse_json_value).transpose()
}

fn parse_nullable_patch_field<T>(value: Option<Value>) -> Result<Option<Option<T>>, CommandError>
where
    T: DeserializeOwned,
{
    value.map(parse_json_value::<Option<T>>).transpose()
}

fn deserialize_present_value<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
where
    D: Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}
