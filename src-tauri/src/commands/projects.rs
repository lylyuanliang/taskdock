use chrono::{DateTime, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
#[cfg(test)]
use serde_json::Value;
use tauri::{
    ipc::{InvokeBody, Request},
    State,
};
use uuid::Uuid;

use crate::{
    domain::{ports::ProjectRepository, project::Project, project_service::ProjectService},
    error::AppError,
    AppState,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CreateProjectInput {
    name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RenameProjectInput {
    id: String,
    name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ArchiveProjectInput {
    id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ListProjectsInput {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct CommandError {
    pub(crate) code: String,
    pub(crate) message_key: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectDto {
    id: String,
    name: String,
    archived_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[tauri::command]
pub(crate) fn list_projects(
    request: Request<'_>,
    state: State<'_, AppState>,
) -> Result<Vec<ProjectDto>, CommandError> {
    list_projects_with_body(state.projects.as_ref(), request.body())
}

#[tauri::command]
pub(crate) fn create_project(
    request: Request<'_>,
    state: State<'_, AppState>,
) -> Result<ProjectDto, CommandError> {
    create_project_with_body(state.projects.as_ref(), request.body())
}

#[tauri::command]
pub(crate) fn rename_project(
    request: Request<'_>,
    state: State<'_, AppState>,
) -> Result<ProjectDto, CommandError> {
    rename_project_with_body(state.projects.as_ref(), request.body())
}

#[tauri::command]
pub(crate) fn archive_project(
    request: Request<'_>,
    state: State<'_, AppState>,
) -> Result<ProjectDto, CommandError> {
    archive_project_with_body(state.projects.as_ref(), request.body())
}

pub(crate) fn list_projects_with_body<R>(
    service: &ProjectService<R>,
    body: &InvokeBody,
) -> Result<Vec<ProjectDto>, CommandError>
where
    R: ProjectRepository,
{
    let _: ListProjectsInput = parse_request_body(body)?;

    service
        .list_active()
        .map(|projects| projects.into_iter().map(ProjectDto::from).collect())
        .map_err(Into::into)
}

pub(crate) fn create_project_with_body<R>(
    service: &ProjectService<R>,
    body: &InvokeBody,
) -> Result<ProjectDto, CommandError>
where
    R: ProjectRepository,
{
    let input: CreateProjectInput = parse_request_body(body)?;

    create_project_from_input(service, input)
}

pub(crate) fn rename_project_with_body<R>(
    service: &ProjectService<R>,
    body: &InvokeBody,
) -> Result<ProjectDto, CommandError>
where
    R: ProjectRepository,
{
    let input: RenameProjectInput = parse_request_body(body)?;

    rename_project_from_input(service, input)
}

pub(crate) fn archive_project_with_body<R>(
    service: &ProjectService<R>,
    body: &InvokeBody,
) -> Result<ProjectDto, CommandError>
where
    R: ProjectRepository,
{
    let input: ArchiveProjectInput = parse_request_body(body)?;

    archive_project_from_input(service, input)
}

#[cfg(test)]
pub(crate) fn create_project_with_service<R>(
    service: &ProjectService<R>,
    input: Option<Value>,
) -> Result<ProjectDto, CommandError>
where
    R: ProjectRepository,
{
    let input = parse_input(input)?;
    let input: CreateProjectInput =
        serde_json::from_value(input).map_err(|_| CommandError::invalid_project_input())?;

    create_project_from_input(service, input)
}

#[cfg(test)]
pub(crate) fn rename_project_with_service<R>(
    service: &ProjectService<R>,
    input: Option<Value>,
) -> Result<ProjectDto, CommandError>
where
    R: ProjectRepository,
{
    let input = parse_input(input)?;
    let input: RenameProjectInput =
        serde_json::from_value(input).map_err(|_| CommandError::invalid_project_input())?;
    rename_project_from_input(service, input)
}

fn create_project_from_input<R>(
    service: &ProjectService<R>,
    input: CreateProjectInput,
) -> Result<ProjectDto, CommandError>
where
    R: ProjectRepository,
{
    service
        .create(input.name)
        .map(ProjectDto::from)
        .map_err(Into::into)
}

fn rename_project_from_input<R>(
    service: &ProjectService<R>,
    input: RenameProjectInput,
) -> Result<ProjectDto, CommandError>
where
    R: ProjectRepository,
{
    let id = parse_project_id(&input.id)?;

    service
        .rename(id, input.name)
        .map(ProjectDto::from)
        .map_err(Into::into)
}

fn archive_project_from_input<R>(
    service: &ProjectService<R>,
    input: ArchiveProjectInput,
) -> Result<ProjectDto, CommandError>
where
    R: ProjectRepository,
{
    let id = parse_project_id(&input.id)?;

    service
        .archive(id)
        .map(ProjectDto::from)
        .map_err(Into::into)
}

impl From<Project> for ProjectDto {
    fn from(project: Project) -> Self {
        Self {
            id: project.id.to_string(),
            name: project.name,
            archived_at: project.archived_at,
            created_at: project.created_at,
            updated_at: project.updated_at,
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
    pub(crate) fn invalid_project_input() -> Self {
        Self {
            code: "project.input.invalid".into(),
            message_key: "errors.project.input.invalid".into(),
        }
    }
}

#[cfg(test)]
fn parse_input(input: Option<Value>) -> Result<Value, CommandError> {
    let input = input.ok_or_else(CommandError::invalid_project_input)?;
    if input.is_object() {
        Ok(input)
    } else {
        Err(CommandError::invalid_project_input())
    }
}

fn parse_request_body<T>(body: &InvokeBody) -> Result<T, CommandError>
where
    T: DeserializeOwned,
{
    let InvokeBody::Json(value) = body else {
        return Err(CommandError::invalid_project_input());
    };

    if !value.is_object() {
        return Err(CommandError::invalid_project_input());
    }

    serde_json::from_value(value.clone()).map_err(|_| CommandError::invalid_project_input())
}

fn parse_project_id(value: &str) -> Result<Uuid, CommandError> {
    Uuid::parse_str(value).map_err(|_| CommandError::invalid_project_input())
}
