pub(crate) mod domain;

pub(crate) mod error;

pub(crate) mod infrastructure;

pub(crate) mod commands;

pub(crate) mod quick_panel;

pub(crate) mod reminder_worker;

pub(crate) mod reminder_notification;

pub(crate) mod task_mutation_notification;

#[cfg(test)]
mod quick_panel_test;

#[cfg(test)]
mod reminder_worker_test;

#[cfg(test)]
mod reminder_notification_test;

#[cfg(test)]
mod task_mutation_notification_test;

use std::{error::Error, sync::Arc};

use tauri::Manager;

use commands::{
    projects::{archive_project, create_project, list_projects, rename_project},
    tasks::{
        complete_task, create_subtask, create_task, create_task_editor, get_task_editor,
        list_inbox, list_tasks, update_task, update_task_editor,
    },
};
use domain::{
    project_service::ProjectService, reminders::ReminderScheduler, task_service::TaskService,
};
use infrastructure::sqlite::SqliteTaskRepository;
use quick_panel::{
    build_quick_panel, get_quick_panel_behavior, set_quick_panel_behavior, set_quick_panel_mode,
    QuickPanelNativeState,
};
use reminder_notification::TauriReminderNotifier;
use reminder_worker::{ReminderWorker, REMINDER_POLL_INTERVAL};
use task_mutation_notification::TauriTaskMutationNotifier;

pub(crate) struct AppState {
    tasks: Arc<TaskService<SqliteTaskRepository>>,
    projects: Arc<ProjectService<SqliteTaskRepository>>,
    reminder_worker: ReminderWorker,
    task_mutation_notifier: TauriTaskMutationNotifier<tauri::Wry>,
}

impl AppState {
    fn open(app: &tauri::AppHandle) -> Result<Self, Box<dyn Error>> {
        let app_data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&app_data_dir)?;
        let repository = SqliteTaskRepository::open(&app_data_dir.join("todo-app.sqlite3"))?;
        let reminder_scheduler = Arc::new(ReminderScheduler::new(
            TaskService::new(repository.clone()),
            TauriReminderNotifier::new(app.clone()),
        ));

        Ok(Self {
            tasks: Arc::new(TaskService::new(repository.clone())),
            projects: Arc::new(ProjectService::new(repository)),
            reminder_worker: ReminderWorker::start(reminder_scheduler, REMINDER_POLL_INTERVAL),
            task_mutation_notifier: TauriTaskMutationNotifier::new(app.clone()),
        })
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        self.reminder_worker.stop();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
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
            complete_task,
            get_task_editor,
            create_task_editor,
            update_task_editor,
            create_subtask,
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
        .build(tauri::generate_context!())?;

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.reminder_worker.stop();
            }
        }
    });

    Ok(())
}
