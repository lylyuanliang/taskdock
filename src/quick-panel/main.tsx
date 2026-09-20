import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createProject, listProjects } from "../api/projects";
import { completeTask, createTask, getTaskEditor, listTasks, updateTask } from "../api/tasks";
import {
  getCommandErrorMessageKey,
  type TaskDraftInput,
  type TaskEditorDto,
  type TaskPatchInput,
  type TaskSummaryDto,
} from "../features/tasks/taskTypes";
import type { ProjectDto } from "../features/projects/projectTypes";
import { resolveLocale, t } from "../i18n";
import { ThemeProvider } from "../theme/ThemeProvider";
import "../theme/tokens.css";
import { QuickPanel, type QuickPanelBehavior, type QuickPanelMode } from "./QuickPanel";
import "./quickPanel.css";

export function QuickPanelApp() {
  const [behavior, setBehavior] = useState<QuickPanelBehavior | null>(null);
  const [behaviorErrorMessageKey, setBehaviorErrorMessageKey] = useState<string | null>(null);
  const [taskErrorMessageKey, setTaskErrorMessageKey] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskSummaryDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const taskRequestIdRef = useRef(0);

  const reloadTasks = useCallback(async () => {
    const requestId = taskRequestIdRef.current + 1;

    taskRequestIdRef.current = requestId;

    try {
      const loadedTasks = await listTasks({ kind: "quickPanelToday" });
      if (taskRequestIdRef.current === requestId) {
        setTasks(loadedTasks);
        setTaskErrorMessageKey(null);
      }
    } catch (error: unknown) {
      if (taskRequestIdRef.current === requestId) {
        setTaskErrorMessageKey(getCommandErrorMessageKey(error));
        throw error;
      }
    }
  }, []);

  const reloadProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (error: unknown) {
      setTaskErrorMessageKey(getCommandErrorMessageKey(error));
      throw error;
    }
  }, []);

  useEffect(() => {
    let isCurrent = true;
    const requestId = taskRequestIdRef.current + 1;

    taskRequestIdRef.current = requestId;

    void listTasks({ kind: "quickPanelToday" })
      .then((loadedTasks) => {
        if (isCurrent && taskRequestIdRef.current === requestId) {
          setTasks(loadedTasks);
          setTaskErrorMessageKey(null);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent && taskRequestIdRef.current === requestId) {
          setTaskErrorMessageKey(getCommandErrorMessageKey(error));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    let isCurrent = true;

    void listProjects()
      .then((loadedProjects) => {
        if (isCurrent) {
          setProjects(loadedProjects);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setTaskErrorMessageKey(getCommandErrorMessageKey(error));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    let unlisten: (() => void) | null = null;

    void listen("task://mutated", () => {
      if (isCurrent) {
        void reloadTasks().catch(() => undefined);
      }
    })
      .then((registeredUnlisten) => {
        if (!isCurrent) {
          registeredUnlisten();
          return;
        }

        unlisten = registeredUnlisten;
        void reloadTasks().catch(() => undefined);
      })
      .catch((error: unknown) => {
        console.error("Unable to subscribe to task mutation events", error);
      });

    return () => {
      isCurrent = false;
      unlisten?.();
    };
  }, [reloadTasks]);

  useEffect(() => {
    let isCurrent = true;

    invoke<QuickPanelBehavior>("get_quick_panel_behavior")
      .then((persistedBehavior) => {
        if (isCurrent) {
          setBehavior(persistedBehavior);
          setBehaviorErrorMessageKey(null);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setBehavior("click");
          setBehaviorErrorMessageKey(getCommandErrorMessageKey(error));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  async function handleModeChange(mode: QuickPanelMode) {
    await invoke("set_quick_panel_mode", { mode });
  }

  async function handleOpenMainWindow() {
    await invoke("open_main_window");
  }

  async function handleExitApp() {
    await invoke("exit_app");
  }

  async function handleComplete(id: string) {
    await completeTask(id);
    await reloadTasks();
  }

  async function handleCreate(draft: TaskDraftInput) {
    await createTask(draft);
    await reloadTasks();
  }

  async function handleLoadTaskEditor(id: string): Promise<TaskEditorDto> {
    return getTaskEditor(id);
  }

  async function handleUpdateTask(id: string, patch: TaskPatchInput) {
    await updateTask(id, patch);
    await reloadTasks();
  }

  async function handleCreateProject(name: string): Promise<ProjectDto> {
    const project = await createProject(name);
    await reloadProjects();
    return project;
  }

  return (
    <QuickPanel
      behavior={behavior}
      errorMessageKey={behaviorErrorMessageKey ?? taskErrorMessageKey}
      onComplete={handleComplete}
      onCreate={handleCreate}
      onCreateProject={handleCreateProject}
      onExitApp={handleExitApp}
      onLoadTaskEditor={handleLoadTaskEditor}
      onModeChange={handleModeChange}
      onOpenMainWindow={handleOpenMainWindow}
      onUpdateTask={handleUpdateTask}
      projects={projects}
      tasks={tasks}
    />
  );
}

document.documentElement.lang = resolveLocale(navigator.language);
document.title = t("quickPanel.windowTitle");

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ThemeProvider>
        <QuickPanelApp />
      </ThemeProvider>
    </StrictMode>,
  );
}
