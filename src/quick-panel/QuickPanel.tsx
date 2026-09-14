import {
  CheckCircle2,
  ChevronUp,
  Circle,
  GripHorizontal,
  GripVertical,
  PanelTopOpen,
  Power,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FocusEvent, FormEvent, MouseEvent, useEffect, useRef, useState } from "react";
import {
  getCommandErrorMessageKey,
  type TaskDraftInput,
  type TaskSummaryDto,
} from "../features/tasks/taskTypes";
import { isTranslationKey, t } from "../i18n";

export type QuickPanelBehavior = "hover" | "click";
export type QuickPanelMode = "collapsed" | "expanded";

interface QuickPanelProps {
  behavior: QuickPanelBehavior | null;
  errorMessageKey?: string | null;
  onComplete: (id: string) => Promise<void> | void;
  onCreate: (draft: TaskDraftInput) => Promise<void> | void;
  onModeChange: (mode: QuickPanelMode) => Promise<void> | void;
  onExitApp?: () => Promise<void> | void;
  onOpenMainWindow?: () => Promise<void> | void;
  tasks: TaskSummaryDto[];
}

const HOVER_EXPAND_DELAY_MS = 150;
const HOVER_COLLAPSE_DELAY_MS = 220;

function translateErrorMessage(messageKey: string): string {
  return isTranslationKey(messageKey) ? t(messageKey) : t("errors.unknown");
}

export function QuickPanel({
  behavior,
  errorMessageKey,
  onComplete,
  onCreate,
  onModeChange,
  onExitApp,
  onOpenMainWindow,
  tasks,
}: QuickPanelProps) {
  const [completedPendingIds, setCompletedPendingIds] = useState<Set<string>>(new Set());
  const [createPending, setCreatePending] = useState(false);
  const [localErrorMessageKey, setLocalErrorMessageKey] = useState<string | null>(null);
  const [mode, setMode] = useState<QuickPanelMode>("collapsed");
  const [modePending, setModePending] = useState(false);
  const [title, setTitle] = useState("");
  const completedPendingIdsRef = useRef<Set<string>>(new Set());
  const createPendingRef = useRef(false);
  const focusWithinRef = useRef(false);
  const modePendingRef = useRef(false);
  const pointerWithinRef = useRef(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const openTasks = tasks.filter((task) => !task.completed);

  useEffect(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [behavior]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  function clearScheduledModeChange() {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  async function requestMode(nextMode: QuickPanelMode) {
    clearScheduledModeChange();
    if (modePendingRef.current || nextMode === mode) {
      return;
    }

    modePendingRef.current = true;
    setModePending(true);
    setLocalErrorMessageKey(null);

    try {
      await onModeChange(nextMode);
      setMode(nextMode);
    } catch (error: unknown) {
      setLocalErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      modePendingRef.current = false;
      setModePending(false);
    }
  }

  function scheduleModeChange(nextMode: QuickPanelMode, delay: number) {
    clearScheduledModeChange();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      void requestMode(nextMode);
    }, delay);
  }

  function handlePointerEnter() {
    pointerWithinRef.current = true;
    if (behavior === "hover") {
      scheduleModeChange("expanded", HOVER_EXPAND_DELAY_MS);
    }
  }

  function handlePointerLeave() {
    pointerWithinRef.current = false;
    if (behavior === "hover" && !focusWithinRef.current) {
      scheduleModeChange("collapsed", HOVER_COLLAPSE_DELAY_MS);
    }
  }

  function handleFocusCapture() {
    focusWithinRef.current = true;
    clearScheduledModeChange();
    if (behavior === "hover" && mode === "collapsed") {
      void requestMode("expanded");
    }
  }

  function handleBlurCapture(event: FocusEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && sectionRef.current?.contains(nextTarget)) {
      return;
    }

    focusWithinRef.current = false;
    if (behavior === "hover" && !pointerWithinRef.current) {
      scheduleModeChange("collapsed", HOVER_COLLAPSE_DELAY_MS);
    }
  }

  function handleToggle() {
    if (behavior === "click") {
      void requestMode(mode === "collapsed" ? "expanded" : "collapsed");
    } else if (behavior === "hover" && mode === "collapsed") {
      void requestMode("expanded");
    }
  }

  function handleDragStart(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    void getCurrentWindow()
      .startDragging()
      .catch((error: unknown) => {
        setLocalErrorMessageKey(getCommandErrorMessageKey(error));
      });
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();

    if (!trimmedTitle || createPendingRef.current) {
      return;
    }

    createPendingRef.current = true;
    setCreatePending(true);
    setLocalErrorMessageKey(null);

    try {
      await onCreate({ note: "", scheduledAt: new Date().toISOString(), title: trimmedTitle });
      setTitle("");
    } catch (error: unknown) {
      setLocalErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      createPendingRef.current = false;
      setCreatePending(false);
    }
  }

  async function handleOpenMainWindow() {
    if (!onOpenMainWindow) {
      return;
    }

    setLocalErrorMessageKey(null);

    try {
      await onOpenMainWindow();
    } catch (error: unknown) {
      setLocalErrorMessageKey(getCommandErrorMessageKey(error));
    }
  }

  async function handleExitApp() {
    if (!onExitApp) {
      return;
    }

    setLocalErrorMessageKey(null);

    try {
      await onExitApp();
    } catch (error: unknown) {
      setLocalErrorMessageKey(getCommandErrorMessageKey(error));
    }
  }

  async function handleComplete(id: string) {
    if (completedPendingIdsRef.current.has(id)) {
      return;
    }

    completedPendingIdsRef.current.add(id);
    setCompletedPendingIds(new Set(completedPendingIdsRef.current));
    setLocalErrorMessageKey(null);

    try {
      await onComplete(id);
    } catch (error: unknown) {
      setLocalErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      completedPendingIdsRef.current.delete(id);
      setCompletedPendingIds(new Set(completedPendingIdsRef.current));
    }
  }

  const isExpanded = mode === "expanded";
  const toggleLabel = isExpanded ? t("quickPanel.collapse") : t("quickPanel.open");
  const displayedErrorMessageKey = localErrorMessageKey ?? errorMessageKey;

  return (
    <section
      aria-label={t("quickPanel.label")}
      className={`quick-panel quick-panel--${mode}`}
      onBlurCapture={handleBlurCapture}
      onFocusCapture={handleFocusCapture}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      ref={sectionRef}
    >
      {!isExpanded ? (
        <div
          aria-label={t("quickPanel.move")}
          className="quick-panel__drag-handle"
          onMouseDown={handleDragStart}
          title={t("quickPanel.move")}
        >
          <GripVertical aria-hidden="true" size={12} strokeWidth={1.75} />
        </div>
      ) : null}
      <button
        aria-label={toggleLabel}
        className="quick-panel__toggle"
        disabled={behavior === null || modePending}
        onClick={handleToggle}
        title={toggleLabel}
        type="button"
      >
        {isExpanded ? (
          <ChevronUp aria-hidden="true" size={20} strokeWidth={1.75} />
        ) : (
          <CheckCircle2 aria-hidden="true" size={20} strokeWidth={1.75} />
        )}
      </button>
      {displayedErrorMessageKey ? (
        <p className="quick-panel__error" role="alert">
          {translateErrorMessage(displayedErrorMessageKey)}
        </p>
      ) : null}
      {isExpanded ? (
        <div className="quick-panel__content">
          <div
            aria-label={t("quickPanel.move")}
            className="quick-panel__header"
            onMouseDown={handleDragStart}
            title={t("quickPanel.move")}
          >
            <GripHorizontal aria-hidden="true" size={14} strokeWidth={1.75} />
            <span>{t("quickPanel.today")}</span>
            {onOpenMainWindow ? (
              <button
                aria-label={t("quickPanel.openMain")}
                className="quick-panel__header-action"
                onClick={() => void handleOpenMainWindow()}
                onMouseDown={(event) => event.stopPropagation()}
                title={t("quickPanel.openMain")}
                type="button"
              >
                <PanelTopOpen aria-hidden="true" size={16} strokeWidth={1.75} />
              </button>
            ) : null}
            {onExitApp ? (
              <button
                aria-label={t("quickPanel.exit")}
                className="quick-panel__header-action quick-panel__header-action--exit"
                onClick={() => void handleExitApp()}
                onMouseDown={(event) => event.stopPropagation()}
                title={t("quickPanel.exit")}
                type="button"
              >
                <Power aria-hidden="true" size={16} strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
          <ul aria-label={t("quickPanel.today")} className="quick-panel__tasks">
            {openTasks.map((task) => {
              const completeLabel = `${t("task.complete")} ${task.title}`;
              const completePending = completedPendingIds.has(task.id);

              return (
                <li className="quick-panel__task" key={task.id}>
                  <button
                    aria-label={completeLabel}
                    aria-checked="false"
                    className="quick-panel__complete"
                    disabled={completePending}
                    onClick={() => void handleComplete(task.id)}
                    role="checkbox"
                    title={completeLabel}
                    type="button"
                  >
                    <Circle aria-hidden="true" size={16} strokeWidth={1.75} />
                  </button>
                  <span>{task.title}</span>
                </li>
              );
            })}
          </ul>
          <form className="quick-panel__capture" onSubmit={(event) => void handleCreate(event)}>
            <label className="quick-panel__capture-label" htmlFor="quick-panel-title">
              {t("quickPanel.add")}
            </label>
            <input
              disabled={createPending}
              id="quick-panel-title"
              name="title"
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("quickPanel.add")}
              value={title}
            />
          </form>
        </div>
      ) : null}
    </section>
  );
}
