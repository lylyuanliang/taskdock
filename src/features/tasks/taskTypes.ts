export type TaskPriority = "Low" | "Normal" | "High";

export type RecurrenceRule = "Daily" | "Weekly" | "Monthly" | "Yearly";

export type AppView = "inbox" | "today" | "upcoming" | "completed" | "projects" | "calendar";

export type TaskViewInput =
  | { kind: "inbox" | "today" | "upcoming" | "completed" }
  | { kind: "project"; projectId: string }
  | { kind: "calendar"; month: string }
  | { kind: "search"; query: string };

export interface TaskSummaryDto {
  id: string;
  title: string;
  projectName: string | null;
  tags: string[];
  priority: TaskPriority;
  scheduledAt: string | null;
  dueAt: string | null;
  completed: boolean;
  childTotal: number;
  childCompleted: number;
}

export interface TaskDto {
  id: string;
  title: string;
  note: string;
  projectId: string | null;
  parentId: string | null;
  priority: TaskPriority;
  scheduledAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  recurrence: RecurrenceRule | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDraftInput {
  title: string;
  note: string;
  projectId?: string;
  scheduledAt?: string;
}

export interface TaskPatchInput {
  title?: string;
  note?: string;
  projectId?: string | null;
  completedAt?: string | null;
}

export interface CommandError {
  code: string;
  message_key: string;
}

function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "message_key" in value &&
    typeof value.message_key === "string"
  );
}

export function getCommandErrorMessageKey(error: unknown): string {
  if (isCommandError(error)) {
    return error.message_key;
  }

  return "errors.unknown";
}
