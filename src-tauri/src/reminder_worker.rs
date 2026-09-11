use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use chrono::{DateTime, Utc};
use tauri::async_runtime::JoinHandle;
use tokio::{
    sync::mpsc::{self, error::TrySendError},
    time::MissedTickBehavior,
};
use tokio_util::sync::CancellationToken;

use crate::{
    domain::{ports::TaskRepository, reminders::ReminderNotifier, reminders::ReminderScheduler},
    error::{AppError, AppErrorKind},
};

/// 正常运行时每 30 秒兜底扫描一次；任务变更会另行立即唤醒。
pub(crate) const REMINDER_POLL_INTERVAL: Duration = Duration::from_secs(30);

pub(crate) trait ReminderScan: Send + Sync + 'static {
    fn scan(&self, now: DateTime<Utc>) -> Result<(), AppError>;
}

pub(crate) trait ReminderRescanRequester {
    fn request_rescan(&self) -> Result<(), AppError>;
}

impl<R, N> ReminderScan for ReminderScheduler<R, N>
where
    R: TaskRepository + Send + Sync + 'static,
    N: ReminderNotifier + 'static,
{
    fn scan(&self, now: DateTime<Utc>) -> Result<(), AppError> {
        self.run_once(now)
    }
}

pub(crate) struct ReminderWorker {
    rescan_sender: mpsc::Sender<()>,
    cancellation: CancellationToken,
    join_handle: Mutex<Option<JoinHandle<()>>>,
}

impl ReminderWorker {
    pub(crate) fn start<S>(scanner: Arc<S>, poll_interval: Duration) -> Self
    where
        S: ReminderScan,
    {
        let (rescan_sender, rescan_receiver) = mpsc::channel(1);
        let cancellation = CancellationToken::new();
        let worker_cancellation = cancellation.clone();
        let join_handle = tauri::async_runtime::spawn(run_worker(
            scanner,
            poll_interval,
            rescan_receiver,
            worker_cancellation,
        ));

        Self {
            rescan_sender,
            cancellation,
            join_handle: Mutex::new(Some(join_handle)),
        }
    }

    pub(crate) fn request_rescan(&self) -> Result<(), AppError> {
        match self.rescan_sender.try_send(()) {
            Ok(()) | Err(TrySendError::Full(())) => Ok(()),
            Err(TrySendError::Closed(())) => Err(worker_unavailable_error()),
        }
    }

    pub(crate) fn cancel(&self) {
        self.cancellation.cancel();
    }

    #[cfg(test)]
    pub(crate) async fn shutdown(&self) {
        self.cancel();
        let join_handle = self.take_join_handle();
        if let Some(join_handle) = join_handle {
            let _ = join_handle.await;
        }
    }

    pub(crate) fn stop(&self) {
        self.cancel();
        if let Some(join_handle) = self.take_join_handle() {
            join_handle.abort();
        }
    }

    fn take_join_handle(&self) -> Option<JoinHandle<()>> {
        self.join_handle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
    }
}

impl Drop for ReminderWorker {
    fn drop(&mut self) {
        self.stop();
    }
}

impl ReminderRescanRequester for ReminderWorker {
    fn request_rescan(&self) -> Result<(), AppError> {
        ReminderWorker::request_rescan(self)
    }
}

async fn run_worker<S>(
    scanner: Arc<S>,
    poll_interval: Duration,
    mut rescan_receiver: mpsc::Receiver<()>,
    cancellation: CancellationToken,
) where
    S: ReminderScan,
{
    let mut poll_timer = tokio::time::interval(poll_interval);
    poll_timer.set_missed_tick_behavior(MissedTickBehavior::Skip);
    poll_timer.tick().await;

    loop {
        if cancellation.is_cancelled() {
            break;
        }

        run_scan(scanner.as_ref());

        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            wake = rescan_receiver.recv() => {
                if wake.is_none() {
                    break;
                }
            }
            _ = poll_timer.tick() => {}
        }
    }
}

fn run_scan<S>(scanner: &S)
where
    S: ReminderScan,
{
    if let Err(error) = scanner.scan(Utc::now()) {
        eprintln!("reminder background scan failed: {error}");
    }
}

fn worker_unavailable_error() -> AppError {
    AppError::new(
        "reminder.worker.unavailable",
        "errors.reminder.worker.unavailable",
        AppErrorKind::Internal,
    )
}
