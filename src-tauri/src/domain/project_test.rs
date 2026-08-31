use std::sync::{Arc, Mutex};

use uuid::Uuid;

use crate::{
    domain::{ports::ProjectRepository, project::Project, project_service::ProjectService},
    error::AppError,
};

#[test]
fn project_service_trims_names_and_excludes_archived_projects() {
    let repository = RecordingProjectRepository::default();
    let service = ProjectService::new(repository.clone());

    let created = service.create("  Release checklist  ".into()).unwrap();
    service.archive(created.id).unwrap();

    assert_eq!(created.name, "Release checklist");
    assert!(service.list_active().unwrap().is_empty());
    assert_eq!(
        repository.get_project(created.id).unwrap().unwrap().id,
        created.id
    );
}

#[test]
fn project_service_rejects_blank_and_overlong_names() {
    let service = ProjectService::new(RecordingProjectRepository::default());

    assert_eq!(
        service.create("   ".into()).unwrap_err().code(),
        "project.input.invalid"
    );
    assert_eq!(
        service.create("a".repeat(121)).unwrap_err().code(),
        "project.input.invalid"
    );
}

#[derive(Clone, Default)]
struct RecordingProjectRepository {
    projects: Arc<Mutex<Vec<Project>>>,
}

impl ProjectRepository for RecordingProjectRepository {
    fn insert_project(&self, project: &Project) -> Result<(), AppError> {
        self.projects.lock().unwrap().push(project.clone());
        Ok(())
    }

    fn get_project(&self, id: Uuid) -> Result<Option<Project>, AppError> {
        Ok(self
            .projects
            .lock()
            .unwrap()
            .iter()
            .find(|project| project.id == id)
            .cloned())
    }

    fn update_project(&self, project: &Project) -> Result<(), AppError> {
        let mut projects = self.projects.lock().unwrap();
        let position = projects
            .iter()
            .position(|current| current.id == project.id)
            .unwrap();
        projects[position] = project.clone();
        Ok(())
    }

    fn list_active_projects(&self) -> Result<Vec<Project>, AppError> {
        Ok(self
            .projects
            .lock()
            .unwrap()
            .iter()
            .filter(|project| project.archived_at.is_none())
            .cloned()
            .collect())
    }
}
