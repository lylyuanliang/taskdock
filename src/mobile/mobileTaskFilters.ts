import type { TaskDto } from "../features/tasks/taskTypes";

function localDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today includes scheduled or due tasks through the user's local date. */
export function isMobileTodayTask(
  task: Pick<TaskDto, "completedAt" | "dueAt" | "scheduledAt">,
  now = new Date(),
): boolean {
  if (task.completedAt !== null) return false;
  const today = localDate(now.toISOString());
  return [task.scheduledAt, task.dueAt].some(
    (value) => value !== null && localDate(value) <= today,
  );
}
