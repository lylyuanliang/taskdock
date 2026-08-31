pub(crate) mod domain;

pub(crate) mod error;

pub(crate) mod infrastructure;

pub(crate) mod commands;

pub(crate) mod quick_panel;

#[cfg(test)]
mod quick_panel_test;

use std::{error::Error, sync::Arc};

use tauri::Manager;

use commands::{
    projects::{archive_project, create_project, list_projects, rename_project},
    tasks::{create_task, list_inbox, list_tasks, update_task},
};
use domain::{project_service::ProjectService, task_service::TaskService};
use infrastructure::sqlite::SqliteTaskRepository;
use quick_panel::{
    build_quick_panel, get_quick_panel_behavior, set_quick_panel_behavior, set_quick_panel_mode,
    QuickPanelNativeState,
};

pub(crate) struct AppState {
    tasks: Arc<TaskService<SqliteTaskRepository>>,
    projects: Arc<ProjectService<SqliteTaskRepository>>,
}

impl AppState {
    fn open(app: &tauri::AppHandle) -> Result<Self, Box<dyn Error>> {
        let app_data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&app_data_dir)?;
        let repository = SqliteTaskRepository::open(&app_data_dir.join("todo-app.sqlite3"))?;

        Ok(Self {
            tasks: Arc::new(TaskService::new(repository.clone())),
            projects: Arc::new(ProjectService::new(repository)),
        })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(AppState::open(app.handle())?);
            let quick_panel_state = QuickPanelNativeState::open(&app.path().app_data_dir()?)?;
            build_quick_panel(app.handle(), quick_panel_state.clone())?;
            app.manage(quick_panel_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_task,
            update_task,
            list_inbox,
            list_tasks,
            list_projects,
            create_project,
            rename_project,
            archive_project,
            set_quick_panel_mode,
            set_quick_panel_behavior,
            get_quick_panel_behavior
        ])
        .run(tauri::generate_context!())?;

    Ok(())
}
