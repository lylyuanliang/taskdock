import { ArrowLeft, CheckCircle2, CloudDownload, Database, Merge, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { SyncRunSummary, SyncStateDto, SyncStrategy } from "../../api/sync";
import { t } from "../../i18n";

interface InitialSyncPageProps {
  lastResult: SyncRunSummary | null;
  state: SyncStateDto;
  onBack: () => void;
  onStart: (strategy: SyncStrategy) => Promise<void>;
}

export default function InitialSyncPage({
  lastResult,
  state,
  onBack,
  onStart,
}: InitialSyncPageProps) {
  const [strategy, setStrategy] = useState<SyncStrategy>("smartMerge");

  const strategyOptions: Array<{
    description: string;
    label: string;
    value: SyncStrategy;
  }> = [
    {
      description: t("settings.initialSync.mergeHint"),
      label: t("settings.initialSync.merge"),
      value: "smartMerge",
    },
    {
      description: t("settings.initialSync.keepLocalHint"),
      label: t("settings.initialSync.keepLocal"),
      value: "keepLocal",
    },
    {
      description: t("settings.initialSync.keepRemoteHint"),
      label: t("settings.initialSync.keepRemote"),
      value: "keepRemote",
    },
  ];

  return (
    <section aria-labelledby="initial-sync-heading" className="sync-page sync-page--initial">
      <header className="sync-page__header">
        <div>
          <button className="sync-inline-back" onClick={onBack} type="button">
            <ArrowLeft aria-hidden="true" size={15} />
            <span>{t("settings.syncBack")}</span>
          </button>
          <p className="sync-page__eyebrow">{t("settings.initialSync.eyebrow")}</p>
          <h2 id="initial-sync-heading">{t("settings.initialSync.title")}</h2>
          <p>{t("settings.initialSync.description")}</p>
        </div>
        <div className="sync-step-indicator">
          <span className="sync-step-indicator__active">01</span>
          <span>/</span>
          <span>02</span>
        </div>
      </header>

      <div className="sync-merge-summary">
        <div className="sync-merge-summary__icon">
          <Database aria-hidden="true" size={18} />
        </div>
        <div>
          <strong>{t("settings.initialSync.localData")}</strong>
          <span>{t("settings.initialSync.localDataHint")}</span>
        </div>
        <Merge aria-hidden="true" className="sync-merge-summary__arrow" size={18} />
        <div className="sync-merge-summary__icon sync-merge-summary__icon--remote">
          <CloudDownload aria-hidden="true" size={18} />
        </div>
        <div>
          <strong>{t("settings.initialSync.remoteData")}</strong>
          <span>{t("settings.initialSync.remoteDataHint")}</span>
        </div>
      </div>

      <div className="sync-card sync-card--wide">
        <div className="sync-card__heading">
          <CheckCircle2 aria-hidden="true" size={18} />
          <div>
            <h3>{t("settings.initialSync.ready")}</h3>
            <p>{t("settings.initialSync.readyHint")}</p>
          </div>
        </div>
        <div
          aria-label={t("settings.initialSync.strategy")}
          className="sync-merge-options"
          role="radiogroup"
        >
          {strategyOptions.map((option) => (
            <button
              aria-checked={strategy === option.value}
              className={`sync-merge-option${strategy === option.value ? " sync-merge-option--active" : ""}`}
              key={option.value}
              onClick={() => setStrategy(option.value)}
              role="radio"
              type="button"
            >
              <span aria-hidden="true" className="sync-radio" />
              <span>
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="sync-safety-note sync-safety-note--amber">
          <span aria-hidden="true">!</span>
          <span>{t("settings.initialSync.warning")}</span>
        </div>
      </div>

      {lastResult ? (
        <div className="sync-result" role="status">
          <span>{t("settings.initialSync.lastResult")}</span>
          <strong>
            {lastResult.conflicts > 0
              ? t("settings.status.conflictsPending")
              : t("settings.status.synced")}
          </strong>
          <span>
            {lastResult.merged} {t("settings.initialSync.mergedItems")}
          </span>
        </div>
      ) : null}

      <footer className="sync-page__footer">
        <div className="sync-page__message">
          {state.status === "conflictsPending"
            ? t("settings.initialSync.conflictsNeedReview")
            : null}
        </div>
        <div className="sync-page__actions">
          <button className="sync-button sync-button--ghost" onClick={onBack} type="button">
            <ArrowLeft aria-hidden="true" size={15} />
            <span>{t("settings.cancel")}</span>
          </button>
          <button
            className="sync-button sync-button--primary"
            onClick={() => void onStart(strategy)}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} />
            <span>{t("settings.initialSync.start")}</span>
          </button>
        </div>
      </footer>
    </section>
  );
}
