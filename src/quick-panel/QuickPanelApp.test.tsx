import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskDto, TaskSummaryDto } from "../features/tasks/taskTypes";
import { QuickPanelApp } from "./main";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const openTodayTask: TaskSummaryDto = {
  childCompleted: 0,
  childTotal: 0,
  completed: false,
  dueAt: null,
  id: "open-today",
  priority: "Normal",
  projectName: null,
  scheduledAt: "2026-08-28T09:00:00.000Z",
  tags: [],
  title: "Ship quick panel",
};

const completeTask: TaskDto = {
  completedAt: "2026-08-28T14:30:00.000Z",
  createdAt: "2026-08-28T09:00:00.000Z",
  dueAt: null,
  id: openTodayTask.id,
  note: "",
  parentId: null,
  priority: "Normal",
  projectId: null,
  recurrence: null,
  scheduledAt: openTodayTask.scheduledAt,
  title: openTodayTask.title,
  updatedAt: "2026-08-28T14:30:00.000Z",
};

describe("QuickPanelApp", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("uses exact Tauri task arguments and reloads Today after complete and create", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-28T14:30:00.000Z"));
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_quick_panel_behavior") return "click";
      if (command === "list_tasks") return [openTodayTask];
      if (command === "update_task" || command === "create_task") return completeTask;
      return undefined;
    });

    render(<QuickPanelApp />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("list_tasks", { view: { kind: "today" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open quick panel" }));
    expect(invokeMock).toHaveBeenCalledWith("set_quick_panel_mode", { mode: "expanded" });

    const completeButton = await screen.findByRole("checkbox", {
      name: "Complete task Ship quick panel",
    });
    vi.setSystemTime(new Date("2026-08-28T14:30:00.000Z"));
    fireEvent.click(completeButton);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("update_task", {
        id: openTodayTask.id,
        patch: { completedAt: "2026-08-28T14:30:00.000Z" },
      }),
    );

    const titleInput = screen.getByRole("textbox", { name: "Add task" });
    await userEvent.type(titleInput, "Capture release note");
    vi.setSystemTime(new Date("2026-08-28T14:30:00.000Z"));
    fireEvent.submit(titleInput.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("create_task", {
        draft: {
          note: "",
          scheduledAt: "2026-08-28T14:30:00.000Z",
          title: "Capture release note",
        },
      }),
    );

    expect(invokeMock.mock.calls.filter(([command]) => command === "list_tasks")).toHaveLength(3);
  });

  it("does not allow hover expansion before persisted click behavior loads", async () => {
    vi.useFakeTimers();
    const behaviorRequest = deferred<"click">();
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return behaviorRequest.promise;
      if (command === "list_tasks") return Promise.resolve([openTodayTask]);
      return Promise.resolve(undefined);
    });

    render(<QuickPanelApp />);
    await act(async () => undefined);
    expect(screen.getByLabelText("Quick panel")).toBeInTheDocument();
    fireEvent.pointerEnter(screen.getByLabelText("Quick panel"));
    act(() => vi.advanceTimersByTime(150));

    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();
    await act(async () => behaviorRequest.resolve("click"));
    act(() => vi.runAllTimers());
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();
  });

  it("surfaces behavior and Today load rejection without an unhandled promise", async () => {
    vi.mocked(invoke).mockRejectedValue({
      code: "storage_unavailable",
      message_key: "errors.storage.unavailable",
    });

    render(<QuickPanelApp />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Local storage is temporarily unavailable",
    );
    expect(screen.getByRole("button", { name: "Open quick panel" })).toBeEnabled();
  });

  it("surfaces real mode, complete, and create IPC rejection while preserving capture", async () => {
    const user = userEvent.setup();
    const invokeMock = vi.mocked(invoke);
    let rejectMode = true;
    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "list_tasks") return Promise.resolve([openTodayTask]);
      if (command === "set_quick_panel_mode" && rejectMode) {
        return Promise.reject(commandError());
      }
      if (command === "update_task" || command === "create_task") {
        return Promise.reject(commandError());
      }
      return Promise.resolve(undefined);
    });

    render(<QuickPanelApp />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_quick_panel_behavior"));

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Local storage is temporarily unavailable",
    );
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();

    rejectMode = false;
    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    await user.click(screen.getByRole("checkbox", { name: "Complete task Ship quick panel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Local storage is temporarily unavailable",
    );

    const titleInput = screen.getByRole("textbox", { name: "Add task" });
    await user.type(titleInput, "Retain after reject");
    fireEvent.submit(titleInput.closest("form") as HTMLFormElement);
    await waitFor(() => expect(titleInput).toBeEnabled());
    expect(titleInput).toHaveValue("Retain after reject");
    expect(invokeMock).toHaveBeenCalledWith("create_task", {
      draft: expect.objectContaining({ title: "Retain after reject" }),
    });
  });
});

function commandError() {
  return {
    code: "storage_unavailable",
    message_key: "errors.storage.unavailable",
  };
}

function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}
