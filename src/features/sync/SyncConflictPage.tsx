import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleAlert, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SyncConflictDecision, SyncConflictDto } from "../../api/sync";
import { t } from "../../i18n";

interface SyncConflictPageProps {
  conflicts: SyncConflictDto[];
  onBack: () => void;
  onResolve: (conflict: SyncConflictDto, decision: SyncConflictDecision) => Promise<void>;
}

export default function SyncConflictPage({ conflicts, onBack, onResolve }: SyncConflictPageProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      conflicts.filter((conflict) =>
        `${conflict.fieldName} ${conflict.entityId}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [conflicts, query],
  );
  const selected = filtered[selectedIndex] ?? null;

  async function resolve(decision: SyncConflictDecision) {
    if (selected === null) {
      return;
    }
    await onResolve(selected, decision);
    setMessage(t("settings.conflicts.resolved"));
  }

  return (
    <section aria-labelledby="sync-conflict-heading" className="sync-page sync-page--conflicts">
      <header className="sync-page__header">
        <div>
          <button className="sync-inline-back" onClick={onBack} type="button">
            <ArrowLeft aria-hidden="true" size={15} />
            <span>{t("settings.syncBack")}</span>
          </button>
          <p className="sync-page__eyebrow">{t("settings.conflicts.eyebrow")}</p>
          <h2 id="sync-conflict-heading">{t("settings.conflicts.title")}</h2>
          <p>{t("settings.conflicts.description")}</p>
        </div>
        <div className="sync-conflict-count">
          <CircleAlert aria-hidden="true" size={16} />
          {filtered.length}
        </div>
      </header>

      <div className="sync-conflict-toolbar">
        <Search aria-hidden="true" size={15} />
        <input
          aria-label={t("settings.conflicts.search")}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          placeholder={t("settings.conflicts.search")}
          type="search"
          value={query}
        />
      </div>

      <div className="sync-conflict-layout">
        <div className="sync-conflict-list" role="list">
          {filtered.length === 0 ? (
            <p className="sync-empty">{t("settings.conflicts.empty")}</p>
          ) : null}
          {filtered.map((conflict, index) => (
            <button
              className={`sync-conflict-list__item${index === selectedIndex ? " sync-conflict-list__item--active" : ""}`}
              key={`${conflict.entityId}-${conflict.fieldName}`}
              onClick={() => setSelectedIndex(index)}
              type="button"
            >
              <CircleAlert aria-hidden="true" size={15} />
              <span>
                <strong>{conflict.fieldName}</strong>
                <small>{conflict.entityId.slice(0, 8)}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="sync-conflict-detail">
          {selected ? (
            <>
              <div className="sync-conflict-detail__heading">
                <div>
                  <span>{t("settings.conflicts.field")}</span>
                  <h3>{selected.fieldName}</h3>
                </div>
                <div className="sync-conflict-detail__pager">
                  <button
                    disabled={selectedIndex === 0}
                    onClick={() => setSelectedIndex((index) => index - 1)}
                    type="button"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    {selectedIndex + 1} / {filtered.length}
                  </span>
                  <button
                    disabled={selectedIndex >= filtered.length - 1}
                    onClick={() => setSelectedIndex((index) => index + 1)}
                    type="button"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              <div className="sync-value-grid">
                <div>
                  <span>{t("settings.conflicts.local")}</span>
                  <pre>{formatValue(selected.localValue)}</pre>
                </div>
                <div>
                  <span>{t("settings.conflicts.remote")}</span>
                  <pre>{formatValue(selected.remoteValue)}</pre>
                </div>
              </div>
              <div className="sync-conflict-actions">
                <button
                  className="sync-button sync-button--ghost"
                  onClick={() => void resolve("keepLocal")}
                  type="button"
                >
                  <Check size={15} />
                  {t("settings.conflicts.keepLocal")}
                </button>
                <button
                  className="sync-button sync-button--secondary"
                  onClick={() => void resolve("acceptRemote")}
                  type="button"
                >
                  <Check size={15} />
                  {t("settings.conflicts.acceptRemote")}
                </button>
                <button
                  className="sync-button sync-button--primary"
                  onClick={() => void resolve("createConflictCopy")}
                  type="button"
                >
                  {t("settings.conflicts.copy")}
                </button>
              </div>
            </>
          ) : (
            <p className="sync-empty">{t("settings.conflicts.empty")}</p>
          )}
          <p className="sync-page__message" role="status">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2) ?? "null";
}
