use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};

use tauri::async_runtime::JoinHandle;
use tokio::sync::mpsc::{self, error::TrySendError};
use tokio_util::sync::CancellationToken;

use crate::{
    domain::{
        ports::SyncRepository,
        sync_service::{SyncRunSummary, SyncService},
    },
    error::{AppError, AppErrorKind},
    infrastructure::{sync_crypto::CredentialStore, webdav::WebDavTransport},
};

pub(crate) type SyncFuture<'a> =
    Pin<Box<dyn Future<Output = Result<SyncRunSummary, AppError>> + Send + 'a>>;

pub(crate) trait SyncScan: Send + Sync + 'static {
    fn automatic_interval(&self) -> Option<Duration>;
    fn scan<'a>(&'a self) -> SyncFuture<'a>;
}

impl<R, T, C> SyncScan for SyncService<R, T, C>
where
    R: SyncRepository + 'static,
    T: WebDavTransport + 'static,
    C: CredentialStore + 'static,
{
    fn automatic_interval(&self) -> Option<Duration> {
        self.automatic_sync_interval()
    }

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
    pub(crate) fn start<S>(scanner: Arc<S>) -> Self
    where
        S: SyncScan,
    {
        let (sync_sender, sync_receiver) = mpsc::channel(1);
        let cancellation = CancellationToken::new();
        let worker_cancellation = cancellation.clone();
        let join_handle =
            tauri::async_runtime::spawn(run_worker(scanner, sync_receiver, worker_cancellation));

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
    mut sync_receiver: mpsc::Receiver<()>,
    cancellation: CancellationToken,
) where
    S: SyncScan,
{
    let mut first_scan = true;
    loop {
        if cancellation.is_cancelled() {
            break;
        }

        let interval = scanner.automatic_interval();
        if first_scan {
            first_scan = false;
            if interval.is_some() {
                run_scan(scanner.as_ref()).await;
                continue;
            }
        }

        let should_scan = match interval {
            Some(interval) => {
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => break,
                    wake = sync_receiver.recv() => {
                        if wake.is_none() {
                            break;
                        }
                        true
                    }
                    _ = tokio::time::sleep(interval) => true,
                }
            }
            None => {
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => break,
                    wake = sync_receiver.recv() => {
                        if wake.is_none() {
                            break;
                        }
                        true
                    }
                }
            }
        };

        if should_scan {
            run_scan(scanner.as_ref()).await;
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

    #[derive(Clone)]
    struct FakeScan {
        runs: Arc<AtomicUsize>,
        automatic_interval: Option<Duration>,
    }

    impl Default for FakeScan {
        fn default() -> Self {
            Self {
                runs: Arc::new(AtomicUsize::new(0)),
                automatic_interval: Some(Duration::from_secs(60)),
            }
        }
    }

    impl SyncScan for FakeScan {
        fn automatic_interval(&self) -> Option<Duration> {
            self.automatic_interval
        }

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
        let worker = SyncWorker::start(Arc::clone(&scanner));

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

    #[tokio::test]
    async fn manual_frequency_waits_for_an_explicit_wake_request() {
        let scanner = Arc::new(FakeScan {
            runs: Arc::new(AtomicUsize::new(0)),
            automatic_interval: None,
        });
        let worker = SyncWorker::start(Arc::clone(&scanner));

        sleep(Duration::from_millis(50)).await;
        assert_eq!(scanner.runs.load(Ordering::SeqCst), 0);

        worker.request_sync().unwrap();
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
        worker.shutdown().await;
    }
}
