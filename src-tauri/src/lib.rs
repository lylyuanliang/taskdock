// Tauri 的 Android 入口宏会生成一个被框架消费的 Result，宏展开本身会触发该警告。
#![cfg_attr(mobile, allow(unused_must_use))]

pub(crate) mod domain;

pub(crate) mod error;

pub(crate) mod infrastructure;

pub(crate) mod platform;

#[cfg(desktop)]
pub(crate) mod main_window;

pub(crate) mod commands;

#[cfg(desktop)]
pub(crate) mod quick_panel;

pub(crate) mod reminder_worker;

#[cfg(desktop)]
pub(crate) mod reminder_notification;

pub(crate) mod task_mutation_notification;

#[cfg(desktop)]
pub(crate) mod sync_worker;

#[cfg(all(test, desktop))]
mod quick_panel_test;

#[cfg(all(test, desktop))]
mod reminder_worker_test;

#[cfg(all(test, desktop))]
mod reminder_notification_test;

#[cfg(test)]
mod task_mutation_notification_test;

use std::{error::Error, sync::Arc};

use tauri::Manager;

#[cfg(desktop)]
use commands::projects::{archive_project, rename_project};
use commands::{
    projects::{create_project, list_projects},
    sync::{
        get_saved_webdav_password, get_sync_config, get_sync_status, list_sync_conflicts,
        pause_sync, resolve_sync_conflict, resume_sync, save_sync_config, sync_now,
        test_sync_connection,
    },
    tasks::{
        complete_task, create_subtask, create_task, create_task_editor, get_task_editor,
        list_inbox, list_tasks, update_task, update_task_editor,
    },
};
use domain::{
    project_service::ProjectService, sync_service::SyncService, task_service::TaskService,
};
use infrastructure::{sqlite::SqliteTaskRepository, webdav::WebDavClient};
use platform::{
    credentials::PlatformCredentialStore,
    lifecycle::{
        PlatformLifecycle, PlatformReminderWorker, PlatformSyncWorker, ReminderWorkerPort,
        SyncWorkerPort,
    },
    paths::AppDataPath,
};
use task_mutation_notification::TauriTaskMutationNotifier;

#[cfg(desktop)]
use domain::reminders::ReminderScheduler;
#[cfg(desktop)]
use main_window::{exit_app, open_main_window, open_main_window_for_app};
#[cfg(desktop)]
use quick_panel::{
    build_quick_panel, get_quick_panel_behavior, set_quick_panel_behavior, set_quick_panel_mode,
    QuickPanelNativeState,
};
#[cfg(desktop)]
use reminder_notification::TauriReminderNotifier;

pub(crate) struct AppState {
    tasks: Arc<TaskService<SqliteTaskRepository>>,
    projects: Arc<ProjectService<SqliteTaskRepository>>,
    sync_repository: Arc<SqliteTaskRepository>,
    sync_credentials: Arc<PlatformCredentialStore>,
    sync_service: Arc<SyncService<SqliteTaskRepository, WebDavClient, PlatformCredentialStore>>,
    sync_worker: PlatformSyncWorker,
    reminder_worker: PlatformReminderWorker,
    lifecycle: PlatformLifecycle,
    task_mutation_notifier: TauriTaskMutationNotifier<tauri::Wry>,
}

impl AppState {
    fn open(app: &tauri::AppHandle) -> Result<Self, Box<dyn Error>> {
        let app_data_path = AppDataPath::from_app_handle(app)?;
        std::fs::create_dir_all(app_data_path.root())?;
        let repository = SqliteTaskRepository::open(&app_data_path.database_path())?;
        let sync_repository = Arc::new(repository.clone());
        #[cfg(target_os = "android")]
        let sync_credentials = Arc::new(PlatformCredentialStore::from_app(app)?);
        #[cfg(not(target_os = "android"))]
        let sync_credentials = Arc::new(PlatformCredentialStore::default());
        let sync_transport = Arc::new(WebDavClient::new()?);
        let sync_service = Arc::new(SyncService::new(
            Arc::clone(&sync_repository),
            sync_transport,
            Arc::clone(&sync_credentials),
        ));
        #[cfg(desktop)]
        let sync_worker = PlatformSyncWorker::start(Arc::clone(&sync_service));
        #[cfg(mobile)]
        let sync_worker = PlatformSyncWorker::disabled();

        #[cfg(desktop)]
        let reminder_scheduler = Arc::new(ReminderScheduler::new(
            TaskService::new(repository.clone()),
            TauriReminderNotifier::new(app.clone()),
        ));

        #[cfg(desktop)]
        let reminder_worker = PlatformReminderWorker::start(
            reminder_scheduler,
            reminder_worker::REMINDER_POLL_INTERVAL,
        );
        #[cfg(mobile)]
        let reminder_worker = PlatformReminderWorker::disabled();

        Ok(Self {
            tasks: Arc::new(TaskService::new(repository.clone())),
            projects: Arc::new(ProjectService::new(repository)),
            sync_repository,
            sync_credentials,
            sync_service,
            sync_worker,
            reminder_worker,
            lifecycle: PlatformLifecycle,
            task_mutation_notifier: TauriTaskMutationNotifier::new(app.clone()),
        })
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        self.sync_worker.stop();
        self.reminder_worker.stop();
        self.lifecycle.stop_desktop_workers();
    }
}

#[cfg_attr(mobile, allow(unused_must_use))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    #[cfg(desktop)]
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_notification::init());
    #[cfg(target_os = "android")]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(platform::android_keystore::init());

    #[cfg(all(mobile, not(target_os = "android")))]
    let builder = tauri::Builder::default().plugin(tauri_plugin_notification::init());

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

    let builder = builder.setup(|app| {
        app.manage(AppState::open(app.handle())?);
        if let Some(state) = app.try_state::<AppState>() {
            state.lifecycle.start_desktop_workers(app.handle());
        }
        #[cfg(desktop)]
        {
            let quick_panel_state = QuickPanelNativeState::open(&app.path().app_data_dir()?)?;
            build_quick_panel(app.handle(), quick_panel_state.clone())?;
            app.manage(quick_panel_state);
        }

        Ok(())
    });

    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
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
        get_saved_webdav_password,
        save_sync_config,
        test_sync_connection,
        get_sync_status,
        sync_now,
        pause_sync,
        resume_sync,
        list_sync_conflicts,
        resolve_sync_conflict
    ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
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
        get_sync_config,
        get_saved_webdav_password,
        save_sync_config,
        test_sync_connection,
        get_sync_status,
        sync_now,
        pause_sync,
        resume_sync,
        list_sync_conflicts,
        resolve_sync_conflict
    ]);

    let app = builder.build(tauri::generate_context!())?;

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.sync_worker.stop();
                state.reminder_worker.stop();
                state.lifecycle.stop_desktop_workers();
            }
        }
    });

    Ok(())
}
