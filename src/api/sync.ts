import { invoke } from "@tauri-apps/api/core";

export type SyncStatus =
  | "unconfigured"
  | "scanning"
  | "syncing"
  | "synced"
  | "retryPending"
  | "conflictsPending"
  | "paused";

export type SyncStrategy = "smartMerge" | "keepLocal" | "keepRemote";

export type SyncFrequency =
  "oneMinute" | "fiveMinutes" | "fifteenMinutes" | "thirtyMinutes" | "oneHour" | "manual";

export interface SyncConfigDto {
  endpoint: string;
  remoteDirectory: string;
  username: string;
  encryptionEnabled: boolean;
  paused: boolean;
  strategy: SyncStrategy;
  frequency: SyncFrequency;
}

export interface SaveSyncConfigInput {
  endpoint: string;
  remoteDirectory: string;
  username: string;
  webdavPassword: string;
  encryptionPassphrase: string;
  encryptionEnabled: boolean;
  paused: boolean;
  strategy: SyncStrategy;
  frequency: SyncFrequency;
}

export interface TestSyncConnectionInput {
  endpoint: string;
  remoteDirectory: string;
  username: string;
  webdavPassword: string;
}

export interface SyncStateDto {
  status: SyncStatus;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  pendingUpload: number;
  pendingDownload: number;
  conflicts: number;
  baselineSnapshotId: string | null;
}

export type SyncEntityKind = "task" | "project" | "tag";

export interface SyncConflictDto {
  entityId: string;
  entityKind: SyncEntityKind;
  fieldName: string;
  localValue: unknown;
  remoteValue: unknown;
  baseValue: unknown;
}

export type SyncConflictDecision = "keepLocal" | "acceptRemote" | "createConflictCopy";

export interface SyncRunSummary {
  status: SyncStatus;
  localOnly: number;
  remoteOnly: number;
  merged: number;
  conflicts: number;
  uploaded: boolean;
}

export async function getSyncConfig(): Promise<SyncConfigDto | null> {
  return invoke<SyncConfigDto | null>("get_sync_config");
}

export async function saveSyncConfig(input: SaveSyncConfigInput): Promise<SyncConfigDto> {
  return invoke<SyncConfigDto>("save_sync_config", { input });
}

export async function testSyncConnection(input: TestSyncConnectionInput): Promise<{ ok: boolean }> {
  return invoke<{ ok: boolean }>("test_sync_connection", { input });
}

export async function getSyncStatus(): Promise<SyncStateDto> {
  return invoke<SyncStateDto>("get_sync_status");
}

export async function syncNow(strategy?: SyncStrategy): Promise<SyncRunSummary> {
  if (strategy) {
    return invoke<SyncRunSummary>("sync_now", { input: { strategy } });
  }
  return invoke<SyncRunSummary>("sync_now");
}

export async function pauseSync(): Promise<SyncStateDto> {
  return invoke<SyncStateDto>("pause_sync");
}

export async function resumeSync(): Promise<SyncStateDto> {
  return invoke<SyncStateDto>("resume_sync");
}

export async function listSyncConflicts(): Promise<SyncConflictDto[]> {
  return invoke<SyncConflictDto[]>("list_sync_conflicts");
}

export async function resolveSyncConflict(
  entityId: string,
  entityKind: SyncEntityKind,
  fieldName: string,
  decision: SyncConflictDecision,
): Promise<void> {
  return invoke<void>("resolve_sync_conflict", {
    input: { decision, entityId, entityKind, fieldName },
  });
}
