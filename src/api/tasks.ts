import { invoke } from "@tauri-apps/api/core";
import type {
  TaskDraftInput,
  TaskDto,
  TaskEditorDraftInput,
  TaskEditorDto,
  TaskEditorPatchInput,
  TaskPatchInput,
  TaskSummaryDto,
  TaskViewInput,
} from "../features/tasks/taskTypes";

export async function createTask(draft: TaskDraftInput): Promise<TaskDto> {
  return invoke<TaskDto>("create_task", { draft });
}

export async function completeTask(id: string): Promise<TaskDto> {
  return invoke<TaskDto>("complete_task", { id });
}

export async function getTaskEditor(id: string): Promise<TaskEditorDto> {
  return invoke<TaskEditorDto>("get_task_editor", { id });
}

export async function createTaskEditor(
  draft: TaskEditorDraftInput,
  tagNames: string[],
): Promise<TaskEditorDto> {
  return invoke<TaskEditorDto>("create_task_editor", { draft, tagNames });
}

export async function updateTaskEditor(
  id: string,
  expectedRevision: number,
  patch: TaskEditorPatchInput,
  tagNames: string[],
): Promise<TaskEditorDto> {
  return invoke<TaskEditorDto>("update_task_editor", {
    expectedRevision,
    id,
    patch,
    tagNames,
  });
}

export async function createSubtask(parentId: string, title: string): Promise<TaskDto> {
  return invoke<TaskDto>("create_subtask", { parentId, title });
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
