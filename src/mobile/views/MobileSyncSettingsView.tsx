import {
  Check,
  ChevronRight,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Radio,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
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
  onRevealPassword?: () => Promise<string | null>;
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

function formatSyncAge(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) return t("settings.sync.notSynced");

  const timestamp = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(timestamp)) return t("settings.sync.notSynced");

  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  return `${minutes} min ago`;
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
  onRevealPassword,
}: MobileSyncSettingsViewProps) {
  const [form, setForm] = useState<SaveSyncConfigInput>(emptyForm);
  const [message, setMessage] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isPasswordRevealed, setIsPasswordRevealed] = useState(false);
  const [isRevealingPassword, setIsRevealingPassword] = useState(false);
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
          webdavPassword: "",
          encryptionPassphrase: "",
          encryptionEnabled: config.encryptionEnabled,
          paused: config.paused,
          strategy: config.strategy,
          frequency: config.frequency,
        }));
        setIsPasswordRevealed(false);
      }, 0);
      return () => window.clearTimeout(requestId);
    }
    return undefined;
  }, [config]);

  function setField<K extends keyof SaveSyncConfigInput>(field: K, value: SaveSyncConfigInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const hasSavedWebdavPassword =
    config?.webdavPasswordSaved === true && config.username === form.username.trim();

  async function revealSavedPassword() {
    if (!hasSavedWebdavPassword || isRevealingPassword || onRevealPassword === undefined) {
      return;
    }

    setIsRevealingPassword(true);
    setMessage(null);
    try {
      const password = await onRevealPassword();
      if (!password) {
        setMessage(t("settings.sync.passwordUnavailable"));
        return;
      }
      setField("webdavPassword", password);
      setIsPasswordRevealed(true);
    } catch (error: unknown) {
      setMessage(safeError(error));
    } finally {
      setIsRevealingPassword(false);
    }
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

  if (isLoading) {
    return (
      <p className="mobile-sync__status" data-state={stateValue} role="status">
        {t("tasks.loading")}
      </p>
    );
  }

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

  const statusTitle =
    state.status === "synced" ? t("settings.sync.readyToSync") : t(statusKeys[state.status]);
  const statusDescription =
    state.status === "synced"
      ? t("settings.sync.localChangesUpToDate")
      : t("settings.sync.description");

  return (
    <section className="mobile-sync" aria-labelledby="mobile-sync-title" data-state={stateValue}>
      <h1 className="mobile-sync__visually-hidden" id="mobile-sync-title">
        {t("settings.sync.title")}
      </h1>
      <section
        className="mobile-sync__card mobile-sync__status-card"
        data-testid="mobile-sync-status-card"
        role="status"
      >
        <span className="mobile-sync__visually-hidden">{t(statusKeys[state.status])}</span>
        <div className="mobile-sync__status-top">
          <div className="mobile-sync__status-leading">
            <span className="mobile-sync__status-icon" aria-hidden="true">
              {state.status === "synced" ? <Check size={16} /> : <Cloud size={16} />}
            </span>
            <div>
              <strong>
                {statusTitle}
                {state.status === "synced" ? <span className="mobile-sync__status-pulse" /> : null}
              </strong>
              <p>{statusDescription}</p>
            </div>
          </div>
          <span className="mobile-sync__status-age">{formatSyncAge(state.lastSyncedAt)}</span>
        </div>
        <div className="mobile-sync__ledger">
          <span>
            <b>{t("settings.sync.buffer")}:</b> {t("settings.sync.clean")}
          </span>
          <span>
            {state.pendingUpload + state.pendingDownload} {t("settings.sync.pendingTransactions")}
          </span>
          <span className="mobile-sync__ledger-ok">{t("settings.sync.httpOk")}</span>
        </div>
      </section>
      {isTestingConnection || isSyncing || message ? (
        <p
          aria-label={
            isTestingConnection
              ? t("settings.sync.connectionTesting")
              : isSyncing
                ? t("settings.sync.syncing")
                : undefined
          }
          className="mobile-sync__message"
          role={isTestingConnection || isSyncing ? "status" : "alert"}
        >
          {isTestingConnection
            ? t("settings.sync.connectionTesting")
            : isSyncing
              ? t("settings.sync.syncing")
              : message}
        </p>
      ) : null}
      <div className="mobile-sync__primary-wrap">
        <button
          aria-busy={isSyncing}
          className="mobile-sync__primary"
          disabled={isSyncing}
          onClick={() => void syncNow()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
          {isSyncing ? t("settings.sync.syncing") : t("settings.syncNow")}
        </button>
        <p>{t("settings.sync.manualOnly")}</p>
      </div>
      {state.conflicts > 0 ? (
        <button
          aria-label={t("settings.reviewConflicts")}
          className="mobile-sync__conflict-card"
          onClick={onReviewConflicts}
          type="button"
        >
          <span className="mobile-sync__conflict-count">{state.conflicts}</span>
          <span className="mobile-sync__conflict-copy">
            <strong>{t("settings.conflicts")}</strong>
            <small>{t("sync.conflict.pending")}</small>
          </span>
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      ) : null}
      <section className="mobile-sync__section-block">
        <div className="mobile-sync__section-heading">
          <h2>{t("settings.sync.endpointLabel")}</h2>
          <span>{t("settings.sync.tls")}</span>
        </div>
        <div
          className="mobile-sync__card mobile-sync__endpoint-card"
          data-testid="mobile-sync-endpoint-card"
        >
          <label className="mobile-sync__field">
            <span>{t("settings.sync.endpoint")}</span>
            <input
              aria-label={t("settings.sync.endpoint")}
              onChange={(event) => setField("endpoint", event.target.value)}
              type="url"
              value={form.endpoint}
            />
          </label>
          <label className="mobile-sync__field">
            <span>{t("settings.sync.directory")}</span>
            <input
              aria-label={t("settings.sync.directory")}
              onChange={(event) => setField("remoteDirectory", event.target.value)}
              value={form.remoteDirectory}
            />
          </label>
          <label className="mobile-sync__field">
            <span>{t("settings.sync.username")}</span>
            <input
              aria-label={t("settings.sync.username")}
              onChange={(event) => setField("username", event.target.value)}
              value={form.username}
            />
          </label>
          <label className="mobile-sync__field mobile-sync__password-field">
            <span>
              {t("settings.sync.password")}
              <small>
                {hasSavedWebdavPassword
                  ? t("settings.sync.passwordSaved")
                  : t("settings.sync.keystoreSecured")}
              </small>
            </span>
            <div className="mobile-sync__secret-input">
              <input
                aria-label={t("settings.sync.password")}
                autoComplete="current-password"
                onChange={(event) => setField("webdavPassword", event.target.value)}
                placeholder={hasSavedWebdavPassword ? "••••••••" : undefined}
                type={isPasswordRevealed ? "text" : "password"}
                value={form.webdavPassword}
              />
              {hasSavedWebdavPassword ? (
                <button
                  aria-label={
                    isPasswordRevealed
                      ? t("settings.sync.hidePassword")
                      : t("settings.sync.showPassword")
                  }
                  className="mobile-sync__secret-toggle"
                  disabled={isRevealingPassword}
                  onClick={() => {
                    if (isPasswordRevealed) {
                      setIsPasswordRevealed(false);
                      setField("webdavPassword", "");
                    } else {
                      void revealSavedPassword();
                    }
                  }}
                  type="button"
                >
                  {isPasswordRevealed ? (
                    <EyeOff aria-hidden="true" size={16} />
                  ) : (
                    <Eye aria-hidden="true" size={16} />
                  )}
                </button>
              ) : null}
            </div>
          </label>
          <div className="mobile-sync__test-footer">
            <button
              aria-busy={isTestingConnection}
              className="mobile-sync__test-button"
              disabled={isTestingConnection}
              onClick={() => void testConnection()}
              type="button"
            >
              <Radio aria-hidden="true" size={14} />
              {isTestingConnection
                ? t("settings.sync.connectionTesting")
                : t("settings.sync.testConnection")}
            </button>
            <span>
              {isTestingConnection
                ? t("settings.sync.connectionTesting")
                : t("settings.sync.pingStatus")}
            </span>
          </div>
        </div>
      </section>
      <section className="mobile-sync__section-block">
        <div className="mobile-sync__section-heading">
          <h2>{t("settings.sync.strategyLabel")}</h2>
        </div>
        <div
          className="mobile-sync__card mobile-sync__strategy-card"
          data-testid="mobile-sync-strategy-card"
        >
          <div className="mobile-sync__segmented" role="group">
            <button
              className={form.strategy === "smartMerge" ? "is-selected" : ""}
              onClick={() => setField("strategy", "smartMerge")}
              type="button"
            >
              {t("settings.sync.smartMerge")}
            </button>
            <button
              className={form.strategy === "keepLocal" ? "is-selected" : ""}
              onClick={() => setField("strategy", "keepLocal")}
              type="button"
            >
              {t("settings.sync.keepLocal")}
            </button>
            <button
              className={form.strategy === "keepRemote" ? "is-selected" : ""}
              onClick={() => setField("strategy", "keepRemote")}
              type="button"
            >
              {t("settings.sync.keepRemote")}
            </button>
          </div>
          <select
            aria-label={t("settings.sync.strategy")}
            className="mobile-sync__visually-hidden-select"
            onChange={(event) => setField("strategy", event.target.value as SyncStrategy)}
            value={form.strategy}
          >
            <option value="smartMerge">{t("settings.sync.smartMerge")}</option>
            <option value="keepLocal">{t("settings.sync.keepLocal")}</option>
            <option value="keepRemote">{t("settings.sync.keepRemote")}</option>
          </select>
          <label className="mobile-sync__field mobile-sync__frequency">
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
          <p className="mobile-sync__hint">{t("settings.sync.strategyHint")}</p>
        </div>
      </section>
      <section className="mobile-sync__section-block">
        <div className="mobile-sync__section-heading">
          <h2>{t("settings.sync.securityLabel")}</h2>
        </div>
        <div
          className="mobile-sync__card mobile-sync__security-card"
          data-testid="mobile-sync-security-card"
        >
          <label className="mobile-sync__toggle mobile-sync__encryption-row">
            <span>
              <strong>{t("settings.sync.encryptionEnabled")}</strong>
              <small>{t("settings.sync.encryptedStorage")}</small>
            </span>
            <input
              aria-label={t("settings.sync.encryptionEnabled")}
              checked={form.encryptionEnabled}
              onChange={(event) => setField("encryptionEnabled", event.target.checked)}
              type="checkbox"
            />
          </label>
          <label className="mobile-sync__field">
            <span>{t("settings.sync.encryptionPassphrase")}</span>
            <input
              aria-label={t("settings.sync.encryptionPassphrase")}
              disabled={!form.encryptionEnabled}
              onChange={(event) => setField("encryptionPassphrase", event.target.value)}
              type="password"
              value={form.encryptionPassphrase}
            />
          </label>
          <div className="mobile-sync__key-row">
            <KeyRound aria-hidden="true" size={16} />
            <span>{t("settings.sync.manageKey")}</span>
            <ShieldCheck aria-hidden="true" size={16} />
          </div>
          <p className="mobile-sync__keystore">
            <LockKeyhole aria-hidden="true" size={15} />
            {t("settings.sync.androidKeystore")}
          </p>
        </div>
      </section>
      <div className="mobile-sync__footer-note">
        <span>{t("settings.sync.footer")}</span>
      </div>
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
    </section>
  );
}

export type { SyncFrequency };
