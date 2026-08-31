import { invoke } from "@tauri-apps/api/core";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createTask, listTasks, updateTask } from "../api/tasks";
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

  const reloadTasks = useCallback(async () => {
    try {
      const loadedTasks = await listTasks({ kind: "today" });
      setTasks(loadedTasks);
      setTaskErrorMessageKey(null);
    } catch (error: unknown) {
      setTaskErrorMessageKey(getCommandErrorMessageKey(error));
      throw error;
    }
  }, []);

  useEffect(() => {
    let isCurrent = true;

    listTasks({ kind: "today" })
      .then((loadedTasks) => {
        if (isCurrent) {
          setTasks(loadedTasks);
          setTaskErrorMessageKey(null);
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

    invoke<QuickPanelBehavior>("get_quick_panel_behavior")
      .then((persistedBehavior) => {
        if (isCurrent) {
          setBehavior(persistedBehavior);
          setBehaviorErrorMessageKey(null);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setBehavior("hover");
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

  async function handleComplete(id: string) {
    await updateTask(id, { completedAt: new Date().toISOString() });
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
      onModeChange={handleModeChange}
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
