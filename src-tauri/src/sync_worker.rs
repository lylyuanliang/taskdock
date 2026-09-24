use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};

use tauri::async_runtime::JoinHandle;
use tokio::{
    sync::mpsc::{self, error::TrySendError},
    time::MissedTickBehavior,
};
use tokio_util::sync::CancellationToken;

use crate::{
    domain::{
        ports::SyncRepository,
        sync_service::{SyncRunSummary, SyncService},
    },
    error::{AppError, AppErrorKind},
    infrastructure::{sync_crypto::CredentialStore, webdav::WebDavTransport},
};

pub(crate) const SYNC_POLL_INTERVAL: Duration = Duration::from_secs(300);
pub(crate) type SyncFuture<'a> =
    Pin<Box<dyn Future<Output = Result<SyncRunSummary, AppError>> + Send + 'a>>;

pub(crate) trait SyncScan: Send + Sync + 'static {
    fn scan<'a>(&'a self) -> SyncFuture<'a>;
}

impl<R, T, C> SyncScan for SyncService<R, T, C>
where
    R: SyncRepository + 'static,
    T: WebDavTransport + 'static,
    C: CredentialStore + 'static,
{
    fn scan<'a>(&'a self) -> SyncFuture<'a> {
        Box::pin(self.sync_now())
    }
}

pub(crate) struct SyncWorker {
    sync_sender: mpsc::Sender<()>,
    cancellation: CancellationToken,
    join_handle: Mutex<Option<JoinHandle<()>>>,
}

impl SyncWorker {
    pub(crate) fn start<S>(scanner: Arc<S>, poll_interval: Duration) -> Self
    where
        S: SyncScan,
    {
        let (sync_sender, sync_receiver) = mpsc::channel(1);
        let cancellation = CancellationToken::new();
        let worker_cancellation = cancellation.clone();
        let join_handle = tauri::async_runtime::spawn(run_worker(
            scanner,
            poll_interval,
            sync_receiver,
            worker_cancellation,
        ));

        Self {
            sync_sender,
            cancellation,
            join_handle: Mutex::new(Some(join_handle)),
        }
    }

    pub(crate) fn request_sync(&self) -> Result<(), AppError> {
        match self.sync_sender.try_send(()) {
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

impl Drop for SyncWorker {
    fn drop(&mut self) {
        self.stop();
    }
}

async fn run_worker<S>(
    scanner: Arc<S>,
    poll_interval: Duration,
    mut sync_receiver: mpsc::Receiver<()>,
    cancellation: CancellationToken,
) where
    S: SyncScan,
{
    let mut poll_timer = tokio::time::interval(poll_interval);
    poll_timer.set_missed_tick_behavior(MissedTickBehavior::Skip);
    poll_timer.tick().await;

    loop {
        if cancellation.is_cancelled() {
            break;
        }

        run_scan(scanner.as_ref()).await;

        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            wake = sync_receiver.recv() => {
                if wake.is_none() {
                    break;
                }
            }
            _ = poll_timer.tick() => {}
        }
    }
}

async fn run_scan<S>(scanner: &S)
where
    S: SyncScan,
{
    if let Err(error) = scanner.scan().await {
        if error.code() != "sync.configuration.missing" {
            eprintln!("sync background run failed: {error}");
        }
    }
}

fn worker_unavailable_error() -> AppError {
    AppError::new(
        "sync.worker.unavailable",
        "errors.sync.worker.unavailable",
        AppErrorKind::Internal,
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tokio::time::{sleep, timeout, Duration};

    use super::{SyncScan, SyncWorker};
    use crate::domain::sync_service::SyncRunSummary;

    #[derive(Clone, Default)]
    struct FakeScan {
        runs: Arc<AtomicUsize>,
    }

    impl SyncScan for FakeScan {
        fn scan<'a>(&'a self) -> super::SyncFuture<'a> {
            let runs = Arc::clone(&self.runs);
            Box::pin(async move {
                runs.fetch_add(1, Ordering::SeqCst);
                Ok(SyncRunSummary::default())
            })
        }
    }

    #[tokio::test]
    async fn worker_scans_on_start_and_coalesces_wake_requests() {
        let scanner = Arc::new(FakeScan::default());
        let worker = SyncWorker::start(Arc::clone(&scanner), Duration::from_secs(60));

        timeout(Duration::from_secs(1), async {
            loop {
                if scanner.runs.load(Ordering::SeqCst) >= 1 {
                    break;
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        worker.request_sync().unwrap();
        worker.request_sync().unwrap();
        worker.request_sync().unwrap();
        timeout(Duration::from_secs(1), async {
            loop {
                if scanner.runs.load(Ordering::SeqCst) >= 2 {
                    break;
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(scanner.runs.load(Ordering::SeqCst), 2);
        worker.shutdown().await;
    }
}
