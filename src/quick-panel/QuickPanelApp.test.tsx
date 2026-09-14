import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDto, TaskSummaryDto } from "../features/tasks/taskTypes";
import { QuickPanelApp } from "./main";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
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
  revision: 2,
};

describe("QuickPanelApp", () => {
  beforeEach(() => {
    vi.mocked(listen).mockImplementation(() => new Promise(() => undefined));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("invokes the main window command from the expanded panel header", async () => {
    const user = userEvent.setup();
    const invokeMock = vi.mocked(invoke);

    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "list_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<QuickPanelApp />);

    await user.click(await screen.findByRole("button", { name: "Open quick panel" }));
    await user.click(screen.getByRole("button", { name: "Open main window" }));

    expect(invokeMock).toHaveBeenCalledWith("open_main_window");
  });

  it("invokes the exit command from the expanded panel header", async () => {
    const user = userEvent.setup();
    const invokeMock = vi.mocked(invoke);

    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "list_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<QuickPanelApp />);

    await user.click(await screen.findByRole("button", { name: "Open quick panel" }));
    await user.click(screen.getByRole("button", { name: "Exit TaskDock" }));

    expect(invokeMock).toHaveBeenCalledWith("exit_app");
  });

  it("reloads Today after task mutations and keeps a newer event response over initialization", async () => {
    const initialRequest = deferred<TaskSummaryDto[]>();
    const subscriptionRefreshRequest = deferred<TaskSummaryDto[]>();
    const eventRefreshRequest = deferred<TaskSummaryDto[]>();
    const unlisten = vi.fn();
    const invokeMock = vi.mocked(invoke);

    vi.mocked(listen).mockResolvedValue(unlisten);
    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "list_tasks") {
        const requestCount = invokeMock.mock.calls.filter(([calledCommand]) => {
          return calledCommand === "list_tasks";
        }).length;

        if (requestCount === 1) return initialRequest.promise;
        if (requestCount === 2) return subscriptionRefreshRequest.promise;
        return eventRefreshRequest.promise;
      }

      return Promise.resolve(undefined);
    });

    render(<QuickPanelApp />);

    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith("task://mutated", expect.any(Function));
      expect(invokeMock.mock.calls.filter(([command]) => command === "list_tasks")).toHaveLength(2);
    });

    await act(async () => {
      subscriptionRefreshRequest.resolve([]);
    });

    const mutationListener = vi.mocked(listen).mock.calls[0]?.[1];
    if (!mutationListener) {
      throw new Error("Expected task mutation listener to be registered");
    }

    await act(async () => {
      mutationListener({} as never);
    });

    expect(invokeMock.mock.calls.filter(([command]) => command === "list_tasks")).toHaveLength(3);

    await act(async () => {
      initialRequest.resolve([openTodayTask]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Open quick panel" }));
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();

    await act(async () => {
      eventRefreshRequest.resolve([
        {
          ...openTodayTask,
          id: "event-today",
          title: "Updated from another window",
        },
      ]);
    });

    expect(await screen.findByText("Updated from another window")).toBeInTheDocument();
  });

  it("does not reload after unmount and unlistens when registration finishes late", async () => {
    const registration = deferred<() => void>();
    const invokeMock = vi.mocked(invoke);

    vi.mocked(listen).mockReturnValue(registration.promise);
    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "list_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const { unmount } = render(<QuickPanelApp />);

    await waitFor(() =>
      expect(listen).toHaveBeenCalledWith("task://mutated", expect.any(Function)),
    );
    const listRequestsBeforeUnmount = invokeMock.mock.calls.filter(
      ([command]) => command === "list_tasks",
    ).length;
    unmount();

    const unlisten = vi.fn();
    await act(async () => {
      registration.resolve(unlisten);
    });

    expect(unlisten).toHaveBeenCalledOnce();
    expect(invokeMock.mock.calls.filter(([command]) => command === "list_tasks")).toHaveLength(
      listRequestsBeforeUnmount,
    );
  });

  it("does not reload Today when a registered task mutation callback runs after unmount", async () => {
    const unlisten = vi.fn();
    const invokeMock = vi.mocked(invoke);

    vi.mocked(listen).mockResolvedValue(unlisten);
    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "list_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const { unmount } = render(<QuickPanelApp />);

    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith("task://mutated", expect.any(Function));
      expect(invokeMock.mock.calls.filter(([command]) => command === "list_tasks")).toHaveLength(2);
    });

    const mutationListener = vi.mocked(listen).mock.calls[0]?.[1];
    if (!mutationListener) {
      throw new Error("Expected task mutation listener to be registered");
    }

    unmount();
    await act(async () => {
      mutationListener({} as never);
    });

    expect(unlisten).toHaveBeenCalledOnce();
    expect(invokeMock.mock.calls.filter(([command]) => command === "list_tasks")).toHaveLength(2);
  });

  it("does not surface a stale completion reload failure after a newer event refresh", async () => {
    const staleReload = deferred<TaskSummaryDto[]>();
    const unlisten = vi.fn();
    const invokeMock = vi.mocked(invoke);
    let todayRequestCount = 0;

    vi.mocked(listen).mockResolvedValue(unlisten);
    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "complete_task") return Promise.resolve(completeTask);
      if (command === "list_tasks") {
        todayRequestCount += 1;

        if (todayRequestCount === 3) return staleReload.promise;
        return Promise.resolve(todayRequestCount === 4 ? [] : [openTodayTask]);
      }

      return Promise.resolve(undefined);
    });

    render(<QuickPanelApp />);

    await waitFor(() => expect(todayRequestCount).toBe(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open quick panel" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open quick panel" }));
    await fireEvent.click(
      await screen.findByRole("checkbox", { name: "Complete task Ship quick panel" }),
    );
    await waitFor(() => expect(todayRequestCount).toBe(3));

    const mutationListener = vi.mocked(listen).mock.calls[0]?.[1];
    if (!mutationListener) {
      throw new Error("Expected task mutation listener to be registered");
    }

    await act(async () => {
      mutationListener({} as never);
    });
    await waitFor(() => expect(todayRequestCount).toBe(4));

    await act(async () => {
      staleReload.reject(commandError());
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();
  });

  it("does not surface a stale create reload failure after a newer event refresh", async () => {
    const staleReload = deferred<TaskSummaryDto[]>();
    const unlisten = vi.fn();
    const invokeMock = vi.mocked(invoke);
    const user = userEvent.setup();
    let todayRequestCount = 0;

    vi.mocked(listen).mockResolvedValue(unlisten);
    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "create_task") return Promise.resolve(completeTask);
      if (command === "list_tasks") {
        todayRequestCount += 1;

        if (todayRequestCount === 3) return staleReload.promise;
        return Promise.resolve(todayRequestCount === 4 ? [] : [openTodayTask]);
      }

      return Promise.resolve(undefined);
    });

    render(<QuickPanelApp />);

    await waitFor(() => expect(todayRequestCount).toBe(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open quick panel" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open quick panel" }));
    const titleInput = await screen.findByRole("textbox", { name: "Add task" });
    await user.type(titleInput, "Capture review feedback");
    fireEvent.submit(titleInput.closest("form") as HTMLFormElement);
    await waitFor(() => expect(todayRequestCount).toBe(3));

    const mutationListener = vi.mocked(listen).mock.calls[0]?.[1];
    if (!mutationListener) {
      throw new Error("Expected task mutation listener to be registered");
    }

    await act(async () => {
      mutationListener({} as never);
    });
    await waitFor(() => expect(todayRequestCount).toBe(4));

    await act(async () => {
      staleReload.reject(commandError());
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(titleInput).toHaveValue("");
  });

  it("surfaces a current completion reload failure to the action handler", async () => {
    const currentReload = deferred<TaskSummaryDto[]>();
    const unlisten = vi.fn();
    const invokeMock = vi.mocked(invoke);
    let todayRequestCount = 0;

    vi.mocked(listen).mockResolvedValue(unlisten);
    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "complete_task") return Promise.resolve(completeTask);
      if (command === "list_tasks") {
        todayRequestCount += 1;
        return todayRequestCount === 3 ? currentReload.promise : Promise.resolve([openTodayTask]);
      }

      return Promise.resolve(undefined);
    });

    render(<QuickPanelApp />);

    await waitFor(() => expect(todayRequestCount).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Open quick panel" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Complete task Ship quick panel" }),
    );
    await waitFor(() => expect(todayRequestCount).toBe(3));

    await act(async () => {
      currentReload.reject(commandError());
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Local storage is temporarily unavailable",
    );
  });

  it("keeps one active task mutation listener in StrictMode", async () => {
    const firstUnlisten = vi.fn();
    const secondUnlisten = vi.fn();
    const listeners: Array<(event: never) => void> = [];
    const invokeMock = vi.mocked(invoke);

    vi.mocked(listen).mockImplementation(async (_event, listener) => {
      listeners.push(listener as (event: never) => void);
      return listeners.length === 1 ? firstUnlisten : secondUnlisten;
    });
    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "list_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(
      <StrictMode>
        <QuickPanelApp />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(listeners).toHaveLength(2);
      expect(firstUnlisten).toHaveBeenCalledOnce();
    });
    const todayRequestsBeforeEvent = invokeMock.mock.calls.filter(
      ([command]) => command === "list_tasks",
    ).length;

    await act(async () => {
      listeners[1]?.({} as never);
    });

    await waitFor(() => {
      expect(invokeMock.mock.calls.filter(([command]) => command === "list_tasks")).toHaveLength(
        todayRequestsBeforeEvent + 1,
      );
    });
  });

  it("logs a rejected task mutation subscription without breaking the quick panel", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const invokeMock = vi.mocked(invoke);

    vi.mocked(listen).mockRejectedValue(new Error("event unavailable"));
    invokeMock.mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.resolve("click");
      if (command === "list_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<QuickPanelApp />);

    await waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Open quick panel" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("uses exact Tauri task arguments and reloads Today after complete and create", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-28T14:30:00.000Z"));
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_quick_panel_behavior") return "click";
      if (command === "list_tasks") return [openTodayTask];
      if (command === "complete_task" || command === "create_task") return completeTask;
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
    fireEvent.click(completeButton);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("complete_task", { id: openTodayTask.id }),
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

  it("falls back to click behavior when loading the saved behavior fails", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_quick_panel_behavior") return Promise.reject(commandError());
      if (command === "list_tasks") return Promise.resolve([openTodayTask]);
      return Promise.resolve(undefined);
    });

    render(<QuickPanelApp />);

    await screen.findByRole("alert");
    fireEvent.pointerEnter(screen.getByLabelText("Quick panel"));
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open quick panel" }));
    expect(await screen.findByText(openTodayTask.title)).toBeVisible();
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
      if (command === "complete_task" || command === "create_task") {
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
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return { promise, reject: rejectPromise, resolve: resolvePromise };
}
