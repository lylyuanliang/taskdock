import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "../../i18n";
import TaskSummaryList from "../tasks/TaskSummaryList";
import type { TaskSummaryDto } from "../tasks/taskTypes";

interface MonthCalendarProps {
  errorMessage: string | null;
  isLoading: boolean;
  month: string;
  onMonthChange: (month: string) => void;
  tasks: TaskSummaryDto[];
}

interface CalendarDay {
  date: Date;
  key: string;
  isCurrentMonth: boolean;
}

interface SelectedCalendarDay {
  dateKey: string;
  month: string;
}

function MonthCalendar({
  errorMessage,
  isLoading,
  month,
  onMonthChange,
  tasks,
}: MonthCalendarProps) {
  const [year, monthIndex] = parseMonth(month);
  const calendarDays = buildCalendarDays(year, monthIndex);
  const tasksByDay = groupTasksByDay(tasks);
  const [selectedDay, setSelectedDay] = useState<SelectedCalendarDay | null>(null);
  const selectedDateKey = selectedDay?.month === month ? selectedDay.dateKey : null;
  const selectedTasks = selectedDateKey ? (tasksByDay.get(selectedDateKey) ?? []) : [];

  return (
    <section aria-label={t("calendar.title")} className="month-calendar">
      <header className="month-calendar__toolbar">
        <button
          aria-label={t("calendar.previousMonth")}
          className="month-calendar__month-button"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          title={t("calendar.previousMonth")}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </button>
        <h2>{formatMonth(year, monthIndex)}</h2>
        <button
          aria-label={t("calendar.nextMonth")}
          className="month-calendar__month-button"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          title={t("calendar.nextMonth")}
          type="button"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </header>
      <div className="month-calendar__layout">
        <div className="month-calendar__grid">
          {weekdayNames().map((weekday) => (
            <span className="month-calendar__weekday" key={weekday}>
              {weekday}
            </span>
          ))}
          {calendarDays.map((day) => {
            const dayTasks = day.isCurrentMonth ? (tasksByDay.get(day.key) ?? []) : [];

            if (!day.isCurrentMonth) {
              return (
                <span
                  aria-hidden="true"
                  className="month-calendar__day is-outside-month"
                  key={day.key}
                />
              );
            }

            return (
              <button
                aria-controls="calendar-day-details"
                aria-label={formatDaySummary(day.date, dayTasks)}
                aria-pressed={selectedDateKey === day.key}
                className="month-calendar__day"
                key={day.key}
                onClick={() => setSelectedDay({ dateKey: day.key, month })}
                type="button"
              >
                <span className="month-calendar__day-number">{day.date.getDate()}</span>
                <span className="month-calendar__tasks">
                  {dayTasks.map((task) => (
                    <span className="month-calendar__task" key={task.id}>
                      <span className="month-calendar__task-title">{task.title}</span>
                      {task.completed ? (
                        <span className="month-calendar__task-status">
                          {t("calendar.completed")}
                        </span>
                      ) : null}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <section aria-live="polite" className="month-calendar__details" id="calendar-day-details">
          <h2>{selectedDateKey ? formatDayKey(selectedDateKey) : t("calendar.details")}</h2>
          {errorMessage ? (
            <p className="task-ledger__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          {!errorMessage && isLoading ? (
            <p className="task-ledger__status" role="status">
              {t("tasks.loading")}
            </p>
          ) : null}
          {!errorMessage && !isLoading && selectedDateKey === null ? (
            <p>{t("calendar.selectDay")}</p>
          ) : null}
          {!errorMessage && !isLoading && selectedDateKey !== null && selectedTasks.length === 0 ? (
            <p>{t("calendar.noTasks")}</p>
          ) : null}
          {!errorMessage && !isLoading && selectedTasks.length > 0 ? (
            <TaskSummaryList onToggleCompleted={() => undefined} readOnly tasks={selectedTasks} />
          ) : null}
        </section>
      </div>
    </section>
  );
}

function buildCalendarDays(year: number, monthIndex: number): CalendarDay[] {
  const firstDay = new Date(year, monthIndex, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const firstGridDay = new Date(year, monthIndex, 1 - startOffset);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const lastOffset = (7 - ((lastDay.getDay() + 6) % 7) - 1) % 7;
  const dayCount = lastDay.getDate() + startOffset + lastOffset;

  return Array.from({ length: dayCount }, (_, offset) => {
    const date = new Date(firstGridDay);
    date.setDate(firstGridDay.getDate() + offset);

    return {
      date,
      isCurrentMonth: date.getMonth() === monthIndex,
      key: toDateKey(date),
    };
  });
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat(navigator.language, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(date);
}

function formatDaySummary(date: Date, tasks: TaskSummaryDto[]): string {
  const completedCount = tasks.filter((task) => task.completed).length;

  return `${formatDay(date)}, ${tasks.length} ${t("calendar.tasks")}, ${completedCount} ${t("calendar.completed").toLowerCase()}`;
}

function formatDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);

  return formatDay(new Date(year, month - 1, day));
}

function formatMonth(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat(navigator.language, { month: "long", year: "numeric" }).format(
    new Date(year, monthIndex, 1),
  );
}

function groupTasksByDay(tasks: TaskSummaryDto[]): Map<string, TaskSummaryDto[]> {
  const tasksByDay = new Map<string, TaskSummaryDto[]>();

  for (const task of tasks) {
    if (task.scheduledAt === null) {
      continue;
    }

    const key = toDateKey(new Date(task.scheduledAt));
    const dayTasks = tasksByDay.get(key) ?? [];
    dayTasks.push(task);
    tasksByDay.set(key, dayTasks);
  }

  return tasksByDay;
}

function parseMonth(month: string): [number, number] {
  const [year, calendarMonth] = month.split("-").map(Number);

  return [year, calendarMonth - 1];
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthIndex] = parseMonth(month);
  const shifted = new Date(year, monthIndex + offset, 1);

  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function weekdayNames(): string[] {
  const monday = new Date(2026, 5, 1);

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);

    return new Intl.DateTimeFormat(navigator.language, { weekday: "short" }).format(day);
  });
}

export default MonthCalendar;
