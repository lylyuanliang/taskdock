import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { completeTask, createTask, listTasks } from "../api/tasks";
import {
  getCommandErrorMessageKey,
  type TaskDraftInput,
  type TaskSummaryDto,
} from "../features/tasks/taskTypes";
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
  const taskRequestIdRef = useRef(0);

  const reloadTasks = useCallback(async () => {
    const requestId = taskRequestIdRef.current + 1;

    taskRequestIdRef.current = requestId;

    try {
      const loadedTasks = await listTasks({ kind: "today" });
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

  useEffect(() => {
    let isCurrent = true;
    const requestId = taskRequestIdRef.current + 1;

    taskRequestIdRef.current = requestId;

    void listTasks({ kind: "today" })
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

  return (
    <QuickPanel
      behavior={behavior}
      errorMessageKey={behaviorErrorMessageKey ?? taskErrorMessageKey}
      onComplete={handleComplete}
      onCreate={handleCreate}
      onExitApp={handleExitApp}
      onModeChange={handleModeChange}
      onOpenMainWindow={handleOpenMainWindow}
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
