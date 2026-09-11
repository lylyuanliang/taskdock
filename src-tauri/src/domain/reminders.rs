use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use crate::{
    domain::{ports::TaskRepository, task::Task, task_service::TaskService},
    error::AppError,
};

pub trait ReminderNotifier: Send + Sync {
    fn notify(&self, task: &Task) -> Result<(), AppError>;
}

const REMINDER_CLAIM_LEASE: Duration = Duration::minutes(2);

pub struct ReminderScheduler<R, N>
where
    R: TaskRepository,
    N: ReminderNotifier,
{
    task_service: TaskService<R>,
    notifier: N,
    pending_release_claims: Mutex<Vec<PendingReleaseClaim>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct PendingReleaseClaim {
    task_id: Uuid,
    scheduled_at: DateTime<Utc>,
    claim_token: Uuid,
}

impl<R, N> ReminderScheduler<R, N>
where
    R: TaskRepository,
    N: ReminderNotifier,
{
    pub fn new(task_service: TaskService<R>, notifier: N) -> Self {
        Self {
            task_service,
            notifier,
            pending_release_claims: Mutex::new(Vec::new()),
        }
    }

    pub fn run_once(&self, now: DateTime<Utc>) -> Result<(), AppError> {
        let pending_release_claims = self.take_pending_release_claims();
        let mut first_error = None;
        let expired_before = now - REMINDER_CLAIM_LEASE;

        match self
            .task_service
            .list_due_reminder_candidates(now, expired_before)
        {
            Ok(tasks) => {
                for task in tasks {
                    let Some(scheduled_at) = task.scheduled_at else {
                        continue;
                    };
                    let claim_token = Uuid::new_v4();
                    let claimed = match self.task_service.claim_reminder(
                        task.id,
                        scheduled_at,
                        now,
                        expired_before,
                        claim_token,
                    ) {
                        Ok(claimed) => claimed,
                        Err(claim_error) => {
                            first_error.get_or_insert(claim_error);
                            break;
                        }
                    };
                    if !claimed {
                        continue;
                    }
                    if let Err(notification_error) = self.notifier.notify(&task) {
                        first_error.get_or_insert(notification_error);
                        if let Err(release_error) = self.task_service.release_reminder_claim(
                            task.id,
                            scheduled_at,
                            claim_token,
                        ) {
                            first_error.get_or_insert(release_error);
                            self.record_pending_release_claim(PendingReleaseClaim {
                                task_id: task.id,
                                scheduled_at,
                                claim_token,
                            });
                        }
                    } else if let Err(delivery_error) = self.task_service.mark_reminder_delivered(
                        task.id,
                        scheduled_at,
                        now,
                        claim_token,
                    ) {
                        first_error.get_or_insert(delivery_error);
                    }
                }
            }
            Err(candidate_query_error) => {
                first_error.get_or_insert(candidate_query_error);
            }
        }

        for pending_release_claim in pending_release_claims {
            if let Err(release_error) = self.task_service.release_reminder_claim(
                pending_release_claim.task_id,
                pending_release_claim.scheduled_at,
                pending_release_claim.claim_token,
            ) {
                first_error.get_or_insert(release_error);
                self.record_pending_release_claim(pending_release_claim);
            }
        }

        if let Some(error) = first_error {
            return Err(error);
        }

        Ok(())
    }

    fn take_pending_release_claims(&self) -> Vec<PendingReleaseClaim> {
        let mut pending_release_claims = self
            .pending_release_claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        std::mem::take(&mut *pending_release_claims)
    }

    fn record_pending_release_claim(&self, pending_release_claim: PendingReleaseClaim) {
        let mut pending_release_claims = self
            .pending_release_claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !pending_release_claims.contains(&pending_release_claim) {
            pending_release_claims.push(pending_release_claim);
        }
    }
}
