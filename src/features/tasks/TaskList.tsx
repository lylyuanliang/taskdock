import { Pencil } from "lucide-react";
import { isTranslationKey, t } from "../../i18n";
import type { TaskDto } from "./taskTypes";

interface TaskListProps {
  errorMessageKey: string | null;
  isLoading: boolean;
  onEdit: (task: TaskDto) => void;
  onToggleCompleted: (task: TaskDto) => void;
  pendingTaskIds: ReadonlySet<string>;
  tasks: readonly TaskDto[];
}

function translateErrorMessage(messageKey: string): string {
  return isTranslationKey(messageKey) ? t(messageKey) : t("errors.unknown");
}

function formatTaskTime(task: TaskDto): string {
  return task.dueAt ?? task.scheduledAt ?? "--:--";
}

function TaskList({
  errorMessageKey,
  isLoading,
  onEdit,
  onToggleCompleted,
  pendingTaskIds,
  tasks,
}: TaskListProps) {
  if (errorMessageKey) {
    return (
      <p className="task-ledger__error" role="alert">
        {translateErrorMessage(errorMessageKey)}
      </p>
    );
  }

  if (isLoading) {
    return (
      <p className="task-ledger__status" role="status">
        {t("tasks.loading")}
      </p>
    );
  }

  if (!tasks.length) {
    return (
      <p className="task-ledger__status" role="status">
        {t("tasks.empty")}
      </p>
    );
  }

  return (
    <ul aria-label={t("tasks.inbox")} className="task-ledger">
      {tasks.map((task) => (
        <li className="task-ledger-row" key={task.id}>
          <input
            aria-label={`${t("task.complete")} ${task.id}`}
            checked={task.completedAt !== null}
            disabled={pendingTaskIds.has(task.id)}
            onChange={() => onToggleCompleted(task)}
            type="checkbox"
          />
          <div className="task-ledger-row__content">
            <strong>{task.title}</strong>
            <span>{task.projectId ? t("task.project.assigned") : t("task.project.none")}</span>
          </div>
          <time dateTime={task.dueAt ?? task.scheduledAt ?? undefined}>{formatTaskTime(task)}</time>
          <button
            aria-label={`${t("task.edit")} ${task.title}`}
            className="task-ledger-row__edit"
            onClick={() => onEdit(task)}
            title={`${t("task.edit")} ${task.title}`}
            type="button"
          >
            <Pencil aria-hidden="true" size={15} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default TaskList;
