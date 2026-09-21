import { Check, Circle, Clock3 } from "lucide-react";
import { t } from "../../i18n";
import type { TaskSummaryDto } from "../tasks/taskTypes";
import "./CalendarTaskRail.css";

export interface CalendarTaskRailProps {
  errorMessage?: string | null;
  isLoading?: boolean;
  selectedDate: string | null;
  tasks: readonly TaskSummaryDto[];
}

function formatSelectedDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat(navigator.language, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(date);
}

function formatTaskTime(task: TaskSummaryDto): string {
  const value = task.scheduledAt ?? task.dueAt;
  if (!value) {
    return "--:--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return new Intl.DateTimeFormat(navigator.language, {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(date);
}

function compareTasks(left: TaskSummaryDto, right: TaskSummaryDto): number {
  const leftTime = Date.parse(left.scheduledAt ?? left.dueAt ?? "");
  const rightTime = Date.parse(right.scheduledAt ?? right.dueAt ?? "");
  const safeLeft = Number.isNaN(leftTime) ? Number.POSITIVE_INFINITY : leftTime;
  const safeRight = Number.isNaN(rightTime) ? Number.POSITIVE_INFINITY : rightTime;

  return safeLeft - safeRight || left.title.localeCompare(right.title);
}

function CalendarTaskRail({
  errorMessage = null,
  isLoading = false,
  selectedDate,
  tasks,
}: CalendarTaskRailProps) {
  const sortedTasks = [...tasks].sort(compareTasks);

  return (
    <section
      aria-live="polite"
      aria-labelledby="calendar-day-details-heading"
      className="calendar-task-rail"
      data-testid="calendar-task-rail"
      id="calendar-day-details"
    >
      <p className="calendar-task-rail__eyebrow">{t("calendar.details")}</p>
      <h2 id="calendar-day-details-heading">
        {selectedDate ? formatSelectedDate(selectedDate) : t("calendar.details")}
      </h2>
      {errorMessage ? (
        <p className="calendar-task-rail__message calendar-task-rail__message--error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {!errorMessage && isLoading ? (
        <p className="calendar-task-rail__message" role="status">
          {t("tasks.loading")}
        </p>
      ) : null}
      {!errorMessage && !isLoading && selectedDate === null ? (
        <p className="calendar-task-rail__message">{t("calendar.selectDay")}</p>
      ) : null}
      {!errorMessage && !isLoading && selectedDate !== null && sortedTasks.length === 0 ? (
        <p className="calendar-task-rail__message">{t("calendar.noTasks")}</p>
      ) : null}
      {!errorMessage && !isLoading && sortedTasks.length > 0 ? (
        <ul aria-label={t("calendar.tasks")} className="task-ledger calendar-task-rail__tasks">
          {sortedTasks.map((task) => (
            <li
              className={`calendar-task-rail__task${task.completed ? " is-completed" : ""}`}
              key={task.id}
            >
              <span
                aria-hidden="true"
                className={`calendar-task-rail__priority calendar-task-rail__priority--${task.priority.toLowerCase()}`}
              />
              <div className="calendar-task-rail__task-content">
                <strong title={task.title}>{task.title}</strong>
                <span>
                  {task.projectName ?? t("task.project.none")}
                  {task.tags.length ? ` · ${task.tags.slice(0, 2).join(" · ")}` : ""}
                </span>
              </div>
              <time dateTime={task.scheduledAt ?? task.dueAt ?? undefined}>
                <Clock3 aria-hidden="true" size={13} />
                {formatTaskTime(task)}
              </time>
              <span
                aria-label={task.completed ? t("task.completed") : t("task.open")}
                className="calendar-task-rail__status"
              >
                {task.completed ? (
                  <Check aria-hidden="true" size={14} />
                ) : (
                  <Circle aria-hidden="true" size={10} />
                )}
                <span className="sr-only">
                  {task.completed ? t("calendar.completed") : t("task.open")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default CalendarTaskRail;
