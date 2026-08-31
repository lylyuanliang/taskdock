import { FormEvent, useEffect, useState } from "react";
import { listProjects } from "../../api/projects";
import type { ProjectDto } from "../projects/projectTypes";
import { createTask, updateTask } from "../../api/tasks";
import { isTranslationKey, t } from "../../i18n";
import { getCommandErrorMessageKey, type TaskDto } from "./taskTypes";

interface TaskEditorProps {
  onSaved: () => void;
  task?: TaskDto;
}

interface TaskDraftState {
  note: string;
  projectId: string | null;
  taskId: string | null;
  title: string;
}

function translateErrorMessage(messageKey: string): string {
  return isTranslationKey(messageKey) ? t(messageKey) : t("errors.unknown");
}

function getTaskDraft(task?: TaskDto): TaskDraftState {
  return {
    note: task?.note ?? "",
    projectId: task?.projectId ?? null,
    taskId: task?.id ?? null,
    title: task?.title ?? "",
  };
}

function TaskEditor({ onSaved, task }: TaskEditorProps) {
  const selectedTaskId = task?.id ?? null;
  const [draft, setDraft] = useState<TaskDraftState>(() => getTaskDraft(task));
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectLoadErrorMessageKey, setProjectLoadErrorMessageKey] = useState<string | null>(null);
  const activeDraft = draft.taskId === selectedTaskId ? draft : getTaskDraft(task);

  useEffect(() => {
    let isCurrent = true;

    async function loadProjects() {
      try {
        const activeProjects = await listProjects();
        if (isCurrent) {
          setProjects(activeProjects);
          setProjectLoadErrorMessageKey(null);
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setProjectLoadErrorMessageKey(getCommandErrorMessageKey(error));
        }
      }
    }

    void loadProjects();

    return () => {
      isCurrent = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = activeDraft.title.trim();

    if (!trimmedTitle) {
      setErrorMessageKey("errors.task.title.required");
      return;
    }

    setIsSaving(true);
    setErrorMessageKey(null);

    try {
      if (task) {
        const patch = { title: trimmedTitle, note: activeDraft.note };
        if (activeDraft.projectId !== task.projectId) {
          await updateTask(task.id, { ...patch, projectId: activeDraft.projectId });
        } else {
          await updateTask(task.id, patch);
        }
      } else {
        await createTask({
          title: trimmedTitle,
          note: activeDraft.note,
          ...(activeDraft.projectId ? { projectId: activeDraft.projectId } : {}),
        });
        setDraft(getTaskDraft());
      }
      onSaved();
    } catch (error: unknown) {
      setErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="task-editor" onSubmit={handleSubmit}>
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
      <label className="task-editor__field" htmlFor="task-project">
        <span>{t("task.project")}</span>
        <select
          id="task-project"
          onChange={(event) => setDraft({ ...activeDraft, projectId: event.target.value || null })}
          value={activeDraft.projectId ?? ""}
        >
          <option value="">{t("task.project.none")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
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
      <button disabled={isSaving} type="submit">
        {task ? t("task.update") : t("task.save")}
      </button>
    </form>
  );
}

export default TaskEditor;
