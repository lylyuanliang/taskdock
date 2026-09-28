import { FileText } from "lucide-react";
import { useState } from "react";
import { isTranslationKey, t } from "../../i18n";
import type { TaskDto } from "../../features/tasks/taskTypes";
import { getMobileVisualState, type MobileVisualState } from "../mobileStates";
import "./mobileTaskViews.css";

interface MobileTodayViewProps {
  tasks: readonly TaskDto[];
  completedTasks: readonly TaskDto[];
  isLoading: boolean;
  errorMessageKey: string | null;
  visualState?: MobileVisualState;
  onOpenTask: (task: TaskDto) => void;
  onToggleCompleted: (task: TaskDto) => void;
  onCreateTask: () => void;
  viewLabel?: string;
}

function taskMeta(task: TaskDto): string {
  return task.projectId ? t("task.project.assigned") : t("task.project.none");
}

function priorityLabel(priority: TaskDto["priority"]): string {
  switch (priority) {
    case "Low":
      return t("task.priority.low");
    case "Normal":
      return t("task.priority.normal");
    case "High":
      return t("task.priority.high");
  }
}

function MobileTaskRow({
  task,
  onOpenTask,
  onToggleCompleted,
}: Pick<MobileTodayViewProps, "onOpenTask" | "onToggleCompleted"> & { task: TaskDto }) {
  const completed = task.completedAt !== null;
  return (
    <li className="mobile-today__row">
      <input
        aria-label={completed ? t("task.restore") : t("task.complete")}
        checked={completed}
        onChange={() => onToggleCompleted(task)}
        type="checkbox"
      />
      <button className="mobile-today__open" onClick={() => onOpenTask(task)} type="button">
        <strong className="mobile-today__title" title={task.title}>
          {task.title}
        </strong>
        <span className="mobile-today__meta">
          <span
            className={`mobile-today__priority mobile-today__priority--${task.priority.toLowerCase()}`}
          >
            {priorityLabel(task.priority)}
          </span>
          <span>{taskMeta(task)}</span>
          {task.note ? (
            <span aria-label={t("task.note")} className="mobile-today__note">
              <FileText aria-hidden="true" size={14} />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export default function MobileTodayView({
  completedTasks,
  errorMessageKey,
  isLoading,
  onCreateTask,
  onOpenTask,
  onToggleCompleted,
  tasks,
  viewLabel = t("navigation.today"),
  visualState,
}: MobileTodayViewProps) {
  const [showCompleted, setShowCompleted] = useState(false);
  const state =
    visualState ??
    getMobileVisualState({
      hasError: Boolean(errorMessageKey),
      isEmpty: tasks.length === 0 && completedTasks.length === 0,
      isLoading,
      isLongText: tasks.some((task) => task.title.length > 80),
    });
  if (errorMessageKey)
    return (
      <p className="mobile-task-view__error" data-state={state} role="alert">
        {isTranslationKey(errorMessageKey) ? t(errorMessageKey) : t("errors.unknown")}
      </p>
    );
  if (isLoading)
    return (
      <p className="mobile-task-view__status" data-state={state} role="status">
        {t("tasks.loading")}
      </p>
    );
  return (
    <section className="mobile-today" aria-label={viewLabel} data-state={state}>
      {!tasks.length ? (
        <p className="mobile-task-view__status" role="status">
          {t("tasks.view.empty")}
        </p>
      ) : (
        <ul className="mobile-today__list">
          {tasks.map((task) => (
            <MobileTaskRow
              key={task.id}
              task={task}
              onOpenTask={onOpenTask}
              onToggleCompleted={onToggleCompleted}
            />
          ))}
        </ul>
      )}
      {completedTasks.length ? (
        <section className="mobile-today__completed">
          <button
            aria-expanded={showCompleted}
            aria-label={t("tasks.completedToday")}
            onClick={() => setShowCompleted((value) => !value)}
            type="button"
          >
            {t("tasks.completedToday")}
          </button>
          {showCompleted ? (
            <ul className="mobile-today__list">
              {completedTasks.map((task) => (
                <MobileTaskRow
                  key={task.id}
                  task={task}
                  onOpenTask={onOpenTask}
                  onToggleCompleted={onToggleCompleted}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <button className="mobile-today__create" onClick={onCreateTask} type="button">
        {t("task.add")}
      </button>
    </section>
  );
}
