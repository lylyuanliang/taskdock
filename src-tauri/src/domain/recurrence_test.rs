use chrono::{DateTime, TimeZone, Utc};

use super::{
    recurrence::{complete_task, Frequency, RecurrenceRule},
    task::Task,
};

#[test]
fn completing_a_weekly_task_creates_the_next_instance_from_its_schedule() {
    let task = recurring_task(Frequency::Weekly, 1, utc(2026, 8, 26, 9, 0, 0));

    let completion = complete_task(&task, utc(2026, 8, 30, 12, 0, 0)).unwrap();
    let next = completion.next_task.unwrap();

    assert_eq!(
        completion.completed_task.completed_at,
        Some(utc(2026, 8, 30, 12, 0, 0))
    );
    assert_eq!(next.scheduled_at, Some(utc(2026, 9, 2, 9, 0, 0)));
    assert_ne!(next.id, task.id);
}

#[test]
fn daily_interval_advances_from_the_original_schedule() {
    let task = recurring_task(Frequency::Daily, 3, utc(2026, 8, 26, 9, 0, 0));

    let next = complete_task(&task, utc(2026, 9, 10, 12, 0, 0))
        .unwrap()
        .next_task
        .unwrap();

    assert_eq!(next.scheduled_at, Some(utc(2026, 8, 29, 9, 0, 0)));
}

#[test]
fn monthly_recurrence_falls_back_in_short_months_and_restores_the_anchor_day() {
    let january = recurring_task(Frequency::Monthly, 1, utc(2026, 1, 31, 9, 0, 0));

    let february = complete_task(&january, utc(2026, 1, 31, 10, 0, 0))
        .unwrap()
        .next_task
        .unwrap();
    let march = complete_task(&february, utc(2026, 2, 28, 10, 0, 0))
        .unwrap()
        .next_task
        .unwrap();

    assert_eq!(february.scheduled_at, Some(utc(2026, 2, 28, 9, 0, 0)));
    assert_eq!(march.scheduled_at, Some(utc(2026, 3, 31, 9, 0, 0)));
    assert_eq!(march.monthly_anchor_day, Some(31));
}

#[test]
fn until_includes_its_boundary_date() {
    let mut task = recurring_task(Frequency::Daily, 1, utc(2026, 8, 26, 9, 0, 0));
    task.recurrence =
        Some(RecurrenceRule::new(Frequency::Daily, 1, Some(date(2026, 8, 27)), None).unwrap());

    let boundary_instance = complete_task(&task, utc(2026, 8, 26, 10, 0, 0))
        .unwrap()
        .next_task
        .unwrap();
    let after_boundary = complete_task(&boundary_instance, utc(2026, 8, 27, 10, 0, 0)).unwrap();

    assert_eq!(
        boundary_instance.scheduled_at,
        Some(utc(2026, 8, 27, 9, 0, 0))
    );
    assert_eq!(after_boundary.next_task, None);
}

#[test]
fn count_includes_the_current_instance() {
    let mut task = recurring_task(Frequency::Daily, 1, utc(2026, 8, 26, 9, 0, 0));
    task.recurrence = Some(RecurrenceRule::new(Frequency::Daily, 1, None, Some(2)).unwrap());

    let second = complete_task(&task, utc(2026, 8, 26, 10, 0, 0))
        .unwrap()
        .next_task
        .unwrap();
    let result = complete_task(&second, utc(2026, 8, 27, 10, 0, 0)).unwrap();

    assert_eq!(second.instance_number, 2);
    assert_eq!(result.next_task, None);
}

#[test]
fn recurring_tasks_without_a_schedule_are_rejected() {
    let mut task = recurring_task(Frequency::Daily, 1, utc(2026, 8, 26, 9, 0, 0));
    task.scheduled_at = None;

    let error = complete_task(&task, utc(2026, 8, 26, 10, 0, 0)).unwrap_err();

    assert_eq!(error.code(), "recurrence.scheduled_at.required");
}

#[test]
fn zero_interval_is_rejected() {
    let error = RecurrenceRule::new(Frequency::Daily, 0, None, None).unwrap_err();

    assert_eq!(error.code(), "recurrence.interval.invalid");
}

#[test]
fn recurring_subtasks_are_rejected() {
    let mut task = recurring_task(Frequency::Daily, 1, utc(2026, 8, 26, 9, 0, 0));
    task.parent_id = Some(uuid::Uuid::new_v4());

    let error = complete_task(&task, utc(2026, 8, 26, 10, 0, 0)).unwrap_err();

    assert_eq!(error.code(), "recurrence.child.unsupported");
}

#[test]
fn completing_a_recurring_task_keeps_completed_and_next_instance_fields_isolated() {
    let mut task = recurring_task(Frequency::Daily, 1, utc(2026, 8, 26, 9, 0, 0));
    task.reminder_sent_at = Some(utc(2026, 8, 26, 8, 45, 0));

    let completion = complete_task(&task, utc(2026, 8, 26, 10, 0, 0)).unwrap();
    let next = completion.next_task.unwrap();

    assert_eq!(
        completion.completed_task.completed_at,
        Some(utc(2026, 8, 26, 10, 0, 0))
    );
    assert_eq!(
        completion.completed_task.reminder_sent_at,
        task.reminder_sent_at
    );
    assert_eq!(next.completed_at, None);
    assert_eq!(next.reminder_sent_at, None);
    assert_eq!(next.instance_number, 2);
}

#[test]
fn legacy_enum_rules_remain_readable_for_all_historical_frequencies() {
    let legacy_rules = [
        (r#""Daily""#, Frequency::Daily),
        (r#""Weekly""#, Frequency::Weekly),
        (r#""Monthly""#, Frequency::Monthly),
        (r#""Yearly""#, Frequency::Yearly),
    ];

    for (legacy_json, expected_frequency) in legacy_rules {
        let rule: RecurrenceRule = serde_json::from_str(legacy_json).unwrap();

        assert_eq!(rule.frequency(), expected_frequency);
        assert_eq!(rule.interval(), 1);
    }
}

#[test]
fn legacy_yearly_recurrence_restores_a_leap_day_after_common_years() {
    let mut task = Task::for_test("Renew certification".into());
    task.scheduled_at = Some(utc(2024, 2, 29, 9, 0, 0));
    task.recurrence = Some(legacy_rule("Yearly"));
    task.monthly_anchor_day = Some(29);

    let in_2025 = complete_task(&task, utc(2024, 2, 29, 10, 0, 0))
        .unwrap()
        .next_task
        .unwrap();
    let in_2026 = complete_task(&in_2025, utc(2025, 2, 28, 10, 0, 0))
        .unwrap()
        .next_task
        .unwrap();
    let in_2027 = complete_task(&in_2026, utc(2026, 2, 28, 10, 0, 0))
        .unwrap()
        .next_task
        .unwrap();
    let in_2028 = complete_task(&in_2027, utc(2027, 2, 28, 10, 0, 0))
        .unwrap()
        .next_task
        .unwrap();

    assert_eq!(in_2025.scheduled_at, Some(utc(2025, 2, 28, 9, 0, 0)));
    assert_eq!(in_2028.scheduled_at, Some(utc(2028, 2, 29, 9, 0, 0)));
    assert_eq!(in_2028.monthly_anchor_day, Some(29));
}

fn recurring_task(frequency: Frequency, interval: u32, scheduled_at: DateTime<Utc>) -> Task {
    let mut task = Task::for_test("Review recurrence".into());
    task.scheduled_at = Some(scheduled_at);
    task.recurrence = Some(RecurrenceRule::new(frequency, interval, None, None).unwrap());

    task
}

fn legacy_rule(frequency: &str) -> RecurrenceRule {
    serde_json::from_str(&format!("\"{frequency}\"")).unwrap()
}

fn date(year: i32, month: u32, day: u32) -> chrono::NaiveDate {
    utc(year, month, day, 0, 0, 0).date_naive()
}

fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, hour, minute, second)
        .single()
        .unwrap()
}
