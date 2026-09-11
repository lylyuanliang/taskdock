use notify_rust::Notification;
use tauri::{AppHandle, Runtime};

use crate::{
    domain::{reminders::ReminderNotifier, task::Task},
    error::{AppError, AppErrorKind},
};

pub(crate) trait NativeNotificationPresenter: Send + Sync {
    fn show(&self, notification: &Notification) -> notify_rust::error::Result<()>;
}

pub(crate) struct NotifyRustPresenter;

impl NativeNotificationPresenter for NotifyRustPresenter {
    fn show(&self, notification: &Notification) -> notify_rust::error::Result<()> {
        notification.show().map(|_| ())
    }
}

pub(crate) struct TauriReminderNotifier<P = NotifyRustPresenter> {
    product_name: String,
    identifier: String,
    presenter: P,
}

impl TauriReminderNotifier {
    pub(crate) fn new<R: Runtime>(app_handle: AppHandle<R>) -> Self {
        let product_name = app_handle
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| "TaskDock".into());

        Self::with_presenter(
            product_name,
            app_handle.config().identifier.clone(),
            NotifyRustPresenter,
        )
    }
}

impl<P: NativeNotificationPresenter> TauriReminderNotifier<P> {
    pub(crate) fn with_presenter(product_name: String, identifier: String, presenter: P) -> Self {
        Self {
            product_name,
            identifier,
            presenter,
        }
    }
}

impl<P: NativeNotificationPresenter> ReminderNotifier for TauriReminderNotifier<P> {
    fn notify(&self, task: &Task) -> Result<(), AppError> {
        let mut notification = Notification::new();
        notification
            .summary(&self.product_name)
            .body(&task.title)
            .auto_icon();

        #[cfg(windows)]
        {
            let executable =
                tauri::utils::platform::current_exe().map_err(|_| native_notification_error())?;
            if let Some(app_id) = windows_notification_app_id(&self.identifier, &executable)? {
                notification.app_id(app_id);
            }
        }
        #[cfg(target_os = "macos")]
        {
            let _ = notify_rust::set_application(if tauri::is_dev() {
                "com.apple.Terminal"
            } else {
                &self.identifier
            });
        }

        // 只有原生 API 确认提交成功，调度器才可持久化已送达状态。
        map_native_notification_result(self.presenter.show(&notification))
    }
}

#[cfg(windows)]
pub(crate) fn windows_notification_app_id<'a>(
    identifier: &'a str,
    executable: &std::path::Path,
) -> Result<Option<&'a str>, AppError> {
    use std::path::MAIN_SEPARATOR as SEP;

    let executable_directory = executable.parent().ok_or_else(native_notification_error)?;
    let directory = executable_directory.display().to_string();
    // 与 Tauri 插件保持一致：仅安装后的程序使用注册的 AppUserModelID。
    if directory.ends_with(&format!("{SEP}target{SEP}debug"))
        || directory.ends_with(&format!("{SEP}target{SEP}release"))
    {
        Ok(None)
    } else {
        Ok(Some(identifier))
    }
}

pub(crate) fn map_native_notification_result<E>(result: Result<(), E>) -> Result<(), AppError> {
    result.map_err(|_| native_notification_error())
}

fn native_notification_error() -> AppError {
    AppError::new(
        "reminder.notification.failed",
        "errors.reminder.notification.failed",
        AppErrorKind::Internal,
    )
}
