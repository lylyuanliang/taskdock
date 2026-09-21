import {
  Check,
  CheckCircle2,
  ChevronUp,
  Circle,
  FileText,
  FolderPlus,
  GripHorizontal,
  GripVertical,
  MessageSquareText,
  MessageSquarePlus,
  Minus,
  PanelTopOpen,
  Plus,
  Power,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FocusEvent, FormEvent, MouseEvent, useEffect, useCallback, useRef, useState } from "react";
import type { ProjectDto } from "../features/projects/projectTypes";
import {
  getCommandErrorMessageKey,
  type TaskDraftInput,
  type TaskEditorDto,
  type TaskPatchInput,
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
  onCreateProject?: (name: string) => Promise<ProjectDto> | ProjectDto;
  onLoadTaskEditor?: (id: string) => Promise<TaskEditorDto>;
  onModeChange: (mode: QuickPanelMode) => Promise<void> | void;
  onExitApp?: () => Promise<void> | void;
  onOpenMainWindow?: () => Promise<void> | void;
  onUpdateTask?: (id: string, patch: TaskPatchInput) => Promise<void> | void;
  projects?: ProjectDto[];
  tasks: TaskSummaryDto[];
}

const HOVER_EXPAND_DELAY_MS = 150;
const HOVER_COLLAPSE_DELAY_MS = 220;
const NO_PROJECT_ID = "__none__";
const PROJECT_COLOR_CLASSES = ["blue", "amber", "rose", "sage"] as const;

function translateErrorMessage(messageKey: string): string {
  return isTranslationKey(messageKey) ? t(messageKey) : t("errors.unknown");
}

function projectColorClass(index: number): string {
  return PROJECT_COLOR_CLASSES[index % PROJECT_COLOR_CLASSES.length];
}

function projectFilterMatches(
  task: TaskSummaryDto,
  selectedProjectId: string | null,
  projects: ProjectDto[],
) {
  if (selectedProjectId === null) {
    return true;
  }

  if (selectedProjectId === NO_PROJECT_ID) {
    return task.projectName === null;
  }

  const project = projects.find((item) => item.id === selectedProjectId);
  return project ? task.projectName === project.name : true;
}

export function QuickPanel({
  behavior,
  errorMessageKey,
  onComplete,
  onCreate,
  onCreateProject = async () => {
    throw new Error("Project creation is unavailable");
  },
  onLoadTaskEditor = async () => {
    throw new Error("Task details are unavailable");
  },
  onModeChange,
  onExitApp,
  onOpenMainWindow,
  onUpdateTask = async () => undefined,
  projects = [],
  tasks,
}: QuickPanelProps) {
  const [completedPendingIds, setCompletedPendingIds] = useState<Set<string>>(new Set());
  const [createExpanded, setCreateExpanded] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [captureNote, setCaptureNote] = useState("");
  const [captureProjectId, setCaptureProjectId] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [localErrorMessageKey, setLocalErrorMessageKey] = useState<string | null>(null);
  const [mode, setMode] = useState<QuickPanelMode>("collapsed");
  const [modePending, setModePending] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteLoadingTaskId, setNoteLoadingTaskId] = useState<string | null>(null);
  const [noteSavingTaskId, setNoteSavingTaskId] = useState<string | null>(null);
  const [openNoteTaskId, setOpenNoteTaskId] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [titleSavingTaskId, setTitleSavingTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const completedPendingIdsRef = useRef<Set<string>>(new Set());
  const createPendingRef = useRef(false);
  const focusWithinRef = useRef(false);
  const modePendingRef = useRef(false);
  const pointerWithinRef = useRef(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const noteSavingRef = useRef(false);
  const titleSavingRef = useRef(false);
  const matchingTasks = tasks.filter(
    (task) => !task.completed && projectFilterMatches(task, selectedProjectId, projects),
  );
  const completedTasks = tasks.filter(
    (task) => task.completed && projectFilterMatches(task, selectedProjectId, projects),
  );
  const visibleTasks = [...matchingTasks, ...completedTasks];
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const activeProjectName =
    selectedProjectId === NO_PROJECT_ID
      ? t("task.project.none")
      : (selectedProject?.name ?? t("quickPanel.allProjects"));
  const displayedErrorMessageKey = localErrorMessageKey ?? errorMessageKey;

  const saveAndCloseNote = useCallback(async () => {
    const taskId = openNoteTaskId;
    if (!taskId || noteSavingRef.current) {
      return;
    }

    noteSavingRef.current = true;
    setNoteSavingTaskId(taskId);
    setLocalErrorMessageKey(null);
    try {
      await onUpdateTask(taskId, { note: noteDrafts[taskId] ?? "" });
      setOpenNoteTaskId(null);
    } catch (error: unknown) {
      setLocalErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      noteSavingRef.current = false;
      setNoteSavingTaskId(null);
    }
  }, [noteDrafts, onUpdateTask, openNoteTaskId]);

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

  useEffect(() => {
    if (openNoteTaskId === null) {
      return undefined;
    }

    function handleDocumentPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.closest(".quick-panel__note-popover, .quick-panel__note-trigger")) {
        return;
      }

      void saveAndCloseNote();
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        void saveAndCloseNote();
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [openNoteTaskId, noteDrafts, saveAndCloseNote]);

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
      setLocalErrorMessageKey("errors.task.title.blank");
      return;
    }

    createPendingRef.current = true;
    setCreatePending(true);
    setLocalErrorMessageKey(null);

    try {
      await onCreate({
        note: captureNote.trim(),
        projectId: captureProjectId || undefined,
        scheduledAt: new Date().toISOString(),
        title: trimmedTitle,
      });
      setTitle("");
      setCaptureNote("");
      setCaptureProjectId("");
      setCreateExpanded(false);
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

  function startTitleEditing(task: TaskSummaryDto) {
    setOpenNoteTaskId(null);
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
  }

  async function commitTitle(task: TaskSummaryDto) {
    const trimmedTitle = editingTitle.trim();
    if (titleSavingRef.current || editingTaskId !== task.id) {
      return;
    }

    if (!trimmedTitle) {
      setLocalErrorMessageKey("errors.task.title.blank");
      return;
    }

    if (trimmedTitle === task.title) {
      setEditingTaskId(null);
      return;
    }

    titleSavingRef.current = true;
    setTitleSavingTaskId(task.id);
    setLocalErrorMessageKey(null);
    try {
      await onUpdateTask(task.id, { title: trimmedTitle });
      setEditingTaskId(null);
    } catch (error: unknown) {
      setLocalErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      titleSavingRef.current = false;
      setTitleSavingTaskId(null);
    }
  }

  async function openNote(task: TaskSummaryDto) {
    if (openNoteTaskId === task.id) {
      await saveAndCloseNote();
      return;
    }

    if (openNoteTaskId !== null) {
      await saveAndCloseNote();
    }

    setOpenNoteTaskId(task.id);
    if (noteDrafts[task.id] !== undefined) {
      return;
    }

    setNoteLoadingTaskId(task.id);
    setLocalErrorMessageKey(null);
    try {
      const editor = await onLoadTaskEditor(task.id);
      setNoteDrafts((current) => ({ ...current, [task.id]: editor.task.note }));
    } catch (error: unknown) {
      setLocalErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      setNoteLoadingTaskId(null);
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = newProjectName.trim();
    if (!trimmedName) {
      setLocalErrorMessageKey("errors.project.name.blank");
      return;
    }

    setLocalErrorMessageKey(null);
    try {
      const project = await onCreateProject(trimmedName);
      setSelectedProjectId(project.id);
      setCaptureProjectId(project.id);
      setNewProjectName("");
      setProjectCreateOpen(false);
    } catch (error: unknown) {
      setLocalErrorMessageKey(getCommandErrorMessageKey(error));
    }
  }

  function selectProject(id: string | null) {
    setSelectedProjectId(id);
    setProjectMenuOpen(false);
    setProjectCreateOpen(false);
    setOpenNoteTaskId(null);
    setEditingTaskId(null);
  }

  const isExpanded = mode === "expanded";
  const toggleLabel = isExpanded ? t("quickPanel.collapse") : t("quickPanel.open");
  const railProjects = [
    { colorIndex: 0, id: null, name: t("quickPanel.allProjects") },
    { colorIndex: 1, id: NO_PROJECT_ID, name: t("task.project.none") },
    ...projects.map((project, index) => ({
      colorIndex: index + 2,
      id: project.id,
      name: project.name,
    })),
  ];
  const selectedRailProject =
    railProjects.find((project) => project.id === selectedProjectId) ?? railProjects[0];
  const neighboringRailProjects = railProjects
    .filter((project) => project.id !== selectedRailProject.id)
    .slice(0, 3);
  const railSlots = [
    neighboringRailProjects[0],
    selectedRailProject,
    neighboringRailProjects[1],
    neighboringRailProjects[2],
  ].filter((project): project is (typeof railProjects)[number] => project !== undefined);
  const projectOptions = [
    { colorIndex: 0, id: null, name: t("quickPanel.allProjects") },
    { colorIndex: 1, id: NO_PROJECT_ID, name: t("task.project.none") },
    ...projects.map((project, index) => ({
      colorIndex: index + 2,
      id: project.id,
      name: project.name,
    })),
  ];
  const projectTaskCount = (projectId: string | null) =>
    tasks.filter((task) => projectFilterMatches(task, projectId, projects)).length;

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
      {!isExpanded ? (
        <button
          aria-label={toggleLabel}
          className="quick-panel__toggle"
          disabled={behavior === null || modePending}
          onClick={handleToggle}
          title={toggleLabel}
          type="button"
        >
          <CheckCircle2 aria-hidden="true" size={20} strokeWidth={1.75} />
        </button>
      ) : null}
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
            <button
              aria-expanded={projectMenuOpen}
              className="quick-panel__project-heading"
              onClick={() => setProjectMenuOpen((open) => !open)}
              onMouseDown={(event) => event.stopPropagation()}
              type="button"
            >
              <span aria-hidden="true" className="quick-panel__project-dot" />
              <span>{t("quickPanel.today")}</span>
              <span className="quick-panel__project-heading-secondary">/ {activeProjectName}</span>
            </button>
            <div className="quick-panel__header-actions">
              {onOpenMainWindow ? (
                <button
                  aria-label={t("quickPanel.openMain")}
                  className="quick-panel__header-action"
                  onClick={() => void handleOpenMainWindow()}
                  onMouseDown={(event) => event.stopPropagation()}
                  title={t("quickPanel.openMain")}
                  type="button"
                >
                  <PanelTopOpen aria-hidden="true" size={14} strokeWidth={1.75} />
                </button>
              ) : null}
              <button
                aria-label={toggleLabel}
                className="quick-panel__header-action"
                disabled={behavior === null || modePending}
                onClick={handleToggle}
                onMouseDown={(event) => event.stopPropagation()}
                title={toggleLabel}
                type="button"
              >
                <ChevronUp aria-hidden="true" size={14} strokeWidth={1.75} />
              </button>
              {onExitApp ? (
                <button
                  aria-label={t("quickPanel.exit")}
                  className="quick-panel__header-action quick-panel__header-action--exit"
                  onClick={() => void handleExitApp()}
                  onMouseDown={(event) => event.stopPropagation()}
                  title={t("quickPanel.exit")}
                  type="button"
                >
                  <Power aria-hidden="true" size={14} strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          </div>

          <div aria-label={t("quickPanel.projects")} className="quick-panel__project-rail">
            {railSlots.map((project, index) => {
              const isSelected = project.id === selectedRailProject.id;

              return (
                <button
                  aria-current={isSelected ? "page" : undefined}
                  aria-expanded={projectMenuOpen}
                  aria-label={project.name}
                  className={`quick-panel__project-tab quick-panel__project-tab--${projectColorClass(project.colorIndex)} quick-panel__project-tab--rail-${index === 0 ? "top" : index === 1 ? "second" : index === 2 ? "third" : "fourth"}${isSelected ? " quick-panel__project-tab--selected" : ""}`}
                  key={project.id ?? "all"}
                  onClick={() => {
                    if (isSelected) {
                      setProjectMenuOpen(true);
                      setProjectCreateOpen(false);
                      return;
                    }

                    selectProject(project.id);
                  }}
                  title={project.name}
                  type="button"
                >
                  <span>{project.name}</span>
                </button>
              );
            })}
          </div>

          {projectMenuOpen ? (
            <div className="quick-panel__project-menu" role="dialog">
              <div className="quick-panel__project-menu-header">
                <span>{t("quickPanel.projectPicker")}</span>
                <button
                  aria-label={t("quickPanel.closeProjectPicker")}
                  className="quick-panel__icon-button"
                  onClick={() => setProjectMenuOpen(false)}
                  type="button"
                >
                  <X aria-hidden="true" size={14} />
                </button>
              </div>
              <div className="quick-panel__project-options">
                {projectOptions.map((project) => {
                  const isSelected = selectedProjectId === project.id;

                  return (
                    <button
                      aria-checked={isSelected}
                      className={isSelected ? "is-selected" : undefined}
                      key={project.id ?? "all"}
                      onClick={() => selectProject(project.id)}
                      type="button"
                    >
                      <span
                        className={`quick-panel__menu-dot quick-panel__menu-dot--${projectColorClass(project.colorIndex)}`}
                      />
                      <span className="quick-panel__project-option-name">{project.name}</span>
                      <span className="quick-panel__project-option-count">
                        {projectTaskCount(project.id)}
                      </span>
                      {isSelected ? <Check aria-hidden="true" size={13} /> : null}
                    </button>
                  );
                })}
              </div>
              {projectCreateOpen ? (
                <form
                  className="quick-panel__project-create"
                  onSubmit={(event) => void handleCreateProject(event)}
                >
                  <input
                    aria-label={t("quickPanel.projectName")}
                    onChange={(event) => setNewProjectName(event.target.value)}
                    placeholder={t("projects.create.placeholder")}
                    value={newProjectName}
                  />
                  <button aria-label={t("quickPanel.saveProject")} type="submit">
                    <Check aria-hidden="true" size={14} />
                  </button>
                </form>
              ) : (
                <button
                  className="quick-panel__project-create-trigger"
                  onClick={() => setProjectCreateOpen(true)}
                  type="button"
                >
                  <FolderPlus aria-hidden="true" size={14} />
                  {t("quickPanel.createProject")}
                </button>
              )}
            </div>
          ) : null}

          <ul aria-label={t("quickPanel.today")} className="quick-panel__tasks">
            {visibleTasks.map((task) => {
              const completeLabel = `${t("task.complete")} ${task.title}`;
              const completePending = completedPendingIds.has(task.id);
              const noteAvailable = task.hasNote === true || Boolean(noteDrafts[task.id]?.trim());
              const noteLabel = noteAvailable
                ? `${t("quickPanel.editNote")} ${task.title}`
                : `${t("quickPanel.addNote")} ${task.title}`;
              const isEditing = editingTaskId === task.id;
              const isNoteOpen = openNoteTaskId === task.id;
              const isCompleted = task.completed;

              return (
                <li
                  className={`quick-panel__task${isNoteOpen ? " quick-panel__task--note-open" : ""}${isCompleted ? " quick-panel__task--completed" : ""}`}
                  key={task.id}
                >
                  <button
                    aria-label={completeLabel}
                    aria-checked={isCompleted}
                    className="quick-panel__complete"
                    disabled={completePending || isCompleted}
                    onClick={() => void handleComplete(task.id)}
                    role="checkbox"
                    title={completeLabel}
                    type="button"
                  >
                    {isCompleted ? (
                      <CheckCircle2 aria-hidden="true" size={16} strokeWidth={1.75} />
                    ) : (
                      <Circle aria-hidden="true" size={16} strokeWidth={1.75} />
                    )}
                  </button>
                  <div className="quick-panel__task-main">
                    {isEditing ? (
                      <input
                        aria-label={`${t("task.title")} ${task.title}`}
                        autoFocus
                        className="quick-panel__title-input"
                        disabled={titleSavingTaskId === task.id}
                        onBlur={() => void commitTitle(task)}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitTitle(task);
                          }
                          if (event.key === "Escape") {
                            setEditingTaskId(null);
                          }
                        }}
                        value={editingTitle}
                      />
                    ) : (
                      <button
                        className="quick-panel__title-button"
                        onClick={() => startTitleEditing(task)}
                        title={task.title}
                        type="button"
                      >
                        {task.title}
                      </button>
                    )}
                  </div>
                  <button
                    aria-expanded={isNoteOpen}
                    aria-label={noteLabel}
                    className={`quick-panel__note-trigger${noteAvailable ? " quick-panel__note-trigger--has-note" : ""}`}
                    onClick={() => void openNote(task)}
                    title={noteAvailable ? t("quickPanel.editNote") : t("quickPanel.addNote")}
                    type="button"
                  >
                    {noteLoadingTaskId === task.id ? (
                      <FileText aria-hidden="true" size={14} />
                    ) : noteAvailable ? (
                      <MessageSquareText aria-hidden="true" size={14} />
                    ) : (
                      <MessageSquarePlus aria-hidden="true" size={14} />
                    )}
                  </button>
                  {isNoteOpen ? (
                    <div
                      aria-label={`${t("quickPanel.noteEditing")} ${task.title}`}
                      className="quick-panel__note-popover"
                      role="dialog"
                    >
                      <div className="quick-panel__note-popover-header">
                        <span>{t("quickPanel.noteEditing")}</span>
                        <span className="quick-panel__note-status">
                          {t("quickPanel.noteAutoSave")}
                        </span>
                      </div>
                      <textarea
                        aria-label={`${t("task.note")} ${task.title}`}
                        autoFocus
                        disabled={noteLoadingTaskId === task.id || noteSavingTaskId === task.id}
                        onChange={(event) =>
                          setNoteDrafts((current) => ({
                            ...current,
                            [task.id]: event.target.value,
                          }))
                        }
                        placeholder={t("quickPanel.notePlaceholder")}
                        value={noteDrafts[task.id] ?? ""}
                      />
                      <div className="quick-panel__note-footer">
                        <span className="quick-panel__note-hint">
                          <kbd>Esc</kbd>
                          <span>{t("quickPanel.noteShortcut")}</span>
                        </span>
                        <button
                          aria-label={t("quickPanel.saveNote")}
                          className="quick-panel__note-save"
                          disabled={noteLoadingTaskId === task.id || noteSavingTaskId === task.id}
                          onClick={() => void saveAndCloseNote()}
                          type="button"
                        >
                          {t("quickPanel.saveNote")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <form
            className={`quick-panel__capture${createExpanded ? " quick-panel__capture--expanded" : ""}`}
            onSubmit={(event) => void handleCreate(event)}
          >
            <div className="quick-panel__capture-row">
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
              <button
                aria-expanded={createExpanded}
                aria-label={t("quickPanel.expandCapture")}
                className="quick-panel__capture-toggle"
                onClick={() => setCreateExpanded((expanded) => !expanded)}
                title={t("quickPanel.expandCapture")}
                type="button"
              >
                {createExpanded ? (
                  <Minus aria-hidden="true" size={16} />
                ) : (
                  <Plus aria-hidden="true" size={16} />
                )}
              </button>
            </div>
            {createExpanded ? (
              <div className="quick-panel__capture-options">
                <textarea
                  aria-label={t("quickPanel.noteForNewTask")}
                  onChange={(event) => setCaptureNote(event.target.value)}
                  placeholder={t("quickPanel.notePlaceholder")}
                  value={captureNote}
                />
                <div className="quick-panel__capture-footer">
                  <label className="quick-panel__capture-project">
                    <span aria-hidden="true" className="quick-panel__capture-project-dot" />
                    <select
                      aria-label={t("quickPanel.projectForNewTask")}
                      onChange={(event) => setCaptureProjectId(event.target.value)}
                      value={captureProjectId}
                    >
                      <option value="">{t("task.project.none")}</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="quick-panel__capture-shortcut">
                    <kbd>Enter</kbd>
                  </span>
                  <button
                    aria-label={t("quickPanel.submitTask")}
                    disabled={createPending}
                    type="submit"
                  >
                    <span>{t("quickPanel.addAction")}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </form>
        </div>
      ) : null}
    </section>
  );
}
