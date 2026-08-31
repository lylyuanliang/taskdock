use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

use crate::{
    domain::task::Task,
    error::{AppError, AppErrorKind},
};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Frequency {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct RecurrenceRule {
    frequency: Frequency,
    interval: u32,
    until: Option<NaiveDate>,
    count: Option<u32>,
}

impl RecurrenceRule {
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "M2 任务编辑命令接入前保留新规则构造器")
    )]
    pub fn new(
        frequency: Frequency,
        interval: u32,
        until: Option<NaiveDate>,
        count: Option<u32>,
    ) -> Result<Self, AppError> {
        let rule = Self::from_persisted(frequency, interval, until, count)?;
        rule.validate_new_task()?;

        Ok(rule)
    }

    pub fn frequency(&self) -> Frequency {
        self.frequency
    }

    pub fn interval(&self) -> u32 {
        self.interval
    }

    pub(crate) fn validate_new_task(&self) -> Result<(), AppError> {
        if self.frequency == Frequency::Yearly {
            return Err(validation_error(
                "recurrence.frequency.unsupported",
                "errors.recurrence.frequency.unsupported",
            ));
        }

        Ok(())
    }

    pub(crate) fn uses_date_anchor(&self) -> bool {
        matches!(self.frequency, Frequency::Monthly | Frequency::Yearly)
    }

    fn from_persisted(
        frequency: Frequency,
        interval: u32,
        until: Option<NaiveDate>,
        count: Option<u32>,
    ) -> Result<Self, AppError> {
        if interval == 0 {
            return Err(validation_error(
                "recurrence.interval.invalid",
                "errors.recurrence.interval.invalid",
            ));
        }
        if count == Some(0) {
            return Err(validation_error(
                "recurrence.count.invalid",
                "errors.recurrence.count.invalid",
            ));
        }

        Ok(Self {
            frequency,
            interval,
            until,
            count,
        })
    }
}

impl<'de> Deserialize<'de> for RecurrenceRule {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum WireRule {
            Structured {
                frequency: Frequency,
                interval: u32,
                until: Option<NaiveDate>,
                count: Option<u32>,
            },
            Legacy(String),
        }

        let wire_rule = WireRule::deserialize(deserializer)?;
        let parsed = match wire_rule {
            WireRule::Structured {
                frequency,
                interval,
                until,
                count,
            } => Self::from_persisted(frequency, interval, until, count),
            WireRule::Legacy(value) => {
                let frequency = match value.as_str() {
                    "Daily" => Frequency::Daily,
                    "Weekly" => Frequency::Weekly,
                    "Monthly" => Frequency::Monthly,
                    "Yearly" => Frequency::Yearly,
                    _ => {
                        return Err(serde::de::Error::custom(
                            "invalid legacy recurrence frequency",
                        ));
                    }
                };

                Self::from_persisted(frequency, 1, None, None)
            }
        };

        parsed.map_err(|error| serde::de::Error::custom(error.code()))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "M2 完成任务用例接入前保留领域完成结果")
)]
pub struct TaskCompletion {
    pub completed_task: Task,
    pub next_task: Option<Task>,
}

#[cfg_attr(
    not(test),
    expect(dead_code, reason = "M2 完成任务用例接入前保留纯领域完成转换")
)]
pub fn complete_task(task: &Task, completed_at: DateTime<Utc>) -> Result<TaskCompletion, AppError> {
    let mut completed_task = task.clone();
    completed_task.completed_at = Some(completed_at);
    completed_task.updated_at = completed_at;

    let next_task = task
        .recurrence
        .as_ref()
        .map(|rule| next_instance(task, rule, completed_at))
        .transpose()?
        .flatten();

    Ok(TaskCompletion {
        completed_task,
        next_task,
    })
}

#[cfg_attr(
    not(test),
    expect(dead_code, reason = "仅由待接入的完成任务领域转换调用")
)]
fn next_instance(
    task: &Task,
    rule: &RecurrenceRule,
    completed_at: DateTime<Utc>,
) -> Result<Option<Task>, AppError> {
    let scheduled_at = task.scheduled_at.ok_or_else(|| {
        validation_error(
            "recurrence.scheduled_at.required",
            "errors.recurrence.scheduled_at.required",
        )
    })?;
    if task.parent_id.is_some() {
        return Err(validation_error(
            "recurrence.child.unsupported",
            "errors.recurrence.child.unsupported",
        ));
    }
    if rule
        .count
        .is_some_and(|count| task.instance_number >= count)
    {
        return Ok(None);
    }

    let next_scheduled_at = advance_scheduled_at(scheduled_at, rule, task.monthly_anchor_day)?;
    if rule
        .until
        .is_some_and(|until| next_scheduled_at.date_naive() > until)
    {
        return Ok(None);
    }

    let instance_number = task.instance_number.checked_add(1).ok_or_else(|| {
        validation_error(
            "recurrence.instance.overflow",
            "errors.recurrence.instance.overflow",
        )
    })?;
    let mut next_task = task.clone();
    next_task.id = Uuid::new_v4();
    next_task.scheduled_at = Some(next_scheduled_at);
    next_task.completed_at = None;
    next_task.reminder_sent_at = None;
    next_task.instance_number = instance_number;
    next_task.created_at = completed_at;
    next_task.updated_at = completed_at;
    if rule.uses_date_anchor() && next_task.monthly_anchor_day.is_none() {
        next_task.monthly_anchor_day = Some(scheduled_at.day() as u8);
    }

    Ok(Some(next_task))
}

#[cfg_attr(
    not(test),
    expect(dead_code, reason = "仅由待接入的完成任务领域转换调用")
)]
fn advance_scheduled_at(
    scheduled_at: DateTime<Utc>,
    rule: &RecurrenceRule,
    monthly_anchor_day: Option<u8>,
) -> Result<DateTime<Utc>, AppError> {
    match rule.frequency() {
        Frequency::Daily => add_days(scheduled_at, i64::from(rule.interval())),
        Frequency::Weekly => {
            let days = i64::from(rule.interval()).checked_mul(7).ok_or_else(|| {
                validation_error(
                    "recurrence.schedule.overflow",
                    "errors.recurrence.schedule.overflow",
                )
            })?;
            add_days(scheduled_at, days)
        }
        Frequency::Monthly => advance_months(scheduled_at, rule.interval(), monthly_anchor_day),
        Frequency::Yearly => advance_months(
            scheduled_at,
            rule.interval().checked_mul(12).ok_or_else(|| {
                validation_error(
                    "recurrence.schedule.overflow",
                    "errors.recurrence.schedule.overflow",
                )
            })?,
            monthly_anchor_day,
        ),
    }
}

#[cfg_attr(
    not(test),
    expect(dead_code, reason = "仅由待接入的完成任务领域转换调用")
)]
fn add_days(scheduled_at: DateTime<Utc>, days: i64) -> Result<DateTime<Utc>, AppError> {
    scheduled_at
        .checked_add_signed(Duration::days(days))
        .ok_or_else(|| {
            validation_error(
                "recurrence.schedule.overflow",
                "errors.recurrence.schedule.overflow",
            )
        })
}

#[cfg_attr(
    not(test),
    expect(dead_code, reason = "仅由待接入的完成任务领域转换调用")
)]
fn advance_months(
    scheduled_at: DateTime<Utc>,
    interval: u32,
    monthly_anchor_day: Option<u8>,
) -> Result<DateTime<Utc>, AppError> {
    let scheduled_date = scheduled_at.date_naive();
    let month_index = i64::from(scheduled_date.year())
        .checked_mul(12)
        .and_then(|value| value.checked_add(i64::from(scheduled_date.month0())))
        .and_then(|value| value.checked_add(i64::from(interval)))
        .ok_or_else(|| {
            validation_error(
                "recurrence.schedule.overflow",
                "errors.recurrence.schedule.overflow",
            )
        })?;
    let year = i32::try_from(month_index.div_euclid(12)).map_err(|_| {
        validation_error(
            "recurrence.schedule.overflow",
            "errors.recurrence.schedule.overflow",
        )
    })?;
    let month = u32::try_from(month_index.rem_euclid(12) + 1).map_err(|_| {
        validation_error(
            "recurrence.schedule.overflow",
            "errors.recurrence.schedule.overflow",
        )
    })?;
    let anchor_day = match monthly_anchor_day {
        Some(day) => u32::from(day),
        None => scheduled_date.day(),
    };
    let day = last_day_of_month(year, month).min(anchor_day);
    let next_date = NaiveDate::from_ymd_opt(year, month, day).ok_or_else(|| {
        validation_error(
            "recurrence.schedule.overflow",
            "errors.recurrence.schedule.overflow",
        )
    })?;

    Ok(DateTime::from_naive_utc_and_offset(
        next_date.and_time(scheduled_at.time()),
        Utc,
    ))
}

#[cfg_attr(
    not(test),
    expect(dead_code, reason = "仅由待接入的完成任务领域转换调用")
)]
fn last_day_of_month(year: i32, month: u32) -> u32 {
    (28..=31)
        .rev()
        .find(|day| NaiveDate::from_ymd_opt(year, month, *day).is_some())
        .unwrap_or(28)
}

fn validation_error(code: &'static str, translation_key: &'static str) -> AppError {
    AppError::new(code, translation_key, AppErrorKind::Validation)
}
