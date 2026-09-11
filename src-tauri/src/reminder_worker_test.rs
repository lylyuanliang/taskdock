use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc, Mutex,
    },
    time::Duration,
};

use chrono::{DateTime, Utc};
use tokio::{sync::mpsc as tokio_mpsc, time::timeout};

use super::reminder_worker::{ReminderScan, ReminderWorker};
use crate::error::AppError;

const TEST_TIMEOUT: Duration = Duration::from_secs(2);
const LONG_POLL_INTERVAL: Duration = Duration::from_secs(60 * 60);

#[tokio::test]
async fn reminder_worker_scans_immediately_when_started() {
    let (scanner, mut scan_started, scan_permit) = ControlledScanner::new();
    let worker = ReminderWorker::start(scanner.clone(), LONG_POLL_INTERVAL);

    assert_eq!(next_scan(&mut scan_started).await, 1);

    scan_permit.send(()).unwrap();
    timeout(TEST_TIMEOUT, worker.shutdown()).await.unwrap();
    assert_eq!(scanner.call_count(), 1);
}

#[tokio::test]
async fn reminder_worker_coalesces_wake_requests_while_a_scan_is_running() {
    let (scanner, mut scan_started, scan_permit) = ControlledScanner::new();
    let worker = ReminderWorker::start(scanner.clone(), LONG_POLL_INTERVAL);
    assert_eq!(next_scan(&mut scan_started).await, 1);

    worker.request_rescan().unwrap();
    worker.request_rescan().unwrap();
    worker.request_rescan().unwrap();
    scan_permit.send(()).unwrap();

    assert_eq!(next_scan(&mut scan_started).await, 2);

    worker.cancel();
    scan_permit.send(()).unwrap();
    timeout(TEST_TIMEOUT, worker.shutdown()).await.unwrap();
    assert_eq!(scanner.call_count(), 2);
}

#[tokio::test]
async fn reminder_worker_shutdown_cancels_the_next_poll() {
    let (scanner, mut scan_started, scan_permit) = ControlledScanner::new();
    let worker = ReminderWorker::start(scanner.clone(), LONG_POLL_INTERVAL);
    assert_eq!(next_scan(&mut scan_started).await, 1);

    worker.cancel();
    scan_permit.send(()).unwrap();
    timeout(TEST_TIMEOUT, worker.shutdown()).await.unwrap();
    assert_eq!(scanner.call_count(), 1);
}

async fn next_scan(scan_started: &mut tokio_mpsc::UnboundedReceiver<usize>) -> usize {
    timeout(TEST_TIMEOUT, scan_started.recv())
        .await
        .unwrap()
        .unwrap()
}

struct ControlledScanner {
    call_count: AtomicUsize,
    scan_started: tokio_mpsc::UnboundedSender<usize>,
    scan_permit: Mutex<Receiver<()>>,
}

impl ControlledScanner {
    fn new() -> (Arc<Self>, tokio_mpsc::UnboundedReceiver<usize>, Sender<()>) {
        let (scan_started_sender, scan_started_receiver) = tokio_mpsc::unbounded_channel();
        let (scan_permit_sender, scan_permit_receiver) = mpsc::channel();

        (
            Arc::new(Self {
                call_count: AtomicUsize::new(0),
                scan_started: scan_started_sender,
                scan_permit: Mutex::new(scan_permit_receiver),
            }),
            scan_started_receiver,
            scan_permit_sender,
        )
    }

    fn call_count(&self) -> usize {
        self.call_count.load(Ordering::SeqCst)
    }
}

impl ReminderScan for ControlledScanner {
    fn scan(&self, _now: DateTime<Utc>) -> Result<(), AppError> {
        let call_count = self.call_count.fetch_add(1, Ordering::SeqCst) + 1;
        self.scan_started.send(call_count).unwrap();
        self.scan_permit
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv()
            .unwrap();

        Ok(())
    }
}
