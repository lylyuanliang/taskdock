use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde_json::Value;
use uuid::Uuid;

use super::sync::{SyncEntity, SyncEntityKind, CONFLICT_COPY_SUFFIX};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
struct EntityKey {
    id: Uuid,
    kind: SyncEntityKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SyncFieldConflict {
    pub entity_id: Uuid,
    pub entity_kind: SyncEntityKind,
    pub field_name: String,
    pub local_value: Option<Value>,
    pub remote_value: Option<Value>,
    pub base_value: Option<Value>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct MergeSummary {
    pub local_only: u32,
    pub remote_only: u32,
    pub merged: u32,
    pub conflicts: u32,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct MergePlan {
    pub entities: Vec<SyncEntity>,
    pub conflicts: Vec<SyncFieldConflict>,
    pub summary: MergeSummary,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MergeDecision {
    KeepLocal,
    AcceptRemote,
    CreateConflictCopy,
}

pub fn merge_snapshots(
    base: &[SyncEntity],
    local: &[SyncEntity],
    remote: &[SyncEntity],
) -> MergePlan {
    let base = index_entities(base);
    let local = index_entities(local);
    let remote = index_entities(remote);
    let keys = base
        .keys()
        .chain(local.keys())
        .chain(remote.keys())
        .copied()
        .collect::<BTreeSet<_>>();
    let mut plan = MergePlan::default();

    for key in keys {
        let base_entity = base.get(&key);
        let local_entity = local.get(&key);
        let remote_entity = remote.get(&key);

        match (base_entity, local_entity, remote_entity) {
            (None, Some(entity), None) | (None, None, Some(entity)) => {
                plan.summary.local_only += u32::from(local_entity.is_some());
                plan.summary.remote_only += u32::from(remote_entity.is_some());
                plan.entities.push((*entity).clone());
            }
            (Some(base), Some(local), None) => {
                if local == base {
                    plan.summary.remote_only += 1;
                } else {
                    add_delete_conflict(&mut plan, base, Some(local), None);
                }
            }
            (Some(base), None, Some(remote)) => {
                if remote == base {
                    plan.summary.local_only += 1;
                } else {
                    add_delete_conflict(&mut plan, base, None, Some(remote));
                }
            }
            (Some(_), None, None) => {}
            (None, None, None) => {}
            (None, Some(local), Some(remote)) => {
                if local == remote {
                    plan.entities.push((*local).clone());
                } else {
                    add_entity_conflict(&mut plan, local, remote);
                }
            }
            (Some(base), Some(local), Some(remote)) => {
                merge_entity(&mut plan, base, local, remote);
            }
        }
    }

    plan.entities.sort_by_key(|entity| (entity.kind, entity.id));
    plan.conflicts.sort_by_key(|conflict| {
        (
            conflict.entity_kind,
            conflict.entity_id,
            conflict.field_name.clone(),
        )
    });
    plan
}

pub fn apply_decision(
    entity: &SyncEntity,
    conflict: &SyncFieldConflict,
    decision: MergeDecision,
) -> Vec<SyncEntity> {
    match decision {
        MergeDecision::KeepLocal => {
            vec![update_field(entity, conflict, conflict.local_value.clone())]
        }
        MergeDecision::AcceptRemote => {
            vec![update_field(
                entity,
                conflict,
                conflict.remote_value.clone(),
            )]
        }
        MergeDecision::CreateConflictCopy => {
            let local_copy = update_field(entity, conflict, conflict.local_value.clone());
            if conflict.remote_value.is_none() {
                return vec![local_copy];
            }
            let mut remote_copy = update_field(entity, conflict, conflict.remote_value.clone());
            remote_copy.id = Uuid::new_v4();
            remote_copy
                .fields
                .insert("id".to_owned(), Value::String(remote_copy.id.to_string()));
            append_conflict_copy_suffix(&mut remote_copy);
            vec![local_copy, remote_copy]
        }
    }
}

fn merge_entity(plan: &mut MergePlan, base: &SyncEntity, local: &SyncEntity, remote: &SyncEntity) {
    let fields = base
        .fields
        .keys()
        .chain(local.fields.keys())
        .chain(remote.fields.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut merged = local.clone();

    for field_name in fields {
        if is_derived_field(&field_name) {
            continue;
        }
        let base_value = base.fields.get(&field_name);
        let local_value = local.fields.get(&field_name);
        let remote_value = remote.fields.get(&field_name);
        let local_changed = local_value != base_value;
        let remote_changed = remote_value != base_value;

        match (local_changed, remote_changed) {
            (false, false) => {
                set_field(&mut merged.fields, &field_name, base_value.cloned());
            }
            (true, false) => {
                set_field(&mut merged.fields, &field_name, local_value.cloned());
            }
            (false, true) => {
                set_field(&mut merged.fields, &field_name, remote_value.cloned());
            }
            (true, true) if local_value == remote_value => {
                set_field(&mut merged.fields, &field_name, local_value.cloned());
            }
            (true, true) => {
                plan.conflicts.push(SyncFieldConflict {
                    entity_id: local.id,
                    entity_kind: local.kind,
                    field_name,
                    local_value: local_value.cloned(),
                    remote_value: remote_value.cloned(),
                    base_value: base_value.cloned(),
                });
                plan.summary.conflicts += 1;
            }
        }
    }

    plan.summary.merged += 1;
    plan.entities.push(merged);
}

fn is_derived_field(field_name: &str) -> bool {
    matches!(
        field_name,
        "id" | "created_at" | "updated_at" | "revision" | "reminder_sent_at"
    )
}

fn add_delete_conflict(
    plan: &mut MergePlan,
    base: &SyncEntity,
    local: Option<&SyncEntity>,
    remote: Option<&SyncEntity>,
) {
    plan.conflicts.push(SyncFieldConflict {
        entity_id: local.or(remote).map(|entity| entity.id).unwrap_or(base.id),
        entity_kind: local
            .or(remote)
            .map(|entity| entity.kind)
            .unwrap_or(base.kind),
        field_name: "__entity__".to_owned(),
        local_value: local.map(entity_value),
        remote_value: remote.map(entity_value),
        base_value: Some(entity_value(base)),
    });
    plan.summary.conflicts += 1;
}

fn entity_value(entity: &SyncEntity) -> Value {
    Value::Object(entity.fields.clone().into_iter().collect())
}

fn add_entity_conflict(plan: &mut MergePlan, local: &SyncEntity, remote: &SyncEntity) {
    plan.conflicts.push(SyncFieldConflict {
        entity_id: local.id,
        entity_kind: local.kind,
        field_name: "__entity__".to_owned(),
        local_value: Some(Value::Object(local.fields.clone().into_iter().collect())),
        remote_value: Some(Value::Object(remote.fields.clone().into_iter().collect())),
        base_value: None,
    });
    plan.summary.conflicts += 1;
}

fn index_entities(entities: &[SyncEntity]) -> HashMap<EntityKey, &SyncEntity> {
    entities
        .iter()
        .map(|entity| {
            (
                EntityKey {
                    id: entity.id,
                    kind: entity.kind,
                },
                entity,
            )
        })
        .collect()
}

fn set_field(fields: &mut BTreeMap<String, Value>, name: &str, value: Option<Value>) {
    match value {
        Some(value) => {
            fields.insert(name.to_owned(), value);
        }
        None => {
            fields.remove(name);
        }
    }
}

fn update_field(
    entity: &SyncEntity,
    conflict: &SyncFieldConflict,
    value: Option<Value>,
) -> SyncEntity {
    let mut updated = entity.clone();
    if conflict.field_name == "__entity__" {
        match value {
            Some(Value::Object(fields)) => {
                updated.fields = fields.into_iter().collect();
                updated.deleted = false;
            }
            None => {
                updated.deleted = true;
            }
            Some(_) => {}
        }
    } else {
        set_field(&mut updated.fields, &conflict.field_name, value);
    }
    updated
}

fn append_conflict_copy_suffix(entity: &mut SyncEntity) {
    for field_name in ["title", "name"] {
        if let Some(Value::String(value)) = entity.fields.get_mut(field_name) {
            if !value.ends_with(CONFLICT_COPY_SUFFIX) {
                value.push_str(CONFLICT_COPY_SUFFIX);
            }
            return;
        }
    }
}
