import { useCallback, useEffect, useState } from "react";
import {
  getSyncConfig,
  getSyncStatus,
  listSyncConflicts,
  pauseSync,
  resolveSyncConflict,
  resumeSync,
  saveSyncConfig,
  syncNow,
  testSyncConnection,
  type SaveSyncConfigInput,
  type SyncConfigDto,
  type SyncConflictDecision,
  type SyncConflictDto,
  type SyncRunSummary,
  type SyncStateDto,
  type SyncStrategy,
} from "../../api/sync";
import { t } from "../../i18n";
import InitialSyncPage from "../sync/InitialSyncPage";
import SyncConflictPage from "../sync/SyncConflictPage";
import SyncSettingsPage from "../sync/SyncSettingsPage";
import SettingsNavigation, { type SettingsSection } from "./SettingsNavigation";
import "../sync/syncPages.css";

interface SettingsWorkspaceProps {
  onBack: () => void;
}

const defaultState: SyncStateDto = {
  status: "unconfigured",
  lastSyncedAt: null,
  lastErrorCode: null,
  pendingUpload: 0,
  pendingDownload: 0,
  conflicts: 0,
  baselineSnapshotId: null,
};

export default function SettingsWorkspace({ onBack }: SettingsWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("sync");
  const [config, setConfig] = useState<SyncConfigDto | null>(null);
  const [state, setState] = useState<SyncStateDto>(defaultState);
  const [conflicts, setConflicts] = useState<SyncConflictDto[]>([]);
  const [lastResult, setLastResult] = useState<SyncRunSummary | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [nextConfig, nextState] = await Promise.all([getSyncConfig(), getSyncStatus()]);
    setConfig(nextConfig);
    setState(nextState);
    if (nextState.conflicts > 0) {
      setConflicts(await listSyncConflicts());
    } else {
      setConflicts([]);
    }
  }, []);

  useEffect(() => {
    const requestId = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(requestId);
  }, [refresh]);

  async function handleSave(input: SaveSyncConfigInput) {
    setIsSaving(true);
    try {
      const nextConfig = await saveSyncConfig(input);
      setConfig(nextConfig);
      await refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSync(strategy?: SyncStrategy) {
    const result = await syncNow(strategy);
    setLastResult(result);
    await refresh();
  }

  async function handlePause() {
    setState(await pauseSync());
  }

  async function handleResume() {
    setState(await resumeSync());
  }

  async function handleTestConnection() {
    await testSyncConnection();
  }

  async function handleResolve(conflict: SyncConflictDto, decision: SyncConflictDecision) {
    await resolveSyncConflict(conflict.entityId, conflict.entityKind, conflict.fieldName, decision);
    setConflicts((current) => current.filter((item) => item !== conflict));
    await refresh();
  }

  return (
    <div className="settings-workspace">
      <SettingsNavigation
        activeSection={activeSection}
        onBack={onBack}
        onSelect={setActiveSection}
      />
      <main className="settings-content">
        {activeSection === "sync" ? (
          <SyncSettingsPage
            config={config}
            isSaving={isSaving}
            onOpenConflicts={() => setActiveSection("conflicts")}
            onOpenInitialSync={() => setActiveSection("initial")}
            onPause={() => void handlePause()}
            onResume={() => void handleResume()}
            onSave={handleSave}
            onSyncNow={handleSync}
            onTestConnection={handleTestConnection}
            state={state}
          />
        ) : null}
        {activeSection === "initial" ? (
          <InitialSyncPage
            lastResult={lastResult}
            onBack={() => setActiveSection("sync")}
            onStart={handleSync}
            state={state}
          />
        ) : null}
        {activeSection === "conflicts" ? (
          <SyncConflictPage
            conflicts={conflicts}
            onBack={() => setActiveSection("sync")}
            onResolve={handleResolve}
          />
        ) : null}
        {!["sync", "initial", "conflicts"].includes(activeSection) ? (
          <section className="settings-placeholder">
            <p className="sync-page__eyebrow">{t("settings.eyebrow")}</p>
            <h2>{t("settings.comingSoon")}</h2>
            <p>{t("settings.comingSoonDescription")}</p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
