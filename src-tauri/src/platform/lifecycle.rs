use crate::error::AppError;

pub(crate) trait SyncWorkerPort: Send + Sync {
    fn request_sync(&self) -> Result<(), AppError>;
    fn stop(&self);
}

#[cfg(desktop)]
pub(crate) trait ReminderWorkerPort: Send + Sync {
    fn request_rescan(&self) -> Result<(), AppError>;
    fn stop(&self);
}

#[cfg(mobile)]
pub(crate) trait ReminderWorkerPort: Send + Sync {
    fn request_rescan(&self) -> Result<(), AppError>;
    fn stop(&self);
}

#[cfg(desktop)]
pub(crate) struct PlatformSyncWorker(pub(crate) crate::sync_worker::SyncWorker);

#[cfg(mobile)]
#[derive(Debug, Default)]
pub(crate) struct PlatformSyncWorker;

#[cfg(desktop)]
pub(crate) struct PlatformReminderWorker(pub(crate) crate::reminder_worker::ReminderWorker);

#[cfg(mobile)]
#[derive(Debug, Default)]
pub(crate) struct PlatformReminderWorker;

#[cfg(desktop)]
impl PlatformSyncWorker {
    pub(crate) fn start<S>(scanner: std::sync::Arc<S>) -> Self
    where
        S: crate::sync_worker::SyncScan,
    {
        Self(crate::sync_worker::SyncWorker::start(scanner))
    }

    #[cfg(test)]
    pub(crate) fn is_disabled() -> bool {
        false
    }
}

#[cfg(mobile)]
impl PlatformSyncWorker {
    pub(crate) fn disabled() -> Self {
        Self
    }

    #[cfg(test)]
    pub(crate) fn is_disabled() -> bool {
        true
    }
}

#[cfg(desktop)]
impl PlatformReminderWorker {
    pub(crate) fn start<S>(scanner: std::sync::Arc<S>, poll_interval: std::time::Duration) -> Self
    where
        S: crate::reminder_worker::ReminderScan,
    {
        Self(crate::reminder_worker::ReminderWorker::start(
            scanner,
            poll_interval,
        ))
    }

    #[cfg(test)]
    pub(crate) fn is_disabled() -> bool {
        false
    }
}

#[cfg(mobile)]
impl PlatformReminderWorker {
    pub(crate) fn disabled() -> Self {
        Self
    }

    #[cfg(test)]
    pub(crate) fn is_disabled() -> bool {
        true
    }
}

#[cfg(desktop)]
impl SyncWorkerPort for PlatformSyncWorker {
    fn request_sync(&self) -> Result<(), AppError> {
        self.0.request_sync()
    }

    fn stop(&self) {
        self.0.stop();
    }
}

#[cfg(mobile)]
impl SyncWorkerPort for PlatformSyncWorker {
    fn request_sync(&self) -> Result<(), AppError> {
        Ok(())
    }

    fn stop(&self) {}
}

#[cfg(desktop)]
impl ReminderWorkerPort for PlatformReminderWorker {
    fn request_rescan(&self) -> Result<(), AppError> {
        self.0.request_rescan()
    }

    fn stop(&self) {
        self.0.stop();
    }
}

#[cfg(mobile)]
impl ReminderWorkerPort for PlatformReminderWorker {
    fn request_rescan(&self) -> Result<(), AppError> {
        Ok(())
    }

    fn stop(&self) {}
}

#[cfg(desktop)]
impl crate::reminder_worker::ReminderRescanRequester for PlatformReminderWorker {
    fn request_rescan(&self) -> Result<(), AppError> {
        ReminderWorkerPort::request_rescan(self)
    }
}

#[cfg(mobile)]
impl crate::reminder_worker::ReminderRescanRequester for PlatformReminderWorker {
    fn request_rescan(&self) -> Result<(), AppError> {
        ReminderWorkerPort::request_rescan(self)
    }
}

#[derive(Debug, Default)]
pub(crate) struct PlatformLifecycle;

impl PlatformLifecycle {
    pub(crate) fn start_desktop_workers(&self, _app: &tauri::AppHandle) {}

    pub(crate) fn stop_desktop_workers(&self) {}
}
