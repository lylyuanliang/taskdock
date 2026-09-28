import { ArrowLeft, Check, CircleAlert } from "lucide-react";
import { useState } from "react";
import type { SyncConflictDecision, SyncConflictDto } from "../../api/sync";
import { t } from "../../i18n";
import { getMobileVisualState, type MobileVisualState } from "../mobileStates";
import "./mobileSyncViews.css";

interface MobileConflictViewProps {
  conflicts: readonly SyncConflictDto[];
  onBack: () => void;
  onResolve: (conflict: SyncConflictDto, decision: SyncConflictDecision) => Promise<void>;
  onResolved?: (conflict: SyncConflictDto, decision: SyncConflictDecision) => void;
  visualState?: MobileVisualState;
}

export default function MobileConflictView({
  conflicts,
  onBack,
  onResolve,
  onResolved,
  visualState,
}: MobileConflictViewProps) {
  const [index, setIndex] = useState(0);
  const [resolvedKeys, setResolvedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const visibleConflicts = conflicts.filter((item) => !resolvedKeys.has(getConflictKey(item)));
  const visibleIndex = Math.min(index, Math.max(0, visibleConflicts.length - 1));
  const conflict = visibleConflicts[visibleIndex] ?? null;
  const state =
    visualState ??
    getMobileVisualState({
      hasConflict: visibleConflicts.length > 0,
      hasError: false,
      isEmpty: visibleConflicts.length === 0,
      isLoading: false,
    });

  async function resolve(decision: SyncConflictDecision) {
    if (!conflict) return;
    try {
      await onResolve(conflict, decision);
      setResolvedKeys((current) => {
        const next = new Set(current);
        next.add(getConflictKey(conflict));
        return next;
      });
      setIndex((current) => Math.min(current, Math.max(0, visibleConflicts.length - 2)));
      onResolved?.(conflict, decision);
      setMessage(t("settings.conflicts.resolved"));
    } catch {
      setMessage(t("errors.unknown"));
    }
  }
  return (
    <section
      className="mobile-sync mobile-conflicts"
      aria-labelledby="mobile-conflicts-title"
      data-state={state}
    >
      <button className="mobile-sync__back" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={16} />
        {t("settings.syncBack")}
      </button>
      <header className="mobile-sync__header">
        <CircleAlert aria-hidden="true" size={18} />
        <div>
          <p>{t("settings.conflicts.eyebrow")}</p>
          <h1 id="mobile-conflicts-title">{t("settings.conflicts.title")}</h1>
        </div>
        <span role="status">{visibleConflicts.length}</span>
      </header>
      {conflict ? (
        <>
          <div className="mobile-conflicts__values">
            <div>
              <span>{t("settings.conflicts.local")}</span>
              <pre>{formatValue(conflict.localValue)}</pre>
            </div>
            <div>
              <span>{t("settings.conflicts.remote")}</span>
              <pre>{formatValue(conflict.remoteValue)}</pre>
            </div>
          </div>
          <div className="mobile-conflicts__actions">
            <button onClick={() => void resolve("keepLocal")} type="button">
              <Check size={15} />
              {t("settings.conflicts.keepLocal")}
            </button>
            <button onClick={() => void resolve("acceptRemote")} type="button">
              <Check size={15} />
              {t("settings.conflicts.acceptRemote")}
            </button>
            <button onClick={() => void resolve("createConflictCopy")} type="button">
              {t("settings.conflicts.copy")}
            </button>
          </div>
          <div className="mobile-conflicts__pager">
            <button
              disabled={visibleIndex === 0}
              onClick={() => setIndex((value) => value - 1)}
              type="button"
            >
              {t("mobile.back")}
            </button>
            <span>
              {visibleIndex + 1} / {visibleConflicts.length}
            </span>
            <button
              disabled={visibleIndex >= visibleConflicts.length - 1}
              onClick={() => setIndex((value) => value + 1)}
              type="button"
            >
              {t("settings.conflicts.title")}
            </button>
          </div>
        </>
      ) : (
        <p className="mobile-sync__status" role="status">
          {t("settings.conflicts.empty")}
        </p>
      )}
      {message ? (
        <p className="mobile-sync__message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function getConflictKey(conflict: SyncConflictDto): string {
  return `${conflict.entityKind}:${conflict.entityId}:${conflict.fieldName}`;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "null");
}
