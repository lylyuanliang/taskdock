import { FormEvent, useRef, useState } from "react";
import { Archive, Check, Pencil, Plus } from "lucide-react";
import { archiveProject, createProject, renameProject } from "../../api/projects";
import { isTranslationKey, t } from "../../i18n";
import { getCommandErrorMessageKey } from "../tasks/taskTypes";
import type { ProjectDto } from "./projectTypes";

interface ProjectListProps {
  isLoading: boolean;
  listErrorMessageKey: string | null;
  onProjectArchived: (id: string) => void;
  onProjectCreated: (project: ProjectDto) => void;
  onProjectRenamed: (project: ProjectDto) => void;
  onSelect: (id: string) => void;
  projects: readonly ProjectDto[];
  selectedProjectId: string | null;
}

function translateErrorMessage(messageKey: string): string {
  return isTranslationKey(messageKey) ? t(messageKey) : t("errors.unknown");
}

function ProjectList({
  isLoading,
  listErrorMessageKey,
  onProjectArchived,
  onProjectCreated,
  onProjectRenamed,
  onSelect,
  projects,
  selectedProjectId,
}: ProjectListProps) {
  const [name, setName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [renamedProjectName, setRenamedProjectName] = useState("");
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const mutationInFlightRef = useRef(false);
  const isCreatePending = pendingProjectId === "new";
  const isMutationPending = pendingProjectId !== null;

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading || mutationInFlightRef.current) {
      return;
    }

    mutationInFlightRef.current = true;
    setPendingProjectId("new");
    setErrorMessageKey(null);
    try {
      const project = await createProject(name);
      onProjectCreated(project);
      setName("");
    } catch (error: unknown) {
      setErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      mutationInFlightRef.current = false;
      setPendingProjectId(null);
    }
  }

  async function handleRename(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (isLoading || mutationInFlightRef.current) {
      return;
    }

    mutationInFlightRef.current = true;
    setPendingProjectId(id);
    setErrorMessageKey(null);
    try {
      const project = await renameProject(id, renamedProjectName);
      onProjectRenamed(project);
      setEditingProjectId(null);
    } catch (error: unknown) {
      setErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      mutationInFlightRef.current = false;
      setPendingProjectId(null);
    }
  }

  async function handleArchive(id: string) {
    if (isLoading || mutationInFlightRef.current) {
      return;
    }

    mutationInFlightRef.current = true;
    setPendingProjectId(id);
    setErrorMessageKey(null);
    try {
      await archiveProject(id);
      onProjectArchived(id);
      if (selectedProjectId === id) {
        setEditingProjectId(null);
      }
    } catch (error: unknown) {
      setErrorMessageKey(getCommandErrorMessageKey(error));
    } finally {
      mutationInFlightRef.current = false;
      setPendingProjectId(null);
    }
  }

  return (
    <aside
      aria-busy={isLoading || isMutationPending}
      aria-labelledby="project-list-heading"
      className="project-list"
    >
      <div className="project-list__header">
        <h2 id="project-list-heading">{t("projects.title")}</h2>
      </div>
      <form aria-busy={isCreatePending} className="project-list__create" onSubmit={handleCreate}>
        <label className="sr-only" htmlFor="project-name">
          {t("project.name")}
        </label>
        <input
          disabled={isLoading || isMutationPending}
          id="project-name"
          onChange={(event) => setName(event.target.value)}
          placeholder={t("projects.create.placeholder")}
          value={name}
        />
        <button
          aria-label={t("project.create")}
          className="project-list__action"
          disabled={isLoading || isMutationPending}
          title={t("project.create")}
          type="submit"
        >
          <Plus aria-hidden="true" size={16} />
        </button>
      </form>
      {listErrorMessageKey ? (
        <p className="task-list__error" role="alert">
          {translateErrorMessage(listErrorMessageKey)}
        </p>
      ) : null}
      {errorMessageKey ? (
        <p className="task-list__error" role="alert">
          {translateErrorMessage(errorMessageKey)}
        </p>
      ) : null}
      {isLoading ? (
        <p className="task-list__status" role="status">
          {t("projects.loading")}
        </p>
      ) : null}
      {!isLoading && projects.length === 0 ? (
        <p className="task-list__status" role="status">
          {t("projects.empty")}
        </p>
      ) : null}
      {projects.length > 0 ? (
        <ul aria-label={t("projects.title")} className="project-list__items">
          {projects.map((project) => {
            const isProjectPending = pendingProjectId === project.id;

            return (
              <li
                className={isProjectPending ? "project-list__pending" : undefined}
                key={project.id}
              >
                <button
                  aria-current={selectedProjectId === project.id ? "page" : undefined}
                  className="project-list__select"
                  disabled={isLoading || isProjectPending}
                  onClick={() => onSelect(project.id)}
                  type="button"
                >
                  <span aria-hidden="true" className="project-list__marker" />
                  <span>{project.name}</span>
                </button>
                {editingProjectId === project.id ? (
                  <form onSubmit={(event) => void handleRename(event, project.id)}>
                    <label className="sr-only" htmlFor={`project-rename-${project.id}`}>
                      {`${t("project.rename")} ${project.name}`}
                    </label>
                    <input
                      disabled={isLoading || isMutationPending}
                      id={`project-rename-${project.id}`}
                      onChange={(event) => setRenamedProjectName(event.target.value)}
                      value={renamedProjectName}
                    />
                    <button
                      aria-label={t("project.rename.save")}
                      className="project-list__action"
                      disabled={isLoading || isMutationPending}
                      title={t("project.rename.save")}
                      type="submit"
                    >
                      <Check aria-hidden="true" size={16} />
                    </button>
                  </form>
                ) : (
                  <button
                    aria-label={`${t("project.rename")} ${project.name}`}
                    className="project-list__action"
                    disabled={isLoading || isMutationPending}
                    onClick={() => {
                      setEditingProjectId(project.id);
                      setRenamedProjectName(project.name);
                    }}
                    title={`${t("project.rename")} ${project.name}`}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={15} />
                  </button>
                )}
                <button
                  aria-label={`${t("project.archive")} ${project.name}`}
                  className="project-list__action"
                  disabled={isLoading || isMutationPending}
                  onClick={() => void handleArchive(project.id)}
                  title={`${t("project.archive")} ${project.name}`}
                  type="button"
                >
                  <Archive aria-hidden="true" size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </aside>
  );
}

export default ProjectList;
