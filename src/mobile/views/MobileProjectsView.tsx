import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import type { ProjectDto } from "../../features/projects/projectTypes";
import type { TaskSummaryDto } from "../../features/tasks/taskTypes";
import { getCommandErrorMessageKey } from "../../features/tasks/taskTypes";
import { isTranslationKey, t } from "../../i18n";
import "./mobileProjectsView.css";

interface MobileProjectsViewProps {
  projects: readonly ProjectDto[];
  selectedProjectId: string | null;
  tasks: readonly TaskSummaryDto[];
  isLoading: boolean;
  errorMessageKey: string | null;
  onCreateProject: (name: string) => Promise<ProjectDto>;
  onSelectProject: (projectId: string) => void;
}

export default function MobileProjectsView({
  errorMessageKey,
  isLoading,
  onSelectProject,
  onCreateProject,
  projects,
  selectedProjectId,
  tasks,
}: MobileProjectsViewProps) {
  const [name, setName] = useState("");
  const [mutationErrorKey, setMutationErrorKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || isCreating || isLoading) {
      setMutationErrorKey("errors.project.name.blank");
      return;
    }

    setIsCreating(true);
    setMutationErrorKey(null);
    try {
      const project = await onCreateProject(trimmedName);
      setName("");
      onSelectProject(project.id);
    } catch (error: unknown) {
      setMutationErrorKey(getCommandErrorMessageKey(error));
    } finally {
      setIsCreating(false);
    }
  }

  if (errorMessageKey) {
    return (
      <p role="alert">
        {isTranslationKey(errorMessageKey) ? t(errorMessageKey) : t("errors.unknown")}
      </p>
    );
  }
  return (
    <section
      aria-label={t("projects.title")}
      className="mobile-projects"
      data-testid="mobile-projects-view"
    >
      <form aria-busy={isCreating} className="mobile-projects__create" onSubmit={handleCreate}>
        <label className="sr-only" htmlFor="mobile-project-name">
          {t("project.name")}
        </label>
        <input
          disabled={isCreating || isLoading}
          id="mobile-project-name"
          onChange={(event) => setName(event.target.value)}
          placeholder={t("projects.create.placeholder")}
          value={name}
        />
        <button
          aria-label={t("project.create")}
          disabled={isCreating || isLoading}
          title={t("project.create")}
          type="submit"
        >
          <Plus aria-hidden="true" size={17} />
        </button>
      </form>
      {mutationErrorKey ? (
        <p className="mobile-projects__error" role="alert">
          {isTranslationKey(mutationErrorKey) ? t(mutationErrorKey) : t("errors.unknown")}
        </p>
      ) : null}
      <ul className="mobile-projects__list">
        {projects.map((project) => (
          <li key={project.id}>
            <button
              aria-pressed={selectedProjectId === project.id}
              onClick={() => onSelectProject(project.id)}
              type="button"
            >
              {project.name}
            </button>
          </li>
        ))}
      </ul>
      {isLoading ? <p role="status">{t("tasks.loading")}</p> : null}
      {!isLoading && selectedProjectId && tasks.length === 0 ? (
        <p role="status">{t("tasks.view.empty")}</p>
      ) : null}
      <ul aria-label={t("tasks.inbox")} className="mobile-projects__tasks">
        {tasks.map((task) => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ul>
    </section>
  );
}
