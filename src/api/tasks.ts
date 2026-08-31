import { invoke } from "@tauri-apps/api/core";
import type {
  TaskDraftInput,
  TaskDto,
  TaskPatchInput,
  TaskSummaryDto,
  TaskViewInput,
} from "../features/tasks/taskTypes";

export async function createTask(draft: TaskDraftInput): Promise<TaskDto> {
  return invoke<TaskDto>("create_task", { draft });
}

export async function listInbox(): Promise<TaskDto[]> {
  return invoke<TaskDto[]>("list_inbox");
}

export async function listTasks(view: TaskViewInput): Promise<TaskSummaryDto[]> {
  return invoke<TaskSummaryDto[]>("list_tasks", { view });
}

export async function updateTask(id: string, patch: TaskPatchInput): Promise<TaskDto> {
  return invoke<TaskDto>("update_task", { id, patch });
}
