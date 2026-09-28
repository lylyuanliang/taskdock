import { Cloud, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  SaveSyncConfigInput,
  SyncConfigDto,
  SyncFrequency,
  SyncStateDto,
  SyncStrategy,
  TestSyncConnectionInput,
} from "../../api/sync";
import { getCommandErrorMessageKey } from "../../features/tasks/taskTypes";
import { isTranslationKey, t, type TranslationKey } from "../../i18n";
import { getMobileVisualState, type MobileVisualState } from "../mobileStates";
import "./mobileSyncViews.css";

export interface MobileSyncSettingsViewProps {
  config: SyncConfigDto | null;
  state: SyncStateDto;
  isLoading: boolean;
  isSaving: boolean;
  isOnline: boolean;
  onSave: (input: SaveSyncConfigInput) => Promise<void>;
  onTestConnection: (input: TestSyncConnectionInput) => Promise<{ ok: boolean }>;
  onSyncNow: (strategy?: SyncStrategy) => Promise<void>;
  onReviewConflicts: () => void;
  visualState?: MobileVisualState;
}

const emptyForm: SaveSyncConfigInput = {
  endpoint: "",
  remoteDirectory: "taskdock-sync",
  username: "",
  webdavPassword: "",
  encryptionPassphrase: "",
  encryptionEnabled: true,
  paused: false,
  strategy: "smartMerge",
  frequency: "manual",
};

const statusKeys: Record<SyncStateDto["status"], TranslationKey> = {
  unconfigured: "settings.status.unconfigured",
  scanning: "settings.status.scanning",
  syncing: "settings.status.syncing",
  synced: "settings.status.synced",
  retryPending: "settings.status.retryPending",
  conflictsPending: "settings.status.conflictsPending",
  paused: "settings.status.paused",
};

function safeError(error: unknown): string {
  const key = getCommandErrorMessageKey(error);
  const stableByBackendKey: Record<string, TranslationKey> = {
    "errors.sync.configuration.invalid": "sync.config.invalid",
    "errors.sync.input.invalid": "sync.config.invalid",
    "errors.sync.configuration.missing": "sync.config.invalid",
    "errors.sync.remote.authentication_failed": "sync.auth.failed",
    "errors.sync.remote.network_unavailable": "sync.network.timeout",
    "errors.sync.remote.timeout": "sync.network.timeout",
    "errors.sync.remote.path_not_found": "sync.network.timeout",
    "errors.sync.remote.method_not_allowed": "sync.network.timeout",
    "errors.sync.remote.unavailable": "sync.network.timeout",
    "errors.sync.credential.failed": "sync.auth.failed",
    "errors.sync.worker.unavailable": "sync.network.timeout",
    "errors.sync.encryption.failed": "sync.encryption.failed",
    "errors.sync.snapshot.invalid": "sync.encryption.failed",
  };
  const stable = stableByBackendKey[key] ?? (key.startsWith("sync.") ? key : "errors.unknown");
  if (isTranslationKey(stable)) return t(stable);
  return t("errors.unknown");
}

export default function MobileSyncSettingsView({
  config,
  state,
  isLoading,
  isSaving,
  isOnline,
  onSave,
  onTestConnection,
  onSyncNow,
  onReviewConflicts,
  visualState,
}: MobileSyncSettingsViewProps) {
  const [form, setForm] = useState<SaveSyncConfigInput>(emptyForm);
  const [message, setMessage] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const syncPending = useRef(false);
  const testConnectionPending = useRef(false);
  const stateValue =
    visualState ??
    getMobileVisualState({
      hasConflict: state.conflicts > 0,
      hasError: state.status === "retryPending",
      isEmpty: config === null,
      isLoading,
      isOffline: !isOnline,
    });

  useEffect(() => {
    if (config) {
      const requestId = window.setTimeout(() => {
        setForm((current) => ({
          ...current,
          endpoint: config.endpoint,
          remoteDirectory: config.remoteDirectory,
          username: config.username,
          encryptionEnabled: config.encryptionEnabled,
          paused: config.paused,
          strategy: config.strategy,
          frequency: config.frequency,
        }));
      }, 0);
      return () => window.clearTimeout(requestId);
    }
    return undefined;
  }, [config]);

  function setField<K extends keyof SaveSyncConfigInput>(field: K, value: SaveSyncConfigInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setMessage(null);
    const keepsSavedWebdavPassword =
      config !== null && config.username === form.username.trim() && !form.webdavPassword;
    const keepsSavedEncryptionPassphrase =
      config !== null &&
      config.username === form.username.trim() &&
      config.encryptionEnabled &&
      form.encryptionEnabled &&
      !form.encryptionPassphrase;
    if (
      !form.endpoint.trim() ||
      !form.remoteDirectory.trim() ||
      !form.username.trim() ||
      (!form.webdavPassword && !keepsSavedWebdavPassword) ||
      (form.encryptionEnabled && !form.encryptionPassphrase && !keepsSavedEncryptionPassphrase)
    ) {
      setMessage(t("sync.config.invalid"));
      return;
    }
    try {
      await onSave(form);
      setMessage(t("settings.saved"));
    } catch (error: unknown) {
      setMessage(safeError(error));
    }
  }

  async function testConnection() {
    if (testConnectionPending.current) return;

    testConnectionPending.current = true;
    setIsTestingConnection(true);
    setMessage(null);
    try {
      const result = await onTestConnection({
        endpoint: form.endpoint,
        remoteDirectory: form.remoteDirectory,
        username: form.username,
        webdavPassword: form.webdavPassword,
      });
      setMessage(result.ok ? t("settings.sync.connectionSuccess") : t("sync.auth.failed"));
    } catch (error: unknown) {
      setMessage(safeError(error));
    } finally {
      testConnectionPending.current = false;
      setIsTestingConnection(false);
    }
  }

  async function syncNow() {
    if (syncPending.current || !isOnline) return;
    syncPending.current = true;
    setIsSyncing(true);
    setMessage(null);
    try {
      await onSyncNow(form.strategy);
      setMessage(t("settings.actionComplete"));
    } catch (error: unknown) {
      setMessage(safeError(error));
    } finally {
      syncPending.current = false;
      setIsSyncing(false);
    }
  }

  if (isLoading)
    return (
      <p className="mobile-sync__status" data-state={stateValue} role="status">
        {t("tasks.loading")}
      </p>
    );
  if (!isOnline) {
    return (
      <p
        className="mobile-sync__status mobile-sync__status--error"
        data-state={stateValue}
        role="alert"
      >
        {t("sync.network.timeout")}
      </p>
    );
  }

  return (
    <section className="mobile-sync" aria-labelledby="mobile-sync-title" data-state={stateValue}>
      <header className="mobile-sync__header">
        <Cloud aria-hidden="true" size={18} />
        <div>
          <p>{t("settings.sync.eyebrow")}</p>
          <h1 id="mobile-sync-title">{t("settings.sync.title")}</h1>
        </div>
        <span className="mobile-sync__status-dot" role="status">
          {t(statusKeys[state.status])}
        </span>
      </header>
      <button
        className="mobile-sync__primary"
        disabled={isSyncing}
        onClick={() => void syncNow()}
        type="button"
      >
        <RefreshCw aria-hidden="true" size={16} />
        {t("settings.syncNow")}
      </button>
      {state.conflicts > 0 ? (
        <div className="mobile-sync__actions">
          <button
            aria-label="Review conflicts"
            className="mobile-sync__secondary"
            onClick={onReviewConflicts}
            type="button"
          >
            {t("settings.conflicts")} ({state.conflicts})
          </button>
        </div>
      ) : null}
      <fieldset className="mobile-sync__section">
        <legend>{t("settings.sync.connection")}</legend>
        <label>
          <span>{t("settings.sync.endpoint")}</span>
          <input
            aria-label={t("settings.sync.endpoint")}
            onChange={(event) => setField("endpoint", event.target.value)}
            type="url"
            value={form.endpoint}
          />
        </label>
        <label>
          <span>{t("settings.sync.directory")}</span>
          <input
            aria-label={t("settings.sync.directory")}
            onChange={(event) => setField("remoteDirectory", event.target.value)}
            value={form.remoteDirectory}
          />
        </label>
        <label>
          <span>{t("settings.sync.username")}</span>
          <input
            aria-label={t("settings.sync.username")}
            onChange={(event) => setField("username", event.target.value)}
            value={form.username}
          />
        </label>
        <label>
          <span>{t("settings.sync.password")}</span>
          <input
            aria-label={t("settings.sync.password")}
            onChange={(event) => setField("webdavPassword", event.target.value)}
            type="password"
            value={form.webdavPassword}
          />
        </label>
        <button
          className="mobile-sync__secondary"
          disabled={isTestingConnection}
          aria-busy={isTestingConnection}
          onClick={() => void testConnection()}
          type="button"
        >
          {isTestingConnection
            ? t("settings.sync.connectionTesting")
            : t("settings.sync.testConnection")}
        </button>
      </fieldset>
      <fieldset className="mobile-sync__section">
        <legend>{t("settings.sync.strategy")}</legend>
        <select
          aria-label={t("settings.sync.strategy")}
          onChange={(event) => setField("strategy", event.target.value as SyncStrategy)}
          value={form.strategy}
        >
          <option value="smartMerge">{t("settings.sync.smartMerge")}</option>
          <option value="keepLocal">{t("settings.sync.keepLocal")}</option>
          <option value="keepRemote">{t("settings.sync.keepRemote")}</option>
        </select>
        <label>
          <span>{t("settings.sync.frequency")}</span>
          <select
            aria-label={t("settings.sync.frequency")}
            onChange={(event) => setField("frequency", event.target.value as SyncFrequency)}
            value={form.frequency}
          >
            <option value="oneMinute">{t("settings.sync.oneMinute")}</option>
            <option value="fiveMinutes">{t("settings.sync.fiveMinutes")}</option>
            <option value="fifteenMinutes">{t("settings.sync.fifteenMinutes")}</option>
            <option value="thirtyMinutes">{t("settings.sync.thirtyMinutes")}</option>
            <option value="oneHour">{t("settings.sync.oneHour")}</option>
            <option value="manual">{t("settings.sync.manual")}</option>
          </select>
        </label>
        <label className="mobile-sync__toggle">
          <span>{t("settings.sync.pauseAutomatic")}</span>
          <input
            aria-label={t("settings.sync.pauseAutomatic")}
            checked={form.paused}
            onChange={(event) => setField("paused", event.target.checked)}
            type="checkbox"
          />
        </label>
      </fieldset>
      <fieldset className="mobile-sync__section">
        <legend>
          <LockKeyhole aria-hidden="true" size={15} /> {t("settings.sync.encryption")}
        </legend>
        <label className="mobile-sync__toggle">
          <span>{t("settings.sync.encryptionEnabled")}</span>
          <input
            checked={form.encryptionEnabled}
            onChange={(event) => setField("encryptionEnabled", event.target.checked)}
            type="checkbox"
          />
        </label>
        <label>
          <span>{t("settings.sync.encryptionPassphrase")}</span>
          <input
            aria-label={t("settings.sync.encryptionPassphrase")}
            disabled={!form.encryptionEnabled}
            onChange={(event) => setField("encryptionPassphrase", event.target.value)}
            type="password"
            value={form.encryptionPassphrase}
          />
        </label>
        <p className="mobile-sync__keystore">
          <ShieldCheck aria-hidden="true" size={15} />
          {t("settings.sync.androidKeystore")}
        </p>
      </fieldset>
      <div className="mobile-sync__actions mobile-sync__actions--footer">
        <button
          className="mobile-sync__save"
          disabled={isSaving}
          onClick={() => void save()}
          type="button"
        >
          {isSaving ? t("settings.saving") : t("settings.save")}
        </button>
      </div>
      {isTestingConnection ? (
        <p
          aria-label={t("settings.sync.connectionTesting")}
          className="mobile-sync__message"
          role="status"
        >
          {t("settings.sync.connectionTesting")}
        </p>
      ) : null}
      {message ? (
        <p className="mobile-sync__message" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}

export type { SyncFrequency };
