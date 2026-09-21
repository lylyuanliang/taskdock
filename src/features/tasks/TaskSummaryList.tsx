import { CircleCheck, FileText, Undo2 } from "lucide-react";
import { t } from "../../i18n";
import type { TaskSummaryDto } from "./taskTypes";

interface TaskSummaryListProps {
  onToggleCompleted: (id: string, completed: boolean) => void;
  pendingTaskIds?: ReadonlySet<string>;
  readOnly?: boolean;
  tasks: TaskSummaryDto[];
}

function formatTaskTime(task: TaskSummaryDto): string {
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

function getPriorityLabel(priority: TaskSummaryDto["priority"]): string {
  switch (priority) {
    case "Low":
      return t("task.priority.low");
    case "High":
      return t("task.priority.high");
    case "Normal":
      return t("task.priority.normal");
  }
}

function TaskSummaryList({
  onToggleCompleted,
  pendingTaskIds = new Set(),
  readOnly = false,
  tasks,
}: TaskSummaryListProps) {
  if (!tasks.length) {
    return (
      <p className="task-ledger__status" role="status">
        {t("tasks.view.empty")}
      </p>
    );
  }

  return (
    <ul aria-label={t("tasks.summary")} className="task-ledger">
      {tasks.map((task) => {
        const actionLabel = task.completed ? t("task.restore") : t("task.complete");
        const statusLabel = task.completed ? t("task.completed") : t("task.open");

        return (
          <li
            className={`task-ledger-row task-ledger-row--summary${task.completed ? " task-ledger-row--completed" : ""}`}
            data-task-id={task.id}
            data-task-priority={task.priority.toLowerCase()}
            data-task-state={task.completed ? "completed" : "open"}
            key={task.id}
          >
            {readOnly ? (
              <span className="task-ledger-row__status">{statusLabel}</span>
            ) : (
              <button
                aria-label={`${actionLabel} ${task.title}`}
                className="task-ledger-row__toggle"
                disabled={pendingTaskIds.has(task.id)}
                onClick={() => onToggleCompleted(task.id, task.completed)}
                type="button"
              >
                {task.completed ? (
                  <Undo2 aria-hidden="true" size={15} />
                ) : (
                  <CircleCheck aria-hidden="true" size={15} />
                )}
              </button>
            )}
            <div className="task-ledger-row__content">
              <div className="task-ledger-row__title">
                <strong title={task.title}>{task.title}</strong>
                {task.hasNote ? (
                  <span
                    aria-label={t("task.note")}
                    className="task-ledger-row__note"
                    title={t("task.note")}
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
                <span className="task-ledger-row__project">
                  {task.projectName ?? t("task.project.none")}
                  {task.childTotal > 0 ? ` · ${task.childCompleted}/${task.childTotal}` : ""}
                </span>
              </div>
            </div>
            <time dateTime={task.dueAt ?? task.scheduledAt ?? undefined}>
              {formatTaskTime(task)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}

export default TaskSummaryList;
