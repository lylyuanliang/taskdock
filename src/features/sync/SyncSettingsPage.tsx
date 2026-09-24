import { Check, Cloud, LockKeyhole, Play, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  SaveSyncConfigInput,
  SyncConfigDto,
  SyncStateDto,
  TestSyncConnectionInput,
} from "../../api/sync";
import { getCommandErrorMessageKey } from "../tasks/taskTypes";
import { isTranslationKey, t, type TranslationKey } from "../../i18n";

interface SyncSettingsPageProps {
  config: SyncConfigDto | null;
  isSaving: boolean;
  state: SyncStateDto;
  onOpenConflicts: () => void;
  onOpenInitialSync: () => void;
  onPause: () => void | Promise<void>;
  onResume: () => void | Promise<void>;
  onSave: (input: SaveSyncConfigInput) => Promise<void>;
  onSyncNow: () => Promise<void>;
  onTestConnection: (input: TestSyncConnectionInput) => Promise<void>;
}

const emptyForm: SaveSyncConfigInput = {
  endpoint: "",
  remoteDirectory: "taskdock-sync",
  username: "",
  webdavPassword: "",
  encryptionPassphrase: "",
  encryptionEnabled: true,
  paused: false,
};

function statusLabel(status: SyncStateDto["status"]): string {
  const labels: Record<SyncStateDto["status"], TranslationKey> = {
    conflictsPending: "settings.status.conflictsPending",
    paused: "settings.status.paused",
    retryPending: "settings.status.retryPending",
    scanning: "settings.status.scanning",
    synced: "settings.status.synced",
    syncing: "settings.status.syncing",
    unconfigured: "settings.status.unconfigured",
  };

  return t(labels[status]);
}

export default function SyncSettingsPage({
  config,
  isSaving,
  state,
  onOpenConflicts,
  onOpenInitialSync,
  onPause,
  onResume,
  onSave,
  onSyncNow,
  onTestConnection,
}: SyncSettingsPageProps) {
  const [form, setForm] = useState<SaveSyncConfigInput>(emptyForm);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (config !== null) {
      const requestId = window.setTimeout(() => {
        setForm((current) => ({
          ...current,
          endpoint: config.endpoint,
          encryptionEnabled: config.encryptionEnabled,
          paused: config.paused,
          remoteDirectory: config.remoteDirectory,
          username: config.username,
        }));
      }, 0);

      return () => window.clearTimeout(requestId);
    }

    return undefined;
  }, [config]);

  function setField<K extends keyof SaveSyncConfigInput>(field: K, value: SaveSyncConfigInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSave() {
    setMessage(null);
    try {
      await onSave(form);
      setMessage(t("settings.saved"));
    } catch (error: unknown) {
      setMessage(getErrorMessage(error, "settings.saveFailed"));
    }
  }

  async function handleAction(
    action: () => void | Promise<void>,
    successKey: TranslationKey = "settings.actionComplete",
  ) {
    setMessage(null);
    try {
      await action();
      setMessage(t(successKey));
    } catch (error: unknown) {
      setMessage(getErrorMessage(error, "settings.actionFailed"));
    }
  }

  function getErrorMessage(error: unknown, fallbackKey: TranslationKey): string {
    const messageKey = getCommandErrorMessageKey(error);

    if (messageKey === "errors.unknown") {
      return t(fallbackKey);
    }

    return isTranslationKey(messageKey) ? t(messageKey) : t(fallbackKey);
  }

  return (
    <section aria-labelledby="sync-settings-heading" className="sync-page">
      <header className="sync-page__header">
        <div>
          <p className="sync-page__eyebrow">{t("settings.sync.eyebrow")}</p>
          <h2 id="sync-settings-heading">{t("settings.sync.title")}</h2>
          <p>{t("settings.sync.description")}</p>
        </div>
        <div className={`sync-status sync-status--${state.status}`}>
          <span aria-hidden="true" className="sync-status__dot" />
          <span>{statusLabel(state.status)}</span>
        </div>
      </header>

      <div className="sync-metrics" role="status">
        <div>
          <span>{t("settings.sync.lastSync")}</span>
          <strong>
            {state.lastSyncedAt ? new Date(state.lastSyncedAt).toLocaleString() : "--"}
          </strong>
        </div>
        <div>
          <span>{t("settings.sync.pendingUpload")}</span>
          <strong>{state.pendingUpload}</strong>
        </div>
        <div>
          <span>{t("settings.sync.conflicts")}</span>
          <strong>{state.conflicts}</strong>
        </div>
      </div>

      <div className="sync-page__grid">
        <div className="sync-card">
          <div className="sync-card__heading">
            <Cloud aria-hidden="true" size={18} />
            <div>
              <h3>{t("settings.sync.connection")}</h3>
              <p>{t("settings.sync.connectionDescription")}</p>
            </div>
          </div>
          <label>
            <span>{t("settings.sync.endpoint")}</span>
            <input
              onChange={(event) => setField("endpoint", event.target.value)}
              placeholder="https://dav.example.com/remote.php/dav/files/user"
              type="url"
              value={form.endpoint}
            />
          </label>
          <label>
            <span>{t("settings.sync.directory")}</span>
            <input
              onChange={(event) => setField("remoteDirectory", event.target.value)}
              type="text"
              value={form.remoteDirectory}
            />
          </label>
          <div className="sync-form-row">
            <label>
              <span>{t("settings.sync.username")}</span>
              <input
                onChange={(event) => setField("username", event.target.value)}
                type="text"
                value={form.username}
              />
            </label>
            <label>
              <span>{t("settings.sync.password")}</span>
              <input
                onChange={(event) => setField("webdavPassword", event.target.value)}
                type="password"
                value={form.webdavPassword}
              />
            </label>
          </div>
          <button
            className="sync-button sync-button--secondary"
            onClick={() =>
              void handleAction(
                () =>
                  onTestConnection({
                    endpoint: form.endpoint,
                    remoteDirectory: form.remoteDirectory,
                    username: form.username,
                    webdavPassword: form.webdavPassword,
                  }),
                "settings.sync.connectionSuccess",
              )
            }
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} />
            <span>{t("settings.sync.testConnection")}</span>
          </button>
        </div>

        <div className="sync-card">
          <div className="sync-card__heading">
            <LockKeyhole aria-hidden="true" size={18} />
            <div>
              <h3>{t("settings.sync.encryption")}</h3>
              <p>{t("settings.sync.encryptionDescription")}</p>
            </div>
          </div>
          <label className="sync-toggle">
            <span>
              <strong>{t("settings.sync.encryptionEnabled")}</strong>
              <small>{t("settings.sync.encryptionHint")}</small>
            </span>
            <input
              checked={form.encryptionEnabled}
              onChange={(event) => setField("encryptionEnabled", event.target.checked)}
              type="checkbox"
            />
          </label>
          <label>
            <span>{t("settings.sync.encryptionPassphrase")}</span>
            <input
              disabled={!form.encryptionEnabled}
              onChange={(event) => setField("encryptionPassphrase", event.target.value)}
              type="password"
              value={form.encryptionPassphrase}
            />
          </label>
          <div className="sync-safety-note">
            <ShieldCheck aria-hidden="true" size={16} />
            <span>{t("settings.sync.encryptionSafety")}</span>
          </div>
        </div>
      </div>

      <footer className="sync-page__footer">
        <div className="sync-page__message" role="status">
          {message}
        </div>
        <div className="sync-page__actions">
          <button
            className="sync-button sync-button--ghost"
            onClick={onOpenInitialSync}
            type="button"
          >
            <Play aria-hidden="true" size={15} />
            <span>{t("settings.initialSync")}</span>
          </button>
          <button
            className="sync-button sync-button--ghost"
            onClick={onOpenConflicts}
            type="button"
          >
            <span aria-hidden="true" className="sync-alert-icon">
              !
            </span>
            <span>{t("settings.conflicts")}</span>
          </button>
          <button
            className="sync-button sync-button--ghost"
            onClick={() => void handleAction(state.status === "paused" ? onResume : onPause)}
            type="button"
          >
            <span>{state.status === "paused" ? t("settings.resume") : t("settings.pause")}</span>
          </button>
          <button
            className="sync-button sync-button--secondary"
            onClick={() => void handleAction(onSyncNow)}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} />
            <span>{t("settings.syncNow")}</span>
          </button>
          <button
            className="sync-button sync-button--primary"
            disabled={isSaving}
            onClick={() => void handleSave()}
            type="button"
          >
            <Save aria-hidden="true" size={15} />
            <span>{t("settings.save")}</span>
          </button>
        </div>
      </footer>
      <div className="sync-page__saved-indicator" aria-hidden="true">
        <Check size={13} />
      </div>
    </section>
  );
}
