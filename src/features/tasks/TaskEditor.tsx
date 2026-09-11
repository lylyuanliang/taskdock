import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { listProjects } from "../../api/projects";
import {
  completeTask,
  createSubtask,
  createTaskEditor,
  getTaskEditor,
  updateTaskEditor,
} from "../../api/tasks";
import { isTranslationKey, t } from "../../i18n";
import type { ProjectDto } from "../projects/projectTypes";
import {
  getCommandErrorMessageKey,
  type RecurrenceFrequency,
  type TaskDto,
  type TaskEditorDraftInput,
  type TaskEditorDto,
  type TaskEditorPatchInput,
  type TaskPriority,
} from "./taskTypes";

interface TaskEditorProps {
  editorRefreshVersion?: number;
  onSaved: (editor: TaskEditorDto) => void;
  task?: TaskDto;
}

interface TaskDraftState extends TaskEditorDraftInput {
  taskId: string | null;
}

const recurrenceFrequencies: readonly Exclude<RecurrenceFrequency, "yearly">[] = [
  "daily",
  "weekly",
  "monthly",
];

function isSelectableRecurrenceFrequency(
  value: string,
): value is Exclude<RecurrenceFrequency, "yearly"> {
  return recurrenceFrequencies.some((frequency) => frequency === value);
}

function translateErrorMessage(messageKey: string): string {
  return isTranslationKey(messageKey) ? t(messageKey) : t("errors.unknown");
}

function formatDatetimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function toUtcDatetime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getTaskDraft(task?: TaskDto): TaskDraftState {
  return {
    dueAt: task?.dueAt ?? null,
    note: task?.note ?? "",
    priority: task?.priority ?? "Normal",
    projectId: task?.projectId ?? null,
    recurrence: task?.recurrence ?? null,
    scheduledAt: task?.scheduledAt ?? null,
    taskId: task?.id ?? null,
    title: task?.title ?? "",
  };
}

function toEditorDraftPayload(draft: TaskDraftState): TaskEditorDraftInput {
  return {
    dueAt: draft.dueAt,
    note: draft.note,
    priority: draft.priority,
    projectId: draft.projectId,
    recurrence: draft.recurrence,
    scheduledAt: draft.scheduledAt,
    title: draft.title.trim(),
  };
}

function toEditorPatchPayload(draft: TaskDraftState, isChildTask: boolean): TaskEditorPatchInput {
  const patch: TaskEditorPatchInput = {
    dueAt: draft.dueAt,
    note: draft.note,
    priority: draft.priority,
    recurrence: draft.recurrence,
    scheduledAt: draft.scheduledAt,
    title: draft.title.trim(),
  };

  return isChildTask ? { ...patch, recurrence: null } : { ...patch, projectId: draft.projectId };
}

function normalizeTags(tags: readonly string[]): string[] {
  return tags.reduce<string[]>((normalized, tag) => {
    const trimmed = tag.trim();
    return trimmed && !normalized.includes(trimmed) ? [...normalized, trimmed] : normalized;
  }, []);
}

function hasUnsavedParentChanges(
  draft: TaskDraftState,
  editor: TaskEditorDto | null,
  tags: readonly string[],
  tagInput: string,
): boolean {
  if (!editor || draft.taskId !== editor.task.id) return false;

  const { task } = editor;
  const recurrenceMatches =
    draft.recurrence === task.recurrence ||
    (draft.recurrence !== null &&
      task.recurrence !== null &&
      draft.recurrence.count === task.recurrence.count &&
      draft.recurrence.frequency === task.recurrence.frequency &&
      draft.recurrence.interval === task.recurrence.interval &&
      draft.recurrence.until === task.recurrence.until);
  const normalizedTags = normalizeTags(tags);
  const savedTags = normalizeTags(editor.tagNames);
  const tagsMatch =
    normalizedTags.length === savedTags.length &&
    normalizedTags.every((tag, index) => tag === savedTags[index]);

  return (
    draft.dueAt !== task.dueAt ||
    draft.note !== task.note ||
    draft.priority !== task.priority ||
    draft.projectId !== task.projectId ||
    !recurrenceMatches ||
    draft.scheduledAt !== task.scheduledAt ||
    draft.title !== task.title ||
    !tagsMatch ||
    tagInput.trim() !== ""
  );
}

function hasUnsavedEditorChanges(
  draft: TaskDraftState,
  editor: TaskEditorDto | null,
  tags: readonly string[],
  tagInput: string,
  subtaskTitle: string,
): boolean {
  return hasUnsavedParentChanges(draft, editor, tags, tagInput) || subtaskTitle.trim() !== "";
}

function getRecurrenceFrequencyLabel(frequency: Exclude<RecurrenceFrequency, "yearly">): string {
  switch (frequency) {
    case "daily":
      return t("task.recurrence.daily");
    case "weekly":
      return t("task.recurrence.weekly");
    case "monthly":
      return t("task.recurrence.monthly");
  }
}

function TaskEditor({ editorRefreshVersion = 0, onSaved, task }: TaskEditorProps) {
  const selectedTaskId = task?.id ?? null;
  const [draft, setDraft] = useState<TaskDraftState>(() => getTaskDraft(task));
  const [editor, setEditor] = useState<TaskEditorDto | null>(null);
  const [editorLoadErrorMessageKey, setEditorLoadErrorMessageKey] = useState<string | null>(null);
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [hasExternalChangePending, setHasExternalChangePending] = useState(false);
  const [isLoadingEditor, setIsLoadingEditor] = useState(selectedTaskId !== null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubtaskMutating, setIsSubtaskMutating] = useState(false);
  const [projectLoadErrorMessageKey, setProjectLoadErrorMessageKey] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const editorRequestRef = useRef(0);
  const editorInstanceRef = useRef(0);
  const externalMutationVersionRef = useRef(editorRefreshVersion);
  const saveInFlightRef = useRef(false);
  const saveRequestRef = useRef(0);
  const subtaskInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const activeDraft = draft.taskId === selectedTaskId ? draft : getTaskDraft(task);
  const archivedProjectId =
    activeDraft.projectId !== null &&
    !projects.some((project) => project.id === activeDraft.projectId)
      ? activeDraft.projectId
      : null;

  const isCurrentEditorInstance = useCallback((instanceToken: number): boolean => {
    return mountedRef.current && editorInstanceRef.current === instanceToken;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    async function loadProjects() {
      setIsLoadingProjects(true);
      setProjectLoadErrorMessageKey(null);
      try {
        const activeProjects = await listProjects();
        if (isCurrent) setProjects(activeProjects);
      } catch (error: unknown) {
        if (isCurrent) setProjectLoadErrorMessageKey(getCommandErrorMessageKey(error));
      } finally {
        if (isCurrent) setIsLoadingProjects(false);
      }
    }
    void loadProjects();
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    const requestId = editorRequestRef.current + 1;
    editorRequestRef.current = requestId;
    editorInstanceRef.current += 1;
    void Promise.resolve().then(() => {
      if (editorRequestRef.current !== requestId) return;
      setDraft(getTaskDraft(task));
      setEditor(null);
      setEditorLoadErrorMessageKey(null);
      setHasExternalChangePending(false);
      saveInFlightRef.current = false;
      saveRequestRef.current += 1;
      setIsSaving(false);
      subtaskInFlightRef.current = false;
      setIsSubtaskMutating(false);
      setSubtaskTitle("");
      setErrorMessageKey(null);
      setTags([]);
      setTagInput("");
      if (!selectedTaskId) {
        setIsLoadingEditor(false);
        return;
      }
      setIsLoadingEditor(true);
      void getTaskEditor(selectedTaskId)
        .then((loadedEditor) => {
          if (editorRequestRef.current !== requestId) return;
          setEditor(loadedEditor);
          setDraft(getTaskDraft(loadedEditor.task));
          setTags(normalizeTags(loadedEditor.tagNames));
        })
        .catch((error: unknown) => {
          if (editorRequestRef.current === requestId)
            setEditorLoadErrorMessageKey(getCommandErrorMessageKey(error));
        })
        .finally(() => {
          if (editorRequestRef.current === requestId) setIsLoadingEditor(false);
        });
    });
  }, [selectedTaskId, task]);

  const reloadEditor = useCallback(
    async (instanceToken?: number): Promise<TaskEditorDto | null> => {
      if (!selectedTaskId) return null;
      if (instanceToken !== undefined && !isCurrentEditorInstance(instanceToken)) return null;
      const requestId = editorRequestRef.current + 1;
      editorRequestRef.current = requestId;
      setIsLoadingEditor(true);
      setEditorLoadErrorMessageKey(null);
      try {
        const loadedEditor = await getTaskEditor(selectedTaskId);
        if (
          !mountedRef.current ||
          editorRequestRef.current !== requestId ||
          (instanceToken !== undefined && !isCurrentEditorInstance(instanceToken))
        )
          return null;
        setEditor(loadedEditor);
        setDraft(getTaskDraft(loadedEditor.task));
        setTags(normalizeTags(loadedEditor.tagNames));
        return loadedEditor;
      } catch (error: unknown) {
        if (
          mountedRef.current &&
          editorRequestRef.current === requestId &&
          (instanceToken === undefined || isCurrentEditorInstance(instanceToken))
        )
          setEditorLoadErrorMessageKey(getCommandErrorMessageKey(error));
        return null;
      } finally {
        if (
          mountedRef.current &&
          editorRequestRef.current === requestId &&
          (instanceToken === undefined || isCurrentEditorInstance(instanceToken))
        )
          setIsLoadingEditor(false);
      }
    },
    [isCurrentEditorInstance, selectedTaskId],
  );

  useEffect(() => {
    if (editorRefreshVersion === externalMutationVersionRef.current) return;

    externalMutationVersionRef.current = editorRefreshVersion;
    if (!selectedTaskId) return;

    if (isSaving || saveInFlightRef.current || isSubtaskMutating || subtaskInFlightRef.current) {
      queueMicrotask(() => {
        if (mountedRef.current) setHasExternalChangePending(true);
      });
      return;
    }

    if (hasUnsavedEditorChanges(activeDraft, editor, tags, tagInput, subtaskTitle)) {
      editorRequestRef.current += 1;
      const invalidatedRequestId = editorRequestRef.current;
      queueMicrotask(() => {
        if (mountedRef.current && editorRequestRef.current === invalidatedRequestId) {
          setIsLoadingEditor(false);
          setHasExternalChangePending(true);
        }
      });
      return;
    }

    queueMicrotask(() => {
      void reloadEditor().then((loadedEditor) => {
        if (loadedEditor) setHasExternalChangePending(false);
      });
    });
  }, [
    activeDraft,
    editor,
    editorRefreshVersion,
    isSaving,
    isSubtaskMutating,
    reloadEditor,
    selectedTaskId,
    subtaskTitle,
    tagInput,
    tags,
  ]);

  async function handleExternalRefresh(): Promise<void> {
    if (isSubtaskMutating || subtaskInFlightRef.current) return;
    const loadedEditor = await reloadEditor();

    if (loadedEditor) setHasExternalChangePending(false);
  }

  const hasUnsavedParentDraft = hasUnsavedParentChanges(activeDraft, editor, tags, tagInput);
  const isSubtaskInteractionDisabled = isSaving || isLoadingEditor || isSubtaskMutating;

  function commitTag(): void {
    const nextTags = normalizeTags([...tags, tagInput]);
    if (nextTags.length !== tags.length) setTags(nextTags);
    setTagInput("");
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTag();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      isSaving ||
      saveInFlightRef.current ||
      isSubtaskMutating ||
      subtaskInFlightRef.current ||
      (selectedTaskId !== null && !editor)
    )
      return;
    const draftPayload = toEditorDraftPayload(activeDraft);
    if (!draftPayload.title) {
      setErrorMessageKey("errors.task.title.required");
      return;
    }
    const recurrenceToSave =
      editor !== null && editor.task.parentId !== null ? null : draftPayload.recurrence;
    if (recurrenceToSave && !draftPayload.scheduledAt) {
      setErrorMessageKey("task.recurrence.scheduledRequired");
      return;
    }
    saveInFlightRef.current = true;
    const editorRequestId = editorRequestRef.current;
    const saveRequestId = saveRequestRef.current + 1;

    saveRequestRef.current = saveRequestId;
    setIsSaving(true);
    setErrorMessageKey(null);
    const tagNames = normalizeTags([...tags, tagInput]);
    try {
      let savedEditor: TaskEditorDto;
      if (selectedTaskId) {
        if (!editor) return;
        const patch = toEditorPatchPayload(activeDraft, editor.task.parentId !== null);
        savedEditor = await updateTaskEditor(selectedTaskId, editor.task.revision, patch, tagNames);
      } else {
        savedEditor = await createTaskEditor(draftPayload, tagNames);
      }
      if (
        !mountedRef.current ||
        editorRequestRef.current !== editorRequestId ||
        saveRequestRef.current !== saveRequestId
      )
        return;
      setEditor(savedEditor);
      setDraft(getTaskDraft(savedEditor.task));
      setTags(normalizeTags(savedEditor.tagNames));
      setTagInput("");
      onSaved(savedEditor);
    } catch (error: unknown) {
      if (
        !mountedRef.current ||
        editorRequestRef.current !== editorRequestId ||
        saveRequestRef.current !== saveRequestId
      )
        return;
      setErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      if (mountedRef.current && saveRequestRef.current === saveRequestId) {
        saveInFlightRef.current = false;
        setIsSaving(false);
      }
    }
  }

  async function handleCompleteSubtask(id: string): Promise<void> {
    if (hasUnsavedParentDraft) return;
    if (
      isSaving ||
      saveInFlightRef.current ||
      isLoadingEditor ||
      isSubtaskMutating ||
      subtaskInFlightRef.current
    )
      return;
    const instanceToken = editorInstanceRef.current;
    subtaskInFlightRef.current = true;
    setIsSubtaskMutating(true);
    setErrorMessageKey(null);
    try {
      await completeTask(id);
      if (!isCurrentEditorInstance(instanceToken)) return;
      const refreshedEditor = await reloadEditor(instanceToken);
      if (!refreshedEditor || !isCurrentEditorInstance(instanceToken)) return;
      onSaved(refreshedEditor);
    } catch (error: unknown) {
      if (!isCurrentEditorInstance(instanceToken)) return;
      setErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      if (isCurrentEditorInstance(instanceToken)) {
        subtaskInFlightRef.current = false;
        setIsSubtaskMutating(false);
      }
    }
  }

  async function handleCreateSubtask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const title = subtaskTitle.trim();
    if (
      !editor ||
      editor.task.parentId !== null ||
      !title ||
      hasUnsavedParentDraft ||
      isSaving ||
      saveInFlightRef.current ||
      isLoadingEditor ||
      isSubtaskMutating ||
      subtaskInFlightRef.current
    )
      return;
    const instanceToken = editorInstanceRef.current;
    subtaskInFlightRef.current = true;
    setIsSubtaskMutating(true);
    setErrorMessageKey(null);
    try {
      await createSubtask(editor.task.id, title);
      if (!isCurrentEditorInstance(instanceToken)) return;
      setSubtaskTitle("");
      const refreshedEditor = await reloadEditor(instanceToken);
      if (!refreshedEditor || !isCurrentEditorInstance(instanceToken)) return;
      onSaved(refreshedEditor);
    } catch (error: unknown) {
      if (!isCurrentEditorInstance(instanceToken)) return;
      setErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      if (isCurrentEditorInstance(instanceToken)) {
        subtaskInFlightRef.current = false;
        setIsSubtaskMutating(false);
      }
    }
  }

  const isChildTask = editor !== null && editor.task.parentId !== null;
  const recurrence = activeDraft.recurrence;
  const recurrenceValue = recurrence?.frequency ?? "none";

  return (
    <section aria-label={task ? t("task.edit") : t("task.add")} className="task-editor">
      <form onSubmit={handleSubmit}>
        <fieldset
          className="task-editor__controls"
          disabled={
            isSaving || isSubtaskMutating || isLoadingEditor || (selectedTaskId !== null && !editor)
          }
        >
          <label className="task-editor__field" htmlFor="task-title">
            <span>{t("task.title")}</span>
            <input
              id="task-title"
              name="title"
              onChange={(event) => setDraft({ ...activeDraft, title: event.target.value })}
              value={activeDraft.title}
            />
          </label>
          <label className="task-editor__field" htmlFor="task-note">
            <span>{t("task.note")}</span>
            <textarea
              id="task-note"
              name="note"
              onChange={(event) => setDraft({ ...activeDraft, note: event.target.value })}
              value={activeDraft.note}
            />
          </label>
          <div className="task-editor__grid">
            {isChildTask ? (
              <label className="task-editor__field" htmlFor="task-project">
                <span>{t("task.project")}</span>
                <input disabled id="task-project" value={t("task.project.inherited")} />
              </label>
            ) : (
              <label className="task-editor__field" htmlFor="task-project">
                <span>{t("task.project")}</span>
                <select
                  disabled={isLoadingProjects || projectLoadErrorMessageKey !== null}
                  id="task-project"
                  onChange={(event) =>
                    setDraft({ ...activeDraft, projectId: event.target.value || null })
                  }
                  value={activeDraft.projectId ?? ""}
                >
                  <option value="">{t("task.project.none")}</option>
                  {archivedProjectId ? (
                    <option disabled value={archivedProjectId}>
                      {t("task.project.archived")}
                    </option>
                  ) : null}
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="task-editor__field" htmlFor="task-priority">
              <span>{t("task.priority")}</span>
              <select
                id="task-priority"
                onChange={(event) =>
                  setDraft({ ...activeDraft, priority: event.target.value as TaskPriority })
                }
                value={activeDraft.priority}
              >
                <option value="Low">{t("task.priority.low")}</option>
                <option value="Normal">{t("task.priority.normal")}</option>
                <option value="High">{t("task.priority.high")}</option>
              </select>
            </label>
            <label className="task-editor__field" htmlFor="task-scheduled-at">
              <span>{t("task.scheduledAt")}</span>
              <input
                id="task-scheduled-at"
                onChange={(event) =>
                  setDraft({ ...activeDraft, scheduledAt: toUtcDatetime(event.target.value) })
                }
                type="datetime-local"
                value={formatDatetimeLocal(activeDraft.scheduledAt)}
              />
            </label>
            <label className="task-editor__field" htmlFor="task-due-at">
              <span>{t("task.dueAt")}</span>
              <input
                id="task-due-at"
                onChange={(event) =>
                  setDraft({ ...activeDraft, dueAt: toUtcDatetime(event.target.value) })
                }
                type="datetime-local"
                value={formatDatetimeLocal(activeDraft.dueAt)}
              />
            </label>
          </div>
          {!isChildTask ? (
            <div className="task-editor__recurrence">
              <label className="task-editor__field" htmlFor="task-recurrence">
                <span>{t("task.recurrence")}</span>
                <select
                  id="task-recurrence"
                  onChange={(event) =>
                    setDraft({
                      ...activeDraft,
                      recurrence:
                        event.target.value === "none"
                          ? null
                          : isSelectableRecurrenceFrequency(event.target.value)
                            ? {
                                count: null,
                                frequency: event.target.value,
                                interval: 1,
                                until: null,
                              }
                            : activeDraft.recurrence,
                    })
                  }
                  value={recurrenceValue}
                >
                  <option value="none">{t("task.recurrence.none")}</option>
                  {recurrenceFrequencies.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {getRecurrenceFrequencyLabel(frequency)}
                    </option>
                  ))}
                  {recurrence?.frequency === "yearly" ? (
                    <option disabled value="yearly">
                      {t("task.recurrence.yearly")}
                    </option>
                  ) : null}
                </select>
              </label>
              {recurrence ? (
                <div className="task-editor__grid task-editor__grid--recurrence">
                  <label className="task-editor__field" htmlFor="task-recurrence-interval">
                    <span>{t("task.recurrence.interval")}</span>
                    <input
                      id="task-recurrence-interval"
                      min="1"
                      onChange={(event) =>
                        setDraft({
                          ...activeDraft,
                          recurrence: {
                            ...recurrence,
                            interval: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                          },
                        })
                      }
                      type="number"
                      value={recurrence.interval}
                    />
                  </label>
                  <label className="task-editor__field" htmlFor="task-recurrence-until">
                    <span>{t("task.recurrence.until")}</span>
                    <input
                      id="task-recurrence-until"
                      onChange={(event) =>
                        setDraft({
                          ...activeDraft,
                          recurrence: { ...recurrence, until: event.target.value || null },
                        })
                      }
                      type="date"
                      value={recurrence.until ?? ""}
                    />
                  </label>
                  <label className="task-editor__field" htmlFor="task-recurrence-count">
                    <span>{t("task.recurrence.count")}</span>
                    <input
                      id="task-recurrence-count"
                      min="1"
                      onChange={(event) =>
                        setDraft({
                          ...activeDraft,
                          recurrence: {
                            ...recurrence,
                            count: event.target.value
                              ? Math.max(1, Number.parseInt(event.target.value, 10) || 1)
                              : null,
                          },
                        })
                      }
                      type="number"
                      value={recurrence.count ?? ""}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="task-editor__tags">
            <label className="task-editor__field" htmlFor="task-tags">
              <span>{t("task.tags")}</span>
              <input
                id="task-tags"
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={handleTagKeyDown}
                value={tagInput}
              />
            </label>
            {tags.length ? (
              <ul aria-label={`${t("task.tags")} list`} className="task-editor__tag-list">
                {tags.map((tag) => (
                  <li key={tag}>
                    <span>{tag}</span>
                    <button
                      aria-label={`${t("task.tag.remove")} ${tag}`}
                      onClick={() => setTags(tags.filter((currentTag) => currentTag !== tag))}
                      title={`${t("task.tag.remove")} ${tag}`}
                      type="button"
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {isLoadingProjects ? (
            <p className="task-editor__status" role="status">
              {t("task.project.loading")}
            </p>
          ) : null}
          {!isLoadingProjects && !projectLoadErrorMessageKey && projects.length === 0 ? (
            <p className="task-editor__status" role="status">
              {t("task.project.empty")}
            </p>
          ) : null}
          <button className="task-editor__submit" type="submit">
            {task ? t("task.update") : t("task.save")}
          </button>
        </fieldset>
      </form>
      {isLoadingEditor ? (
        <p className="task-editor__status" role="status">
          {t("task.editor.loading")}
        </p>
      ) : null}
      {selectedTaskId !== null && !editor && editorLoadErrorMessageKey ? (
        <button
          aria-label={t("task.editor.retry")}
          className="task-editor__retry"
          onClick={() => void reloadEditor()}
          title={t("task.editor.retry")}
          type="button"
        >
          {t("task.editor.retry")}
        </button>
      ) : null}
      {isSaving ? (
        <p className="task-editor__pending" role="status">
          {t("task.saving")}
        </p>
      ) : null}
      {hasExternalChangePending ? (
        <p className="task-editor__status" role="status">
          {t("task.editor.externalChangePending")}
          <button
            className="task-editor__retry"
            disabled={isSaving || isSubtaskMutating || isLoadingEditor}
            onClick={() => void handleExternalRefresh()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} />
            <span>{t("task.editor.refreshExternalChanges")}</span>
          </button>
        </p>
      ) : null}
      {hasUnsavedParentDraft ? (
        <p className="task-editor__status" role="status">
          {t("task.subtask.parentDraft.saveFirst")}
        </p>
      ) : null}
      {editor ? (
        <section aria-labelledby="task-subtasks-heading" className="task-editor__subtasks">
          <h2 id="task-subtasks-heading">{t("task.subtasks")}</h2>
          <ul>
            {editor.subtasks.map((subtask) => (
              <li key={subtask.id}>
                <input
                  aria-label={`${t("task.complete")} ${subtask.title}`}
                  checked={subtask.completedAt !== null}
                  disabled={
                    hasUnsavedParentDraft ||
                    isSubtaskInteractionDisabled ||
                    subtask.completedAt !== null
                  }
                  onChange={() => void handleCompleteSubtask(subtask.id)}
                  type="checkbox"
                />
                <span>{subtask.title}</span>
              </li>
            ))}
          </ul>
          {!isChildTask ? (
            <form className="task-editor__subtask-create" onSubmit={handleCreateSubtask}>
              <label className="sr-only" htmlFor="task-new-subtask">
                {t("task.subtask.new")}
              </label>
              <input
                disabled={isSubtaskInteractionDisabled}
                id="task-new-subtask"
                onChange={(event) => setSubtaskTitle(event.target.value)}
                value={subtaskTitle}
              />
              <button
                disabled={
                  hasUnsavedParentDraft || isSubtaskInteractionDisabled || !subtaskTitle.trim()
                }
                type="submit"
              >
                {t("task.subtask.add")}
              </button>
            </form>
          ) : null}
        </section>
      ) : !task ? (
        <p className="task-editor__status">{t("task.subtask.unavailable")}</p>
      ) : null}
      {projectLoadErrorMessageKey ? (
        <p className="task-editor__error" role="alert">
          {translateErrorMessage(projectLoadErrorMessageKey)}
        </p>
      ) : null}
      {errorMessageKey ? (
        <p className="task-editor__error" role="alert">
          {translateErrorMessage(errorMessageKey)}
        </p>
      ) : null}
      {editorLoadErrorMessageKey ? (
        <p className="task-editor__error" role="alert">
          {translateErrorMessage(editorLoadErrorMessageKey)}
        </p>
      ) : null}
    </section>
  );
}

export default TaskEditor;
