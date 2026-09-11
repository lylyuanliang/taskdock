import { useEffect, useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { isTranslationKey, t } from "../../i18n";
import TaskSummaryList from "../tasks/TaskSummaryList";
import type { SearchQueryState } from "./searchQueryState";

interface SearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onInputChange?: (input: string) => void;
  state?: SearchQueryState;
}

function translateErrorMessage(messageKey: string): string {
  return isTranslationKey(messageKey) ? t(messageKey) : t("errors.unknown");
}

function SearchDialog({ isOpen, onClose, onInputChange, state }: SearchDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const input = state?.input ?? "";
  const query = state?.query ?? "";
  const loadState = state?.loadState ?? { status: "idle" as const };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();

    return () => {
      openerRef.current?.focus();
    };
  }, [isOpen]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );

    if (!focusableElements?.length) {
      event.preventDefault();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="search-dialog__backdrop">
      <div
        aria-labelledby="search-dialog-title"
        aria-modal="true"
        className="search-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header className="search-dialog__header">
          <h2 id="search-dialog-title">{t("search.title")}</h2>
          <button
            aria-label={t("search.close")}
            className="search-dialog__close"
            onClick={onClose}
            title={t("search.close")}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <label className="search-dialog__field" htmlFor="search-dialog-input">
          {t("search.input")}
          <input
            autoComplete="off"
            id="search-dialog-input"
            onChange={(event) => onInputChange?.(event.target.value)}
            ref={inputRef}
            type="search"
            value={input}
          />
        </label>
        <section
          aria-busy={loadState.status === "loading" ? true : undefined}
          aria-label={t("search.results")}
          aria-live="polite"
          className="search-dialog__results"
        >
          {!query ? (
            <p className="task-list__status" role="status">
              {t("search.prompt")}
            </p>
          ) : null}
          {loadState.status === "loading" ? (
            <p className="task-list__status" role="status">
              {t("search.loading")}
            </p>
          ) : null}
          {loadState.status === "error" ? (
            <p className="task-list__error" role="alert">
              {translateErrorMessage(loadState.errorMessageKey)}
            </p>
          ) : null}
          {loadState.status === "ready" && !loadState.tasks.length ? (
            <p className="task-list__status" role="status">
              {t("search.empty")}
            </p>
          ) : null}
          {loadState.status === "ready" && loadState.tasks.length ? (
            <TaskSummaryList onToggleCompleted={() => undefined} readOnly tasks={loadState.tasks} />
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default SearchDialog;
