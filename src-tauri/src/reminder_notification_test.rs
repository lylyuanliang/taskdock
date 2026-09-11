use std::sync::{
    atomic::{AtomicUsize, Ordering},
    mpsc::{self, Receiver, Sender},
    Arc, Mutex,
};
use std::time::Duration;

use notify_rust::Notification;

use crate::domain::{reminders::ReminderNotifier, task::Task};

use super::reminder_notification::{
    map_native_notification_result, NativeNotificationPresenter, TauriReminderNotifier,
};

#[test]
fn reminder_notification_propagates_the_native_presenter_failure() {
    let presenter = ControlledNativePresenter::failing_once();
    let notifier = TauriReminderNotifier::with_presenter(
        "TaskDock".into(),
        "com.taskdock.app".into(),
        presenter.clone(),
    );
    let task = Task::for_test("提交失败的提醒".into());

    let result = notifier.notify(&task);
    presenter.wait_for_attempt();
    let error = result.unwrap_err();

    assert_eq!(error.code(), "reminder.notification.failed");
    assert_eq!(
        error.translation_key(),
        "errors.reminder.notification.failed"
    );
    assert_eq!(presenter.messages(), vec![("TaskDock".into(), task.title)]);
}

#[cfg(windows)]
#[test]
fn reminder_notification_uses_the_installed_app_id_and_preserves_dev_attribution() {
    use super::reminder_notification::windows_notification_app_id;
    use std::path::Path;

    let identifier = "com.taskdock.app";
    assert_eq!(
        windows_notification_app_id(
            identifier,
            Path::new(r"C:\Program Files\TaskDock\todo-app.exe")
        )
        .unwrap(),
        Some(identifier)
    );
    for executable in [
        r"D:\taskdock\target\debug\todo-app.exe",
        r"D:\taskdock\target\release\todo-app.exe",
    ] {
        assert_eq!(
            windows_notification_app_id(identifier, Path::new(executable)).unwrap(),
            None
        );
    }
}

#[derive(Clone)]
pub(crate) struct ControlledNativePresenter {
    attempts: Arc<AtomicUsize>,
    messages: Arc<Mutex<Vec<(String, String)>>>,
    completed_sender: Sender<()>,
    completed_receiver: Arc<Mutex<Receiver<()>>>,
}

impl ControlledNativePresenter {
    pub(crate) fn failing_once() -> Self {
        let (completed_sender, completed_receiver) = mpsc::channel();
        Self {
            attempts: Arc::new(AtomicUsize::new(0)),
            messages: Arc::new(Mutex::new(Vec::new())),
            completed_sender,
            completed_receiver: Arc::new(Mutex::new(completed_receiver)),
        }
    }

    pub(crate) fn wait_for_attempt(&self) {
        self.completed_receiver
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
    }

    pub(crate) fn attempt_count(&self) -> usize {
        self.attempts.load(Ordering::Relaxed)
    }

    fn messages(&self) -> Vec<(String, String)> {
        self.messages.lock().unwrap().clone()
    }
}

impl NativeNotificationPresenter for ControlledNativePresenter {
    fn show(&self, notification: &Notification) -> notify_rust::error::Result<()> {
        self.messages
            .lock()
            .unwrap()
            .push((notification.summary.clone(), notification.body.clone()));
        let attempt = self.attempts.fetch_add(1, Ordering::Relaxed);
        self.completed_sender.send(()).unwrap();
        if attempt == 0 {
            return Err("native submission rejected".into());
        }

        Ok(())
    }
}

#[test]
fn native_notification_errors_map_to_a_stable_reminder_error() {
    let error = map_native_notification_result(Err("native failure")).unwrap_err();

    assert_eq!(error.code(), "reminder.notification.failed");
    assert_eq!(
        error.translation_key(),
        "errors.reminder.notification.failed"
    );
}
