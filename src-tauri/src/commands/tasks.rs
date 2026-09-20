use std::collections::BTreeSet;

use chrono::{DateTime, Datelike, Local, NaiveDate, Utc};
use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

use crate::{
    domain::{
        ports::{
            ProjectRepository, SubtaskRepository, TaskEditor, TaskEditorRepository, TaskRepository,
        },
        project_service::ProjectService,
        task::{Priority, RecurrenceRule, Task, TaskDraft, TaskPatch},
        task_query::{TaskSummaryDto, TaskView},
        task_service::TaskService,
    },
    error::AppError,
    reminder_worker::ReminderRescanRequester,
    task_mutation_notification::{TaskMutationEvent, TaskMutationNotifier},
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
#[serde(transparent)]
pub(crate) struct TaskIdDto(pub(crate) String);

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum TaskViewDto {
    Inbox,
    Today,
    QuickPanelToday,
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
    revision: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskEditorDto {
    task: TaskDto,
    tag_names: Vec<String>,
    subtasks: Vec<TaskDto>,
}

#[tauri::command]
pub(crate) fn create_task(
    state: State<'_, AppState>,
    draft: Option<Value>,
) -> Result<TaskDto, CommandError> {
    create_task_with_services_and_rescan_and_notify(
        state.tasks.as_ref(),
        state.projects.as_ref(),
        &state.reminder_worker,
        &state.task_mutation_notifier,
        draft,
    )
}

#[tauri::command]
pub(crate) fn update_task(
    state: State<'_, AppState>,
    id: Option<Value>,
    patch: Option<Value>,
) -> Result<TaskDto, CommandError> {
    update_task_with_services_and_rescan_and_notify(
        state.tasks.as_ref(),
        state.projects.as_ref(),
        &state.reminder_worker,
        &state.task_mutation_notifier,
        id,
        patch,
    )
}

#[tauri::command]
pub(crate) fn complete_task(
    state: State<'_, AppState>,
    id: Option<Value>,
) -> Result<TaskDto, CommandError> {
    complete_task_with_service_and_rescan_and_notify(
        state.tasks.as_ref(),
        &state.reminder_worker,
        &state.task_mutation_notifier,
        id,
    )
}

#[tauri::command]
pub(crate) fn get_task_editor(
    state: State<'_, AppState>,
    id: Option<Value>,
) -> Result<TaskEditorDto, CommandError> {
    get_task_editor_with_service(state.tasks.as_ref(), id)
}

#[tauri::command]
pub(crate) fn create_task_editor(
    state: State<'_, AppState>,
    draft: Option<Value>,
    tag_names: Option<Value>,
) -> Result<TaskEditorDto, CommandError> {
    create_task_editor_with_services_and_rescan_and_notify(
        state.tasks.as_ref(),
        state.projects.as_ref(),
        &state.reminder_worker,
        &state.task_mutation_notifier,
        draft,
        tag_names,
    )
}

#[tauri::command]
pub(crate) fn update_task_editor(
    state: State<'_, AppState>,
    id: Option<Value>,
    expected_revision: Option<Value>,
    patch: Option<Value>,
    tag_names: Option<Value>,
) -> Result<TaskEditorDto, CommandError> {
    update_task_editor_with_services_and_rescan_and_notify(
        state.tasks.as_ref(),
        state.projects.as_ref(),
        &state.reminder_worker,
        &state.task_mutation_notifier,
        id,
        expected_revision,
        patch,
        tag_names,
    )
}

#[tauri::command]
pub(crate) fn create_subtask(
    state: State<'_, AppState>,
    parent_id: Option<Value>,
    title: Option<Value>,
) -> Result<TaskDto, CommandError> {
    create_subtask_with_service_and_rescan_and_notify(
        state.tasks.as_ref(),
        &state.reminder_worker,
        &state.task_mutation_notifier,
        parent_id,
        title,
    )
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
    let draft = parse_task_draft_with_project(projects, draft)?;

    service.create(draft).map(TaskDto::from).map_err(Into::into)
}

pub(crate) fn create_task_with_services_and_rescan<R, P, Q>(
    service: &TaskService<R>,
    projects: &ProjectService<P>,
    rescan_requester: &Q,
    draft: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
    P: ProjectRepository,
    Q: ReminderRescanRequester,
{
    let task = create_task_with_services(service, projects, draft)?;
    request_reminder_rescan(rescan_requester);

    Ok(task)
}

pub(crate) fn create_task_with_services_and_rescan_and_notify<R, P, Q, N>(
    service: &TaskService<R>,
    projects: &ProjectService<P>,
    rescan_requester: &Q,
    notifier: &N,
    draft: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
    P: ProjectRepository,
    Q: ReminderRescanRequester,
    N: TaskMutationNotifier,
{
    let task = create_task_with_services_and_rescan(service, projects, rescan_requester, draft)?;
    notify_task_mutation(notifier, &task);

    Ok(task)
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

    service
        .patch_with_pre_update_validation(id, patch, |current_task, patch| {
            validate_project_patch_against_current_task(projects, current_task, patch)
        })
        .map_err(CommandError::from)?
        .map(TaskDto::from)
        .ok_or_else(CommandError::task_not_found)
}

pub(crate) fn update_task_with_services_and_rescan<R, P, Q>(
    service: &TaskService<R>,
    projects: &ProjectService<P>,
    rescan_requester: &Q,
    id: Option<Value>,
    patch: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
    P: ProjectRepository,
    Q: ReminderRescanRequester,
{
    let task = update_task_with_services(service, projects, id, patch)?;
    request_reminder_rescan(rescan_requester);

    Ok(task)
}

pub(crate) fn update_task_with_services_and_rescan_and_notify<R, P, Q, N>(
    service: &TaskService<R>,
    projects: &ProjectService<P>,
    rescan_requester: &Q,
    notifier: &N,
    id: Option<Value>,
    patch: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
    P: ProjectRepository,
    Q: ReminderRescanRequester,
    N: TaskMutationNotifier,
{
    let task =
        update_task_with_services_and_rescan(service, projects, rescan_requester, id, patch)?;
    notify_task_mutation(notifier, &task);

    Ok(task)
}

pub(crate) fn complete_task_with_service<R>(
    service: &TaskService<R>,
    id: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
{
    let id = id.ok_or_else(CommandError::invalid_task_input)?;
    let id = TaskIdDto::try_from(id)?.try_into()?;

    service
        .complete(id)
        .map_err(CommandError::from)?
        .map(|completion| TaskDto::from(completion.completed_task))
        .ok_or_else(CommandError::task_not_found)
}

pub(crate) fn complete_task_with_service_and_rescan<R, Q>(
    service: &TaskService<R>,
    rescan_requester: &Q,
    id: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
    Q: ReminderRescanRequester,
{
    let task = complete_task_with_service(service, id)?;
    request_reminder_rescan(rescan_requester);

    Ok(task)
}

pub(crate) fn complete_task_with_service_and_rescan_and_notify<R, Q, N>(
    service: &TaskService<R>,
    rescan_requester: &Q,
    notifier: &N,
    id: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository,
    Q: ReminderRescanRequester,
    N: TaskMutationNotifier,
{
    let task = complete_task_with_service_and_rescan(service, rescan_requester, id)?;
    notify_task_mutation(notifier, &task);

    Ok(task)
}

pub(crate) fn get_task_editor_with_service<R>(
    service: &TaskService<R>,
    id: Option<Value>,
) -> Result<TaskEditorDto, CommandError>
where
    R: TaskRepository + TaskEditorRepository,
{
    let id = parse_task_id(id)?;

    service
        .get_editor(id)
        .map_err(CommandError::from)?
        .map(TaskEditorDto::from)
        .ok_or_else(CommandError::task_not_found)
}

pub(crate) fn create_task_editor_with_services_and_rescan<R, P, Q>(
    service: &TaskService<R>,
    projects: &ProjectService<P>,
    rescan_requester: &Q,
    draft: Option<Value>,
    tag_names: Option<Value>,
) -> Result<TaskEditorDto, CommandError>
where
    R: TaskRepository + TaskEditorRepository,
    P: ProjectRepository,
    Q: ReminderRescanRequester,
{
    let draft = parse_task_draft_with_project(projects, draft)?;
    let tag_names = parse_tag_names(tag_names)?.unwrap_or_default();
    let editor = service
        .create_editor(draft, tag_names)
        .map(TaskEditorDto::from)
        .map_err(CommandError::from)?;
    request_reminder_rescan(rescan_requester);

    Ok(editor)
}

pub(crate) fn create_task_editor_with_services_and_rescan_and_notify<R, P, Q, N>(
    service: &TaskService<R>,
    projects: &ProjectService<P>,
    rescan_requester: &Q,
    notifier: &N,
    draft: Option<Value>,
    tag_names: Option<Value>,
) -> Result<TaskEditorDto, CommandError>
where
    R: TaskRepository + TaskEditorRepository,
    P: ProjectRepository,
    Q: ReminderRescanRequester,
    N: TaskMutationNotifier,
{
    let editor = create_task_editor_with_services_and_rescan(
        service,
        projects,
        rescan_requester,
        draft,
        tag_names,
    )?;
    notify_task_mutation(notifier, &editor.task);

    Ok(editor)
}

pub(crate) fn update_task_editor_with_services_and_rescan<R, P, Q>(
    service: &TaskService<R>,
    projects: &ProjectService<P>,
    rescan_requester: &Q,
    id: Option<Value>,
    expected_revision: Option<Value>,
    patch: Option<Value>,
    tag_names: Option<Value>,
) -> Result<TaskEditorDto, CommandError>
where
    R: TaskRepository + TaskEditorRepository,
    P: ProjectRepository,
    Q: ReminderRescanRequester,
{
    let id = parse_task_id(id)?;
    let expected_revision = expected_revision.ok_or_else(CommandError::invalid_task_input)?;
    let expected_revision: i64 = parse_json_value(expected_revision)?;
    let patch = parse_task_patch(patch)?;
    let tag_names = parse_tag_names(tag_names)?;
    let editor = service
        .update_editor_with_pre_update_validation(
            id,
            expected_revision,
            patch,
            tag_names,
            |current_task, patch| {
                validate_project_patch_against_current_task(projects, current_task, patch)
            },
        )
        .map_err(CommandError::from)?
        .map(TaskEditorDto::from)
        .ok_or_else(CommandError::task_not_found)?;
    request_reminder_rescan(rescan_requester);

    Ok(editor)
}

#[expect(
    clippy::too_many_arguments,
    reason = "Tauri editor update inputs and best-effort post-mutation dependencies remain explicit for command tests"
)]
pub(crate) fn update_task_editor_with_services_and_rescan_and_notify<R, P, Q, N>(
    service: &TaskService<R>,
    projects: &ProjectService<P>,
    rescan_requester: &Q,
    notifier: &N,
    id: Option<Value>,
    expected_revision: Option<Value>,
    patch: Option<Value>,
    tag_names: Option<Value>,
) -> Result<TaskEditorDto, CommandError>
where
    R: TaskRepository + TaskEditorRepository,
    P: ProjectRepository,
    Q: ReminderRescanRequester,
    N: TaskMutationNotifier,
{
    let editor = update_task_editor_with_services_and_rescan(
        service,
        projects,
        rescan_requester,
        id,
        expected_revision,
        patch,
        tag_names,
    )?;
    notify_task_mutation(notifier, &editor.task);

    Ok(editor)
}

pub(crate) fn create_subtask_with_service_and_rescan<R, Q>(
    service: &TaskService<R>,
    rescan_requester: &Q,
    parent_id: Option<Value>,
    title: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository + SubtaskRepository,
    Q: ReminderRescanRequester,
{
    let parent_id = parse_task_id(parent_id)?;
    let title = title.ok_or_else(CommandError::invalid_task_input)?;
    let title: String = parse_json_value(title)?;
    let task = service
        .create_subtask(parent_id, title)
        .map_err(CommandError::from)?;
    request_reminder_rescan(rescan_requester);

    Ok(TaskDto::from(task))
}

pub(crate) fn create_subtask_with_service_and_rescan_and_notify<R, Q, N>(
    service: &TaskService<R>,
    rescan_requester: &Q,
    notifier: &N,
    parent_id: Option<Value>,
    title: Option<Value>,
) -> Result<TaskDto, CommandError>
where
    R: TaskRepository + SubtaskRepository,
    Q: ReminderRescanRequester,
    N: TaskMutationNotifier,
{
    let task = create_subtask_with_service_and_rescan(service, rescan_requester, parent_id, title)?;
    notify_task_mutation(notifier, &task);

    Ok(task)
}

fn request_reminder_rescan<Q>(rescan_requester: &Q)
where
    Q: ReminderRescanRequester,
{
    if let Err(error) = rescan_requester.request_rescan() {
        eprintln!("reminder background rescan request failed: {error}");
    }
}

fn notify_task_mutation<N>(notifier: &N, task: &TaskDto)
where
    N: TaskMutationNotifier,
{
    let event = TaskMutationEvent::new(&task.id, task.revision);
    if let Err(error) = notifier.notify(event) {
        eprintln!("task mutation notification failed: {error}");
    }
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

impl TryFrom<Value> for TaskIdDto {
    type Error = CommandError;

    fn try_from(value: Value) -> Result<Self, Self::Error> {
        parse_json_value(value)
    }
}

impl TryFrom<TaskIdDto> for Uuid {
    type Error = CommandError;

    fn try_from(dto: TaskIdDto) -> Result<Self, Self::Error> {
        Uuid::parse_str(&dto.0).map_err(|_| CommandError::invalid_task_id())
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
            TaskViewDto::QuickPanelToday => Ok(Self::QuickPanelToday {
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
            revision: task.revision,
        }
    }
}

impl From<TaskEditor> for TaskEditorDto {
    fn from(editor: TaskEditor) -> Self {
        Self {
            task: TaskDto::from(editor.task),
            tag_names: editor.tag_names,
            subtasks: editor.subtasks.into_iter().map(TaskDto::from).collect(),
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

    fn invalid_tag_name() -> Self {
        Self {
            code: "task.tag.invalid".into(),
            message_key: "errors.task.tag.invalid".into(),
        }
    }

    fn parent_write_unsupported() -> Self {
        Self {
            code: "task.parent.write.unsupported".into(),
            message_key: "errors.task.parent.write.unsupported".into(),
        }
    }
}

fn parse_task_id(value: Option<Value>) -> Result<Uuid, CommandError> {
    let value = value.ok_or_else(CommandError::invalid_task_input)?;
    let value = TaskIdDto::try_from(value)?;

    Uuid::try_from(value)
}

fn parse_task_draft_with_project<P>(
    projects: &ProjectService<P>,
    draft: Option<Value>,
) -> Result<TaskDraft, CommandError>
where
    P: ProjectRepository,
{
    let draft = draft.ok_or_else(CommandError::invalid_task_input)?;
    let draft: TaskDraft = TaskDraftDto::try_from(draft)?.try_into()?;
    if draft.parent_id.is_some() {
        return Err(CommandError::parent_write_unsupported());
    }
    if let Some(project_id) = draft.project_id {
        projects
            .require_active(project_id)
            .map_err(CommandError::from)?;
    }

    Ok(draft)
}

fn parse_task_patch(patch: Option<Value>) -> Result<TaskPatch, CommandError> {
    let patch = patch.ok_or_else(CommandError::invalid_task_input)?;
    if patch
        .get("recurrence")
        .is_some_and(|recurrence| !recurrence.is_null() && !recurrence.is_object())
    {
        return Err(CommandError::invalid_task_input());
    }
    let patch: TaskPatch = TaskPatchDto::try_from(patch)?.try_into()?;
    if patch.parent_id.is_some() {
        return Err(CommandError::parent_write_unsupported());
    }

    Ok(patch)
}

fn validate_project_patch_against_current_task<P>(
    projects: &ProjectService<P>,
    current_task: &Task,
    patch: &TaskPatch,
) -> Result<(), AppError>
where
    P: ProjectRepository,
{
    if let Some(Some(project_id)) = patch.project_id {
        if current_task.project_id == Some(project_id) {
            return Ok(());
        }

        projects.require_active(project_id).map(|_| ())?;
    }

    Ok(())
}

fn parse_tag_names(value: Option<Value>) -> Result<Option<Vec<String>>, CommandError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let tag_names: Vec<String> =
        parse_json_value(value).map_err(|_| CommandError::invalid_tag_name())?;
    let mut normalized = BTreeSet::new();
    for tag_name in tag_names {
        let tag_name = tag_name.trim().to_owned();
        if tag_name.is_empty() || tag_name.chars().count() > 80 {
            return Err(CommandError::invalid_tag_name());
        }
        normalized.insert(tag_name);
    }

    Ok(Some(normalized.into_iter().collect()))
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
        "inbox" | "today" | "quickPanelToday" | "upcoming" | "completed" => &["kind"],
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
