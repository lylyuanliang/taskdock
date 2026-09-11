use super::task_mutation_notification::{TaskMutationEvent, TASK_MUTATED_EVENT};

#[test]
fn task_mutation_event_uses_the_stable_wire_contract() {
    let task_id = "2e8afadc-b624-4cbe-a24a-4acb916a74e9";

    assert_eq!(TASK_MUTATED_EVENT, "task://mutated");
    assert_eq!(
        serde_json::to_value(TaskMutationEvent::new(task_id, 7)).unwrap(),
        serde_json::json!({
            "taskId": task_id,
            "revision": 7,
        })
    );
}
