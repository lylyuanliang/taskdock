pub(crate) mod domain;

pub(crate) mod error;

pub(crate) mod infrastructure;

pub(crate) mod main_window;

pub(crate) mod commands;

pub(crate) mod quick_panel;

pub(crate) mod reminder_worker;

pub(crate) mod reminder_notification;

pub(crate) mod task_mutation_notification;

pub(crate) mod sync_worker;

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
    sync::{
        get_sync_config, get_sync_status, list_sync_conflicts, pause_sync, resolve_sync_conflict,
        resume_sync, save_sync_config, sync_now, test_sync_connection,
    },
    tasks::{
        complete_task, create_subtask, create_task, create_task_editor, get_task_editor,
        list_inbox, list_tasks, update_task, update_task_editor,
    },
};
use domain::{
    project_service::ProjectService, reminders::ReminderScheduler, sync_service::SyncService,
    task_service::TaskService,
};
use infrastructure::{
    sqlite::SqliteTaskRepository, sync_crypto::WindowsCredentialStore, webdav::WebDavClient,
};
use main_window::{exit_app, open_main_window, open_main_window_for_app};
use quick_panel::{
    build_quick_panel, get_quick_panel_behavior, set_quick_panel_behavior, set_quick_panel_mode,
    QuickPanelNativeState,
};
use reminder_notification::TauriReminderNotifier;
use reminder_worker::{ReminderWorker, REMINDER_POLL_INTERVAL};
use sync_worker::{SyncWorker, SYNC_POLL_INTERVAL};
use task_mutation_notification::TauriTaskMutationNotifier;

pub(crate) struct AppState {
    tasks: Arc<TaskService<SqliteTaskRepository>>,
    projects: Arc<ProjectService<SqliteTaskRepository>>,
    sync_repository: Arc<SqliteTaskRepository>,
    sync_credentials: Arc<WindowsCredentialStore>,
    sync_service: Arc<SyncService<SqliteTaskRepository, WebDavClient, WindowsCredentialStore>>,
    sync_worker: SyncWorker,
    reminder_worker: ReminderWorker,
    task_mutation_notifier: TauriTaskMutationNotifier<tauri::Wry>,
}

impl AppState {
    fn open(app: &tauri::AppHandle) -> Result<Self, Box<dyn Error>> {
        let app_data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&app_data_dir)?;
        let repository = SqliteTaskRepository::open(&app_data_dir.join("todo-app.sqlite3"))?;
        let sync_repository = Arc::new(repository.clone());
        let sync_credentials = Arc::new(WindowsCredentialStore);
        let sync_transport = Arc::new(WebDavClient::new()?);
        let sync_service = Arc::new(SyncService::new(
            Arc::clone(&sync_repository),
            sync_transport,
            Arc::clone(&sync_credentials),
        ));
        let sync_worker = SyncWorker::start(Arc::clone(&sync_service), SYNC_POLL_INTERVAL);
        let reminder_scheduler = Arc::new(ReminderScheduler::new(
            TaskService::new(repository.clone()),
            TauriReminderNotifier::new(app.clone()),
        ));

        Ok(Self {
            tasks: Arc::new(TaskService::new(repository.clone())),
            projects: Arc::new(ProjectService::new(repository)),
            sync_repository,
            sync_credentials,
            sync_service,
            sync_worker,
            reminder_worker: ReminderWorker::start(reminder_scheduler, REMINDER_POLL_INTERVAL),
            task_mutation_notifier: TauriTaskMutationNotifier::new(app.clone()),
        })
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        self.sync_worker.stop();
        self.reminder_worker.stop();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = open_main_window_for_app(app).await {
                    eprintln!("unable to open the existing main window: {error}");
                }
            });
        }));
    }

    let app = builder
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
            exit_app,
            open_main_window,
            set_quick_panel_mode,
            set_quick_panel_behavior,
            get_quick_panel_behavior,
            get_sync_config,
            save_sync_config,
            test_sync_connection,
            get_sync_status,
            sync_now,
            pause_sync,
            resume_sync,
            list_sync_conflicts,
            resolve_sync_conflict
        ])
        .build(tauri::generate_context!())?;

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.sync_worker.stop();
                state.reminder_worker.stop();
            }
        }
    });

    Ok(())
}
