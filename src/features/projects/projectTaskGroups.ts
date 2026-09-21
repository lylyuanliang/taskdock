import type { TaskPriority, TaskSummaryDto } from "../tasks/taskTypes";

export interface ProjectTaskGroups {
  nextAction: TaskSummaryDto[];
  doing: TaskSummaryDto[];
  todo: TaskSummaryDto[];
}

const priorityRank: Record<TaskPriority, number> = {
  High: 0,
  Normal: 1,
  Low: 2,
};

/**
 * Derives the three visual columns without introducing a persisted status field.
 * Next Action has priority over Doing, and Doing has priority over To Do.
 */
export function groupProjectTasks(
  tasks: readonly TaskSummaryDto[],
  now = new Date(),
): ProjectTaskGroups {
  const openTasks = tasks.filter((task) => !task.completed);
  const sortedTasks = [...openTasks].sort(compareTaskOrder);
  const nextActionIds = new Set<string>();

  for (const task of sortedTasks) {
    if (task.priority === "High") {
      nextActionIds.add(task.id);
    }
  }

  const earliestDueTask = sortedTasks
    .filter((task) => task.dueAt !== null && isValidDate(task.dueAt))
    .sort((left, right) => Date.parse(left.dueAt as string) - Date.parse(right.dueAt as string))[0];
  if (earliestDueTask) {
    nextActionIds.add(earliestDueTask.id);
  }

  const nextAction = sortedTasks.filter((task) => nextActionIds.has(task.id));
  const remaining = sortedTasks.filter((task) => !nextActionIds.has(task.id));
  const doing = remaining.filter((task) => isScheduledOnDay(task.scheduledAt, now));
  const doingIds = new Set(doing.map((task) => task.id));
  const todo = remaining.filter((task) => !doingIds.has(task.id));

  return { doing, nextAction, todo };
}

function compareTaskOrder(left: TaskSummaryDto, right: TaskSummaryDto): number {
  const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority];
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const leftTime = taskComparableTime(left);
  const rightTime = taskComparableTime(right);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.title.localeCompare(right.title);
}

function taskComparableTime(task: TaskSummaryDto): number {
  const value = task.dueAt ?? task.scheduledAt;
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function isValidDate(value: string | null): boolean {
  return value !== null && !Number.isNaN(Date.parse(value));
}

function isScheduledOnDay(value: string | null, day: Date): boolean {
  if (!value) {
    return false;
  }

  const scheduledDate = new Date(value);
  return (
    !Number.isNaN(scheduledDate.getTime()) &&
    scheduledDate.getFullYear() === day.getFullYear() &&
    scheduledDate.getMonth() === day.getMonth() &&
    scheduledDate.getDate() === day.getDate()
  );
}
