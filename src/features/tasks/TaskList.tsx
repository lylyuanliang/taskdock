import { FileText, Pencil } from "lucide-react";
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
  const value = task.dueAt ?? task.scheduledAt;

  if (value === null) {
    return "--:--";
  }

  if (/^\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (!value.includes("T")) {
    return new Intl.DateTimeFormat(navigator.language, {
      day: "2-digit",
      month: "short",
    }).format(date);
  }

  return new Intl.DateTimeFormat(navigator.language, {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(date);
}

function getPriorityLabel(priority: TaskDto["priority"]): string {
  switch (priority) {
    case "Low":
      return t("task.priority.low");
    case "High":
      return t("task.priority.high");
    case "Normal":
      return t("task.priority.normal");
  }
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
      {tasks.map((task) => {
        const isCompleted = task.completedAt !== null;
        const projectLabel = task.projectId ? t("task.project.assigned") : t("task.project.none");

        return (
          <li
            className={`task-ledger-row${isCompleted ? " task-ledger-row--completed" : ""}`}
            data-task-id={task.id}
            data-task-priority={task.priority.toLowerCase()}
            data-task-state={isCompleted ? "completed" : "open"}
            key={task.id}
          >
            <input
              aria-label={`${t("task.complete")} ${task.id}`}
              className="task-ledger-row__checkbox"
              checked={isCompleted}
              disabled={pendingTaskIds.has(task.id)}
              onChange={() => onToggleCompleted(task)}
              type="checkbox"
            />
            <div className="task-ledger-row__content">
              <div className="task-ledger-row__title">
                <strong title={task.title}>{task.title}</strong>
                {task.note ? (
                  <span
                    aria-label={t("task.note")}
                    className="task-ledger-row__note"
                    title={task.note}
                  >
                    <FileText aria-hidden="true" size={14} />
                  </span>
                ) : null}
              </div>
              <div className="task-ledger-row__meta">
                <span
                  className={`task-ledger-row__priority task-ledger-row__priority--${task.priority.toLowerCase()}`}
                >
                  {getPriorityLabel(task.priority)}
                </span>
                <span className="task-ledger-row__project">{projectLabel}</span>
              </div>
            </div>
            <time dateTime={task.dueAt ?? task.scheduledAt ?? undefined}>
              {formatTaskTime(task)}
            </time>
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
        );
      })}
    </ul>
  );
}

export default TaskList;
