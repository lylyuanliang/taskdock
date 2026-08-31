use uuid::Uuid;

use crate::{
    domain::{ports::ProjectRepository, project::Project},
    error::{AppError, AppErrorKind},
};

pub struct ProjectService<R>
where
    R: ProjectRepository,
{
    repository: R,
}

impl<R> ProjectService<R>
where
    R: ProjectRepository,
{
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    pub fn create(&self, name: String) -> Result<Project, AppError> {
        let project = Project::new(name)?;
        self.repository.insert_project(&project)?;

        Ok(project)
    }

    pub fn rename(&self, id: Uuid, name: String) -> Result<Project, AppError> {
        let mut project = self.require_active(id)?;
        project.rename(name)?;
        self.repository.update_project(&project)?;

        Ok(project)
    }

    pub fn archive(&self, id: Uuid) -> Result<Project, AppError> {
        let mut project = self.require_active(id)?;
        project.archive();
        self.repository.update_project(&project)?;

        Ok(project)
    }

    pub fn list_active(&self) -> Result<Vec<Project>, AppError> {
        self.repository.list_active_projects()
    }

    pub fn require_active(&self, id: Uuid) -> Result<Project, AppError> {
        self.repository
            .get_project(id)?
            .filter(|project| project.archived_at.is_none())
            .ok_or_else(project_not_found)
    }
}

fn project_not_found() -> AppError {
    AppError::new(
        "project.not_found",
        "errors.project.not_found",
        AppErrorKind::NotFound,
    )
}
