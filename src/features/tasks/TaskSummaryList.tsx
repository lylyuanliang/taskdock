import { CircleCheck, Undo2 } from "lucide-react";
import { t } from "../../i18n";
import type { TaskSummaryDto } from "./taskTypes";

interface TaskSummaryListProps {
  onToggleCompleted: (id: string, completed: boolean) => void;
  pendingTaskIds?: ReadonlySet<string>;
  readOnly?: boolean;
  tasks: TaskSummaryDto[];
}

function formatTaskTime(task: TaskSummaryDto): string {
  return task.dueAt ?? task.scheduledAt ?? "--:--";
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
          <li className="task-ledger-row task-ledger-row--summary" key={task.id}>
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
              <strong>{task.title}</strong>
              <span>{task.projectName ?? t("task.project.none")}</span>
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
