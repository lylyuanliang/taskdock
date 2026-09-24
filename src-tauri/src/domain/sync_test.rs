use std::collections::BTreeMap;

use serde_json::json;
use uuid::Uuid;

use super::{
    sync::{SyncEntity, SyncEntityKind},
    sync_merge::{apply_decision, merge_snapshots, MergeDecision},
};

fn entity(id: Uuid, title: &str, note: &str) -> SyncEntity {
    SyncEntity::new(
        id,
        SyncEntityKind::Task,
        BTreeMap::from([
            ("id".to_owned(), json!(id)),
            ("title".to_owned(), json!(title)),
            ("note".to_owned(), json!(note)),
        ]),
    )
}

#[test]
fn merge_keeps_local_only_changes() {
    let id = Uuid::new_v4();
    let base = entity(id, "原始标题", "原始备注");
    let local = entity(id, "本地标题", "原始备注");
    let remote = base.clone();

    let plan = merge_snapshots(&[base], std::slice::from_ref(&local), &[remote]);

    assert_eq!(plan.conflicts.len(), 0);
    assert_eq!(plan.entities, vec![local]);
    assert_eq!(plan.summary.merged, 1);
}

#[test]
fn merge_keeps_different_field_changes_from_both_sides() {
    let id = Uuid::new_v4();
    let base = entity(id, "原始标题", "原始备注");
    let local = entity(id, "本地标题", "原始备注");
    let remote = entity(id, "原始标题", "远端备注");

    let plan = merge_snapshots(&[base], &[local], &[remote]);

    assert_eq!(plan.conflicts.len(), 0);
    assert_eq!(plan.entities[0].fields["title"], json!("本地标题"));
    assert_eq!(plan.entities[0].fields["note"], json!("远端备注"));
}

#[test]
fn merge_creates_a_field_conflict_when_both_sides_change_the_same_field() {
    let id = Uuid::new_v4();
    let base = entity(id, "原始标题", "原始备注");
    let local = entity(id, "本地标题", "原始备注");
    let remote = entity(id, "远端标题", "原始备注");

    let plan = merge_snapshots(&[base], &[local], &[remote]);

    assert_eq!(plan.conflicts.len(), 1);
    assert_eq!(plan.conflicts[0].field_name, "title");
    assert_eq!(plan.conflicts[0].local_value, Some(json!("本地标题")));
    assert_eq!(plan.conflicts[0].remote_value, Some(json!("远端标题")));
}

#[test]
fn conflict_copy_preserves_both_values_and_appends_a_suffix() {
    let id = Uuid::new_v4();
    let local = entity(id, "本地标题", "原始备注");
    let conflict = super::sync_merge::SyncFieldConflict {
        entity_id: id,
        entity_kind: SyncEntityKind::Task,
        field_name: "title".to_owned(),
        local_value: Some(json!("本地标题")),
        remote_value: Some(json!("远端标题")),
        base_value: Some(json!("原始标题")),
    };

    let copies = apply_decision(&local, &conflict, MergeDecision::CreateConflictCopy);

    assert_eq!(copies.len(), 2);
    assert_eq!(copies[0].fields["title"], json!("本地标题"));
    assert_eq!(copies[1].fields["title"], json!("远端标题（冲突副本）"));
}

#[test]
fn delete_modify_conflict_decisions_preserve_or_delete_the_entity() {
    let id = Uuid::new_v4();
    let base = entity(id, "原始标题", "原始备注");
    let local = entity(id, "本地标题", "原始备注");

    let plan = merge_snapshots(&[base], std::slice::from_ref(&local), &[]);

    assert_eq!(plan.conflicts.len(), 1);
    let conflict = &plan.conflicts[0];
    assert_eq!(conflict.field_name, "__entity__");
    assert!(conflict.local_value.is_some());
    assert_eq!(conflict.remote_value, None);

    let kept = apply_decision(&local, conflict, MergeDecision::KeepLocal);
    assert_eq!(kept.len(), 1);
    assert!(!kept[0].deleted);

    let deleted = apply_decision(&local, conflict, MergeDecision::AcceptRemote);
    assert_eq!(deleted.len(), 1);
    assert!(deleted[0].deleted);
}
