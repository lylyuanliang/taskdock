import { useEffect, useRef, useState } from "react";
import { createTaskEditor, getTaskEditor, updateTaskEditor } from "../../api/tasks";
import { listProjects } from "../../api/projects";
import { getCommandErrorMessageKey } from "../../features/tasks/taskTypes";
import type { ProjectDto } from "../../features/projects/projectTypes";
import type { TaskEditorDto, TaskPriority } from "../../features/tasks/taskTypes";
import { isTranslationKey, t } from "../../i18n";
import { getMobileVisualState, type MobileVisualState } from "../mobileStates";
import "./mobileTaskViews.css";

interface MobileTaskEditorViewProps {
  taskId: string | null;
  mode: "create" | "edit";
  onSaved: (editor: TaskEditorDto) => void;
  onCancelled: () => void;
  onDirtyChange: (isDirty: boolean) => void;
  visualState?: MobileVisualState;
}

interface EditorValues {
  note: string;
  priority: TaskPriority;
  projectId: string | null;
  scheduledAt: string;
  tags: string;
  title: string;
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const emptyValues: EditorValues = {
  note: "",
  priority: "Normal",
  projectId: null,
  scheduledAt: "",
  tags: "",
  title: "",
};

export default function MobileTaskEditorView({
  mode,
  onCancelled,
  onDirtyChange,
  onSaved,
  taskId,
  visualState,
}: MobileTaskEditorViewProps) {
  const [editor, setEditor] = useState<TaskEditorDto | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>("Normal");
  const [scheduledAt, setScheduledAt] = useState("");
  const [tags, setTags] = useState("");
  const [baseline, setBaseline] = useState<EditorValues>(emptyValues);
  const [isSaving, setIsSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const state =
    visualState ??
    getMobileVisualState({
      hasError: Boolean(errorKey),
      isEmpty: false,
      isLoading: false,
      isLongText: title.length > 80 || note.length > 240,
    });
  const saveInFlightRef = useRef(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      listProjects(),
      taskId && mode === "edit" ? getTaskEditor(taskId) : Promise.resolve(null),
    ])
      .then(([loadedProjects, loadedEditor]) => {
        if (!active) return;
        setProjects(loadedProjects);
        setErrorKey(null);
        if (loadedEditor) {
          const loadedValues: EditorValues = {
            note: loadedEditor.task.note,
            priority: loadedEditor.task.priority,
            projectId: loadedEditor.task.projectId,
            scheduledAt: toDatetimeLocal(loadedEditor.task.scheduledAt),
            tags: loadedEditor.tagNames.join(", "),
            title: loadedEditor.task.title,
          };
          setEditor(loadedEditor);
          setTitle(loadedValues.title);
          setNote(loadedValues.note);
          setProjectId(loadedValues.projectId);
          setPriority(loadedValues.priority);
          setScheduledAt(loadedValues.scheduledAt);
          setTags(loadedValues.tags);
          setBaseline(loadedValues);
        } else {
          setEditor(null);
          setTitle(emptyValues.title);
          setNote(emptyValues.note);
          setProjectId(emptyValues.projectId);
          setPriority(emptyValues.priority);
          setScheduledAt(emptyValues.scheduledAt);
          setTags(emptyValues.tags);
          setBaseline(emptyValues);
        }
      })
      .catch((error: unknown) => {
        if (active) setErrorKey(getCommandErrorMessageKey(error));
      });
    return () => {
      active = false;
    };
  }, [mode, taskId]);
  useEffect(() => {
    onDirtyChange(
      title !== baseline.title ||
        note !== baseline.note ||
        projectId !== baseline.projectId ||
        priority !== baseline.priority ||
        scheduledAt !== baseline.scheduledAt ||
        tags !== baseline.tags,
    );
  }, [baseline, note, onDirtyChange, priority, projectId, scheduledAt, tags, title]);
  async function save(): Promise<void> {
    if (isSaving || saveInFlightRef.current || !title.trim()) {
      if (!title.trim()) setErrorKey("errors.task.title.required");
      return;
    }
    saveInFlightRef.current = true;
    setIsSaving(true);
    setErrorKey(null);
    try {
      const tagNames = tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const payload = {
        dueAt: editor?.task.dueAt ?? null,
        note,
        priority,
        projectId,
        recurrence: editor?.task.recurrence ?? null,
        scheduledAt: scheduledAt || null,
        title: title.trim(),
      };
      const result =
        mode === "edit" && taskId && editor
          ? await updateTaskEditor(taskId, editor.task.revision, payload, tagNames)
          : await createTaskEditor(payload, tagNames);
      setEditor(result);
      const savedValues: EditorValues = {
        note: result.task.note,
        priority: result.task.priority,
        projectId: result.task.projectId,
        scheduledAt: toDatetimeLocal(result.task.scheduledAt),
        tags: result.tagNames.join(", "),
        title: result.task.title,
      };
      setBaseline(savedValues);
      setTitle(savedValues.title);
      setNote(savedValues.note);
      setProjectId(savedValues.projectId);
      setPriority(savedValues.priority);
      setScheduledAt(savedValues.scheduledAt);
      setTags(savedValues.tags);
      onSaved(result);
    } catch (error: unknown) {
      setErrorKey(getCommandErrorMessageKey(error));
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }
  return (
    <form
      aria-label={t("task.edit")}
      className="mobile-editor"
      data-state={state}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {errorKey ? (
        <p className="mobile-task-view__error" role="alert">
          {isTranslationKey(errorKey) ? t(errorKey) : t("errors.unknown")}
        </p>
      ) : null}
      <label>
        {" "}
        {t("task.title")}{" "}
        <input
          aria-label={t("task.title")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        {" "}
        {t("task.note")}{" "}
        <textarea
          aria-label={t("task.note")}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <label>
        {" "}
        {t("task.project")}{" "}
        <select
          aria-label={t("task.project")}
          value={projectId ?? ""}
          onChange={(event) => setProjectId(event.target.value || null)}
        >
          <option value="">{t("task.project.none")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {" "}
        {t("task.priority")}{" "}
        <select
          aria-label={t("task.priority")}
          value={priority}
          onChange={(event) => setPriority(event.target.value as TaskPriority)}
        >
          <option value="Low">{t("task.priority.low")}</option>
          <option value="Normal">{t("task.priority.normal")}</option>
          <option value="High">{t("task.priority.high")}</option>
        </select>
      </label>
      <label>
        {" "}
        {t("task.scheduledAt")}{" "}
        <input
          aria-label={t("task.scheduledAt")}
          type="datetime-local"
          value={scheduledAt}
          onChange={(event) => setScheduledAt(event.target.value)}
        />
      </label>
      <label>
        {" "}
        {t("task.tags")}{" "}
        <input
          aria-label={t("task.tags")}
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
      </label>
      <div className="mobile-editor__actions">
        <button aria-label={t("settings.cancel")} onClick={onCancelled} type="button">
          {t("settings.cancel")}
        </button>
        <button aria-label={t("task.save")} disabled={isSaving} type="submit">
          {isSaving ? t("task.saving") : t("task.save")}
        </button>
      </div>
    </form>
  );
}
