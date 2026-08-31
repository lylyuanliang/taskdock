use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::domain::task::Priority;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskView {
    Inbox,
    Today { day: NaiveDate },
    Upcoming { day: NaiveDate },
    Completed,
    Project(Uuid),
    Search(String),
    Calendar { start: NaiveDate, end: NaiveDate },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummaryDto {
    pub id: String,
    pub title: String,
    pub project_name: Option<String>,
    pub tags: Vec<String>,
    pub priority: Priority,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub due_at: Option<DateTime<Utc>>,
    pub completed: bool,
    pub child_total: u32,
    pub child_completed: u32,
}
