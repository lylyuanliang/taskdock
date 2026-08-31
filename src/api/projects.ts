import { invoke } from "@tauri-apps/api/core";
import type { ProjectDto } from "../features/projects/projectTypes";

export async function listProjects(): Promise<ProjectDto[]> {
  return invoke<ProjectDto[]>("list_projects");
}

export async function createProject(name: string): Promise<ProjectDto> {
  return invoke<ProjectDto>("create_project", { name });
}

export async function renameProject(id: string, name: string): Promise<ProjectDto> {
  return invoke<ProjectDto>("rename_project", { id, name });
}

export async function archiveProject(id: string): Promise<ProjectDto> {
  return invoke<ProjectDto>("archive_project", { id });
}
