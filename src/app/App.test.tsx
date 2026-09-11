import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import type { TaskSummaryDto } from "../features/tasks/taskTypes";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const savedTask = {
  id: "task-1",
  title: "Review schema",
  note: "",
  projectId: null,
  parentId: null,
  priority: "Normal",
  scheduledAt: null,
  dueAt: null,
  completedAt: null,
  recurrence: null,
  createdAt: "2026-08-27T00:00:00Z",
  updatedAt: "2026-08-27T00:00:00Z",
  revision: 1,
};

const updatedTask = {
  ...savedTask,
  title: "Review release",
  note: "Add migration result",
  updatedAt: "2026-08-27T01:00:00Z",
};

const savedEditor = {
  subtasks: [],
  tagNames: [],
  task: savedTask,
};

const updatedEditor = {
  subtasks: [],
  tagNames: [],
  task: updatedTask,
};

function createDeferred<T>() {
  let rejectPromise: (reason?: unknown) => void;
  let resolvePromise: (value: T | PromiseLike<T>) => void;

  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return {
    promise,
    reject(reason?: unknown) {
      rejectPromise(reason);
    },
    resolve(value: T) {
      resolvePromise(value);
    },
  };
}

function formatMonthHeading(date: Date): string {
  return new Intl.DateTimeFormat(navigator.language, { month: "long", year: "numeric" }).format(
    date,
  );
}

const todaySummary: TaskSummaryDto = {
  childCompleted: 0,
  childTotal: 0,
  completed: false,
  dueAt: null,
  id: "today-task",
  priority: "Normal",
  projectName: null,
  scheduledAt: null,
  tags: [],
  title: "Today-only task",
};

const upcomingSummary: TaskSummaryDto = {
  ...todaySummary,
  id: "upcoming-task",
  title: "Upcoming-only task",
};

const completedSummary: TaskSummaryDto = {
  ...todaySummary,
  completed: true,
  id: "completed-task",
  title: "Completed-only task",
};

const releaseProject = {
  archivedAt: null,
  createdAt: "2026-08-28T00:00:00Z",
  id: "project-1",
  name: "Release",
  updatedAt: "2026-08-28T00:00:00Z",
};

function setNavigatorLanguage(language: string): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "language");

  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: language,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(navigator, "language", originalDescriptor);
      return;
    }

    Reflect.deleteProperty(navigator, "language");
  };
}

async function loadMainWithMockedReactRoot(): Promise<void> {
  vi.resetModules();
  vi.doMock("react-dom/client", () => ({
    default: {
      createRoot: vi.fn(() => ({ render: vi.fn() })),
    },
  }));

  try {
    await import("../main");
  } finally {
    vi.doUnmock("react-dom/client");
  }
}

beforeEach(() => {
  listenMock.mockReset();
  listenMock.mockImplementation(() => new Promise(() => undefined));
  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(savedEditor)
    .mockResolvedValueOnce([savedTask]);
});

afterEach(() => {
  cleanup();
});

it("reloads the Inbox after task mutations and ignores an older Inbox response", async () => {
  const initialInboxRequest = createDeferred<(typeof savedTask)[]>();
  const subscribedInboxRequest = createDeferred<(typeof savedTask)[]>();
  const eventInboxRequest = createDeferred<(typeof savedTask)[]>();
  const unlisten = vi.fn();

  invokeMock.mockReset();
  listenMock.mockResolvedValue(unlisten);
  invokeMock.mockImplementation((command) => {
    if (command === "list_inbox") {
      const requestCount = invokeMock.mock.calls.filter(([calledCommand]) => {
        return calledCommand === "list_inbox";
      }).length;

      if (requestCount === 1) return initialInboxRequest.promise;
      if (requestCount === 2) return subscribedInboxRequest.promise;
      return eventInboxRequest.promise;
    }

    return Promise.resolve([]);
  });

  render(<App />);

  await waitFor(() => {
    expect(listenMock).toHaveBeenCalledWith("task://mutated", expect.any(Function));
    expect(invokeMock.mock.calls.filter(([command]) => command === "list_inbox")).toHaveLength(2);
  });

  await act(async () => {
    subscribedInboxRequest.resolve([]);
  });

  const mutationListener = listenMock.mock.calls[0]?.[1];
  if (!mutationListener) {
    throw new Error("Expected task mutation listener to be registered");
  }

  await act(async () => {
    mutationListener({} as never);
  });

  expect(invokeMock.mock.calls.filter(([command]) => command === "list_inbox")).toHaveLength(3);

  await act(async () => {
    initialInboxRequest.resolve([savedTask]);
  });

  expect(screen.queryByText(savedTask.title)).not.toBeInTheDocument();

  await act(async () => {
    eventInboxRequest.resolve([]);
  });

  expect(await screen.findByText("No tasks in inbox.")).toBeInTheDocument();
});

it("reloads the active Today view after task mutations and ignores an older failure", async () => {
  const initialTodayRequest = createDeferred<TaskSummaryDto[]>();
  const eventTodayRequest = createDeferred<TaskSummaryDto[]>();
  const unlisten = vi.fn();

  invokeMock.mockReset();
  listenMock.mockResolvedValue(unlisten);
  invokeMock.mockImplementation((command, args) => {
    if (command === "list_inbox") return Promise.resolve([]);
    if (command === "list_tasks") {
      const view = typeof args === "object" && args !== null && "view" in args ? args.view : null;
      if (view && typeof view === "object" && "kind" in view && view.kind === "today") {
        const requestCount = invokeMock.mock.calls.filter(([calledCommand, calledArgs]) => {
          return (
            calledCommand === "list_tasks" &&
            typeof calledArgs === "object" &&
            calledArgs !== null &&
            "view" in calledArgs &&
            typeof calledArgs.view === "object" &&
            calledArgs.view !== null &&
            "kind" in calledArgs.view &&
            calledArgs.view.kind === "today"
          );
        }).length;

        return requestCount === 1 ? initialTodayRequest.promise : eventTodayRequest.promise;
      }
    }

    return Promise.resolve([]);
  });
  const user = userEvent.setup();

  render(<App />);
  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Today" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith("list_tasks", { view: { kind: "today" } });
  });

  const mutationListener = listenMock.mock.calls[0]?.[1];
  if (!mutationListener) {
    throw new Error("Expected task mutation listener to be registered");
  }

  await act(async () => {
    mutationListener({} as never);
  });

  await waitFor(() => {
    expect(
      invokeMock.mock.calls.filter(
        ([command, args]) =>
          command === "list_tasks" &&
          typeof args === "object" &&
          args !== null &&
          "view" in args &&
          typeof args.view === "object" &&
          args.view !== null &&
          "kind" in args.view &&
          args.view.kind === "today",
      ),
    ).toHaveLength(2);
  });

  await act(async () => {
    initialTodayRequest.reject({
      code: "storage.unavailable",
      message_key: "errors.storage.unavailable",
    });
  });

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await act(async () => {
    eventTodayRequest.resolve([todaySummary]);
  });

  expect(await screen.findByText(todaySummary.title)).toBeInTheDocument();
});

it("keeps one active task mutation listener in StrictMode", async () => {
  const firstUnlisten = vi.fn();
  const secondUnlisten = vi.fn();
  const listeners: Array<(event: never) => void> = [];

  invokeMock.mockReset();
  listenMock.mockImplementation(async (_event, listener) => {
    listeners.push(listener as (event: never) => void);
    return listeners.length === 1 ? firstUnlisten : secondUnlisten;
  });
  invokeMock.mockImplementation((command) => {
    if (command === "list_inbox") return Promise.resolve([]);
    return Promise.resolve([]);
  });

  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  await waitFor(() => {
    expect(listeners).toHaveLength(2);
    expect(firstUnlisten).toHaveBeenCalledOnce();
  });
  const inboxRequestsBeforeEvent = invokeMock.mock.calls.filter(
    ([command]) => command === "list_inbox",
  ).length;

  await act(async () => {
    listeners[1]?.({} as never);
  });

  expect(invokeMock.mock.calls.filter(([command]) => command === "list_inbox")).toHaveLength(
    inboxRequestsBeforeEvent + 1,
  );
});

it("unlistens when task mutation listener registration finishes after unmount", async () => {
  const registration = createDeferred<() => void>();

  invokeMock.mockReset();
  listenMock.mockReturnValue(registration.promise);
  invokeMock.mockImplementation((command) => {
    if (command === "list_inbox") return Promise.resolve([]);
    return Promise.resolve([]);
  });

  const { unmount } = render(<App />);

  await waitFor(() => {
    expect(listenMock).toHaveBeenCalledWith("task://mutated", expect.any(Function));
  });
  const inboxRequestsBeforeUnmount = invokeMock.mock.calls.filter(
    ([command]) => command === "list_inbox",
  ).length;
  unmount();

  const unlisten = vi.fn();
  await act(async () => {
    registration.resolve(unlisten);
  });

  expect(unlisten).toHaveBeenCalledOnce();
  expect(invokeMock.mock.calls.filter(([command]) => command === "list_inbox")).toHaveLength(
    inboxRequestsBeforeUnmount,
  );
});

it("refreshes an open editor when task mutation listener registration completes late", async () => {
  const registration = createDeferred<() => void>();
  const unlisten = vi.fn();
  const user = userEvent.setup();

  invokeMock.mockReset();
  listenMock.mockReturnValue(registration.promise);
  invokeMock.mockImplementation((command) => {
    if (command === "list_inbox") return Promise.resolve([savedTask]);
    if (command === "list_projects") return Promise.resolve([]);
    if (command === "get_task_editor") return Promise.resolve(savedEditor);
    return Promise.resolve(savedTask);
  });

  render(<App />);

  await screen.findByText("Review schema");
  await user.click(screen.getByRole("button", { name: "Edit task Review schema" }));
  await screen.findByDisplayValue("Review schema");
  expect(invokeMock.mock.calls.filter(([command]) => command === "get_task_editor")).toHaveLength(
    1,
  );

  await act(async () => {
    registration.resolve(unlisten);
  });

  await waitFor(() => {
    expect(invokeMock.mock.calls.filter(([command]) => command === "get_task_editor")).toHaveLength(
      2,
    );
  });
});

it("refreshes the selected project after task mutations", async () => {
  const initialProjectRequest = createDeferred<TaskSummaryDto[]>();
  const eventProjectRequest = createDeferred<TaskSummaryDto[]>();
  const unlisten = vi.fn();
  const user = userEvent.setup();
  let projectRequestCount = 0;
  const eventProjectTask: TaskSummaryDto = {
    ...todaySummary,
    id: "event-project-task",
    projectName: "Release",
    title: "Refreshed project task",
  };

  invokeMock.mockReset();
  listenMock.mockResolvedValue(unlisten);
  invokeMock.mockImplementation((command, args) => {
    if (command === "list_inbox") return Promise.resolve([]);
    if (command === "list_projects") return Promise.resolve([releaseProject]);
    if (command === "list_tasks") {
      const view = typeof args === "object" && args !== null && "view" in args ? args.view : null;
      if (view && typeof view === "object" && "kind" in view && view.kind === "project") {
        projectRequestCount += 1;
        return projectRequestCount === 1
          ? initialProjectRequest.promise
          : eventProjectRequest.promise;
      }
    }

    return Promise.resolve([]);
  });

  render(<App />);
  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));
  await user.click(await screen.findByRole("button", { name: "Release" }));
  await waitFor(() => expect(projectRequestCount).toBe(1));

  const mutationListener = listenMock.mock.calls[0]?.[1];
  if (!mutationListener) {
    throw new Error("Expected task mutation listener to be registered");
  }

  await act(async () => {
    mutationListener({} as never);
  });
  await waitFor(() => expect(projectRequestCount).toBe(2));

  await act(async () => {
    initialProjectRequest.resolve([{ ...eventProjectTask, title: "Stale project task" }]);
  });

  expect(screen.queryByText("Stale project task")).not.toBeInTheDocument();

  await act(async () => {
    eventProjectRequest.resolve([eventProjectTask]);
  });

  expect(await screen.findByText("Refreshed project task")).toBeInTheDocument();
});

it("refreshes the current calendar month after task mutations and ignores older results", async () => {
  const currentDate = new Date();
  const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const nextDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthRequest = createDeferred<TaskSummaryDto[]>();
  const nextMonthRequest = createDeferred<TaskSummaryDto[]>();
  const eventMonthRequest = createDeferred<TaskSummaryDto[]>();
  const unlisten = vi.fn();
  const user = userEvent.setup();
  let calendarRequestCount = 0;
  const refreshedCalendarTask: TaskSummaryDto = {
    ...todaySummary,
    id: "event-calendar-task",
    scheduledAt: `${nextMonth}-12T04:00:00.000Z`,
    title: "Refreshed calendar task",
  };

  invokeMock.mockReset();
  listenMock.mockResolvedValue(unlisten);
  invokeMock.mockImplementation((command, args) => {
    if (command === "list_inbox") return Promise.resolve([]);
    if (command === "list_tasks") {
      const view = typeof args === "object" && args !== null && "view" in args ? args.view : null;
      if (view && typeof view === "object" && "kind" in view && view.kind === "calendar") {
        calendarRequestCount += 1;
        if (calendarRequestCount === 1) return currentMonthRequest.promise;
        if (calendarRequestCount === 2) return nextMonthRequest.promise;
        return eventMonthRequest.promise;
      }
    }

    return Promise.resolve([]);
  });

  render(<App />);
  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Calendar" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith("list_tasks", {
      view: { kind: "calendar", month: currentMonth },
    });
  });
  await user.click(screen.getByRole("button", { name: "Next month" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith("list_tasks", {
      view: { kind: "calendar", month: nextMonth },
    });
  });

  const mutationListener = listenMock.mock.calls[0]?.[1];
  if (!mutationListener) {
    throw new Error("Expected task mutation listener to be registered");
  }

  await act(async () => {
    mutationListener({} as never);
  });
  await waitFor(() => {
    expect(calendarRequestCount).toBe(3);
    expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", {
      view: { kind: "calendar", month: nextMonth },
    });
  });

  await act(async () => {
    currentMonthRequest.resolve([{ ...refreshedCalendarTask, title: "Stale current month task" }]);
    nextMonthRequest.reject({
      code: "storage.unavailable",
      message_key: "errors.storage.unavailable",
    });
  });

  expect(screen.queryByText("Stale current month task")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await act(async () => {
    eventMonthRequest.resolve([refreshedCalendarTask]);
  });

  expect(await screen.findByText("Refreshed calendar task")).toBeInTheDocument();
});

it("logs a rejected task mutation subscription without breaking the App", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  invokeMock.mockReset();
  listenMock.mockRejectedValue(new Error("event unavailable"));
  invokeMock.mockImplementation((command) => {
    if (command === "list_inbox") return Promise.resolve([]);
    return Promise.resolve([]);
  });

  render(<App />);

  expect(await screen.findByText("No tasks in inbox.")).toBeInTheDocument();
  await waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  consoleError.mockRestore();
});

it("refreshes an open editor from any task mutation event", async () => {
  const externallyChangedTask = {
    ...savedTask,
    revision: 2,
    title: "Review external migration",
    updatedAt: "2026-08-27T02:00:00Z",
  };
  const externallyChangedEditor = {
    subtasks: [{ ...savedTask, id: "subtask-1", title: "Verify external migration" }],
    tagNames: ["external-change"],
    task: externallyChangedTask,
  };
  const unlisten = vi.fn();
  const user = userEvent.setup();

  invokeMock.mockReset();
  listenMock.mockResolvedValue(unlisten);
  invokeMock.mockImplementation((command) => {
    if (command === "list_inbox") return Promise.resolve([savedTask]);
    if (command === "list_projects") return Promise.resolve([]);
    if (command === "get_task_editor") {
      const editorRequestCount = invokeMock.mock.calls.filter(([calledCommand]) => {
        return calledCommand === "get_task_editor";
      }).length;

      return Promise.resolve(editorRequestCount === 1 ? savedEditor : externallyChangedEditor);
    }
    if (command === "update_task_editor") return Promise.resolve(externallyChangedEditor);
    return Promise.resolve(savedTask);
  });

  render(<App />);

  await screen.findByText("Review schema");
  await user.click(screen.getByRole("button", { name: "Edit task Review schema" }));
  await screen.findByDisplayValue("Review schema");

  const mutationListener = listenMock.mock.calls[0]?.[1];
  if (!mutationListener) {
    throw new Error("Expected task mutation listener to be registered");
  }

  await act(async () => {
    mutationListener({} as never);
  });

  await waitFor(() => {
    expect(invokeMock.mock.calls.filter(([command]) => command === "get_task_editor")).toHaveLength(
      2,
    );
  });
  expect(await screen.findByDisplayValue("Review external migration")).toBeInTheDocument();
  expect(screen.getByText("external-change")).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "Complete task Verify external migration" }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Update task" }));

  expect(invokeMock).toHaveBeenCalledWith(
    "update_task_editor",
    expect.objectContaining({ expectedRevision: 2, id: savedTask.id }),
  );
});

it("refreshes the inbox with the saved task", async () => {
  const user = userEvent.setup();

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Add task" }));
  await user.type(screen.getByLabelText("Task title"), "Review schema");
  await user.click(screen.getByRole("button", { name: "Save task" }));

  expect(await screen.findByText("Review schema")).toBeInTheDocument();
  expect(invokeMock).toHaveBeenNthCalledWith(1, "list_inbox");
  expect(invokeMock).toHaveBeenNthCalledWith(2, "list_projects");
  expect(invokeMock).toHaveBeenNthCalledWith(3, "create_task_editor", {
    draft: {
      dueAt: null,
      note: "",
      priority: "Normal",
      projectId: null,
      recurrence: null,
      scheduledAt: null,
      title: "Review schema",
    },
    tagNames: [],
  });
  expect(invokeMock).toHaveBeenNthCalledWith(4, "list_inbox");
});

it("edits an existing task and renders the refreshed result", async () => {
  const user = userEvent.setup();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([savedTask])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(savedEditor)
    .mockResolvedValueOnce(updatedEditor)
    .mockResolvedValueOnce([updatedTask]);

  render(<App />);

  await screen.findByText("Review schema");
  await user.click(screen.getByRole("button", { name: "Edit task Review schema" }));

  const titleInput = screen.getByLabelText("Task title");
  const noteInput = screen.getByLabelText("Note");
  await user.clear(titleInput);
  await user.type(titleInput, "Review release");
  await user.type(noteInput, "Add migration result");
  await user.click(screen.getByRole("button", { name: "Update task" }));

  expect(invokeMock).toHaveBeenCalledWith("update_task_editor", {
    expectedRevision: 1,
    id: "task-1",
    patch: {
      dueAt: null,
      note: "Add migration result",
      priority: "Normal",
      projectId: null,
      recurrence: null,
      scheduledAt: null,
      title: "Review release",
    },
    tagNames: [],
  });
  expect(await screen.findByText("Review release")).toBeInTheDocument();
});

it("keeps the newer editor open when an earlier editor save resolves late", async () => {
  const secondTask = {
    ...savedTask,
    id: "task-2",
    title: "Prepare demo",
  };
  const secondEditor = {
    ...savedEditor,
    task: secondTask,
  };
  const saveFirstEditor = createDeferred<typeof savedEditor>();
  invokeMock.mockReset();
  invokeMock.mockImplementation((command, args) => {
    if (command === "list_inbox") return Promise.resolve([savedTask, secondTask]);
    if (command === "list_projects") return Promise.resolve([]);
    if (command === "get_task_editor") {
      const taskId = typeof args === "object" && args !== null && "id" in args ? args.id : null;
      return Promise.resolve(taskId === "task-2" ? secondEditor : savedEditor);
    }
    if (command === "update_task_editor") return saveFirstEditor.promise;
    return Promise.resolve(savedTask);
  });
  const user = userEvent.setup();

  render(<App />);

  await screen.findByText("Review schema");
  await user.click(screen.getByRole("button", { name: "Edit task Review schema" }));
  await screen.findByDisplayValue("Review schema");
  await user.click(screen.getByRole("button", { name: "Update task" }));
  await user.click(screen.getByRole("button", { name: "Edit task Prepare demo" }));
  expect(await screen.findByDisplayValue("Prepare demo")).toBeInTheDocument();

  await act(async () => {
    saveFirstEditor.resolve(savedEditor);
  });

  expect(screen.getByDisplayValue("Prepare demo")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Update task" })).toBeInTheDocument();
});

it("does not reload or close a newer editor after an earlier subtask completion resolves late", async () => {
  const secondTask = {
    ...savedTask,
    id: "task-2",
    title: "Prepare demo",
  };
  const firstEditor = {
    ...savedEditor,
    subtasks: [{ ...savedTask, id: "subtask-1", title: "Confirm owners" }],
  };
  const secondEditor = {
    ...savedEditor,
    task: secondTask,
  };
  const completeFirstSubtask = createDeferred<typeof savedTask>();
  invokeMock.mockReset();
  invokeMock.mockImplementation((command, args) => {
    if (command === "list_inbox") return Promise.resolve([savedTask, secondTask]);
    if (command === "list_projects") return Promise.resolve([]);
    if (command === "get_task_editor") {
      const taskId = typeof args === "object" && args !== null && "id" in args ? args.id : null;
      return Promise.resolve(taskId === "task-2" ? secondEditor : firstEditor);
    }
    if (command === "complete_task") return completeFirstSubtask.promise;
    return Promise.resolve(savedTask);
  });
  const user = userEvent.setup();

  render(<App />);

  await screen.findByText("Review schema");
  await user.click(screen.getByRole("button", { name: "Edit task Review schema" }));
  await screen.findByRole("checkbox", { name: "Complete task Confirm owners" });
  await user.click(screen.getByRole("checkbox", { name: "Complete task Confirm owners" }));
  await user.click(screen.getByRole("button", { name: "Edit task Prepare demo" }));
  expect(await screen.findByDisplayValue("Prepare demo")).toBeInTheDocument();

  await act(async () => {
    completeFirstSubtask.resolve(savedTask);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByDisplayValue("Prepare demo")).toBeInTheDocument();
  expect(invokeMock.mock.calls.filter(([command]) => command === "get_task_editor")).toHaveLength(
    2,
  );
});

it("renders the Inbox ledger and real overview from one inbox request", async () => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([
    savedTask,
    {
      ...savedTask,
      dueAt: "2026-08-29T09:00:00Z",
      id: "task-2",
      projectId: "project-1",
      title: "Publish release",
    },
  ]);

  render(<App />);

  expect(await screen.findByRole("list", { name: "Inbox" })).toHaveClass("task-ledger");
  expect(screen.getByRole("complementary", { name: "Inbox overview" })).toBeInTheDocument();
  expect(invokeMock).toHaveBeenCalledTimes(1);
  expect(invokeMock).toHaveBeenCalledWith("list_inbox");
});

it("reuses the inbox request when StrictMode replays the loading effect", async () => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([savedTask]);

  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  expect(await screen.findByRole("list", { name: "Inbox" })).toBeInTheDocument();
  expect(invokeMock).toHaveBeenCalledTimes(1);
  expect(invokeMock).toHaveBeenCalledWith("list_inbox");
});

it("keeps the latest Inbox ledger and overview after an older Inbox request resolves", async () => {
  const user = userEvent.setup();
  const initialInboxRequest = createDeferred<(typeof savedTask)[]>();
  const returnedInboxRequest = createDeferred<(typeof savedTask)[]>();

  invokeMock.mockReset();
  invokeMock
    .mockImplementationOnce(() => initialInboxRequest.promise)
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => returnedInboxRequest.promise);

  render(<App />);

  await waitFor(() => {
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_inbox");
  });
  await user.click(screen.getByRole("button", { name: "Today" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_tasks", { view: { kind: "today" } });
  });
  await user.click(screen.getByRole("button", { name: "Inbox" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenNthCalledWith(3, "list_inbox");
  });

  await act(async () => {
    returnedInboxRequest.resolve([]);
  });

  expect(await screen.findByText("No tasks in inbox.")).toBeInTheDocument();
  expect(
    within(screen.getByRole("complementary", { name: "Inbox overview" })).getByText(
      "No task details available.",
    ),
  ).toBeInTheDocument();

  await act(async () => {
    initialInboxRequest.resolve([savedTask]);
  });

  expect(screen.queryByText("Review schema")).not.toBeInTheDocument();
  expect(screen.getByText("No tasks in inbox.")).toBeInTheDocument();
  expect(
    within(screen.getByRole("complementary", { name: "Inbox overview" })).getByText(
      "No task details available.",
    ),
  ).toBeInTheDocument();
});

it("keeps the latest Inbox ledger and overview after an older Inbox request rejects", async () => {
  const user = userEvent.setup();
  const initialInboxRequest = createDeferred<(typeof savedTask)[]>();
  const returnedInboxRequest = createDeferred<(typeof savedTask)[]>();

  invokeMock.mockReset();
  invokeMock
    .mockImplementationOnce(() => initialInboxRequest.promise)
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => returnedInboxRequest.promise);

  render(<App />);

  await waitFor(() => {
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_inbox");
  });
  await user.click(screen.getByRole("button", { name: "Today" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_tasks", { view: { kind: "today" } });
  });
  await user.click(screen.getByRole("button", { name: "Inbox" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenNthCalledWith(3, "list_inbox");
  });

  await act(async () => {
    returnedInboxRequest.resolve([]);
  });

  expect(await screen.findByText("No tasks in inbox.")).toBeInTheDocument();
  expect(
    within(screen.getByRole("complementary", { name: "Inbox overview" })).getByText(
      "No task details available.",
    ),
  ).toBeInTheDocument();

  await act(async () => {
    initialInboxRequest.reject({
      code: "storage.unavailable",
      message_key: "errors.storage.unavailable",
    });
  });

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("No tasks in inbox.")).toBeInTheDocument();
  expect(
    within(screen.getByRole("complementary", { name: "Inbox overview" })).getByText(
      "No task details available.",
    ),
  ).toBeInTheDocument();
});

it("shows Today schedule facts in chronological order", async () => {
  const user = userEvent.setup();
  const earlier = { ...todaySummary, scheduledAt: "2026-08-29T09:00:00Z", title: "Earlier" };
  const later = {
    ...todaySummary,
    dueAt: "2026-08-29T12:00:00Z",
    id: "today-later",
    title: "Later",
  };

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce([later, earlier]);

  render(<App />);
  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Today" }));

  const aside = await screen.findByRole("complementary", { name: "Schedule overview" });
  const timeline = within(aside).getByRole("list", { name: "Schedule overview" });

  expect(
    within(timeline)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([expect.stringContaining("Earlier"), expect.stringContaining("Later")]);
});

it("completes a selected project task and refreshes only that project ledger", async () => {
  const user = userEvent.setup();
  const projectSummary: TaskSummaryDto = {
    ...todaySummary,
    id: "release-task",
    projectName: "Release",
    title: "Publish release notes",
  };

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([releaseProject])
    .mockResolvedValueOnce([projectSummary])
    .mockResolvedValueOnce(savedTask)
    .mockResolvedValueOnce([]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));
  await user.click(await screen.findByRole("button", { name: "Release" }));

  expect(await screen.findByText("Publish release notes")).toBeInTheDocument();
  expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", {
    view: { kind: "project", projectId: "project-1" },
  });

  await user.click(screen.getByRole("button", { name: "Complete task Publish release notes" }));

  expect(invokeMock).toHaveBeenCalledWith("complete_task", { id: "release-task" });
  await screen.findByText("No tasks in this view.");
  expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", {
    view: { kind: "project", projectId: "project-1" },
  });
});

it("does not refresh Inbox when a project task mutation resolves after leaving Projects", async () => {
  const user = userEvent.setup();
  const updateRequest = createDeferred<typeof savedTask>();
  const projectSummary: TaskSummaryDto = {
    ...todaySummary,
    id: "release-task",
    projectName: "Release",
    title: "Publish release notes",
  };

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([releaseProject])
    .mockResolvedValueOnce([projectSummary])
    .mockImplementationOnce(() => updateRequest.promise)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));
  await user.click(await screen.findByRole("button", { name: "Release" }));
  await user.click(screen.getByRole("button", { name: "Complete task Publish release notes" }));
  await user.click(screen.getByRole("button", { name: "Inbox" }));
  await screen.findByText("No tasks in inbox.");

  await act(async () => {
    updateRequest.resolve(savedTask);
  });

  expect(invokeMock.mock.calls.filter(([command]) => command === "list_inbox")).toHaveLength(2);
});

it("opens the Inbox editor from the global navigation command", async () => {
  const user = userEvent.setup();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([releaseProject])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));
  await screen.findByRole("button", { name: "Release" });
  await user.click(screen.getByRole("button", { name: "Add task" }));

  expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
  expect(screen.getByLabelText("Task title")).toBeInTheDocument();
});

it("shows a neutral project workspace prompt before a project is selected", async () => {
  const user = userEvent.setup();

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce([releaseProject]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));

  expect(await screen.findByText("Select a project to view its tasks.")).toBeInTheDocument();
});

it("keeps the search command in the global workspace bar", async () => {
  const user = userEvent.setup();

  render(<App />);

  await screen.findByText("No tasks in inbox.");

  const searchButton = screen.getByRole("button", { name: "Search" });

  expect(searchButton).toHaveClass("workspace-bar__search");
  await user.click(searchButton);
  expect(screen.getByRole("searchbox", { name: "Search tasks" })).toBeInTheDocument();
});

it("renders a named workspace bar and a separate main canvas", async () => {
  render(<App />);

  await screen.findByText("No tasks in inbox.");

  expect(screen.getByRole("banner", { name: "Workspace" })).toHaveClass("workspace-bar");
  expect(screen.getByRole("main")).toHaveClass("workspace-canvas");
  expect(screen.getByRole("navigation", { name: "Primary navigation" })).toHaveClass(
    "navigation-rail",
  );
});

it("uses the project and selected-project headings instead of a generic project content heading", async () => {
  const user = userEvent.setup();

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce([releaseProject]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));

  expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "TaskDock" })).not.toBeInTheDocument();
});

it("does not expose a selected project's storage identifier in the workspace metadata", async () => {
  const user = userEvent.setup();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([releaseProject])
    .mockResolvedValueOnce([]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));
  await user.click(await screen.findByRole("button", { name: "Release" }));

  expect(screen.queryByText("project-", { exact: false })).not.toBeInTheDocument();
});

it("requests the exact calendar month when navigating and moving to the next month", async () => {
  const user = userEvent.setup();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Calendar" }));

  expect(await screen.findByRole("heading", { name: "Calendar" })).toBeInTheDocument();
  expect(invokeMock).toHaveBeenCalledWith("list_tasks", {
    view: { kind: "calendar", month: currentMonth },
  });

  await user.click(screen.getByRole("button", { name: "Next month" }));

  expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", {
    view: { kind: "calendar", month: nextMonth },
  });
});

it("renders a pending calendar request inside the Calendar section", async () => {
  const user = userEvent.setup();
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const calendarRequest = createDeferred<TaskSummaryDto[]>();

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockImplementationOnce(() => calendarRequest.promise);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Calendar" }));

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith("list_tasks", {
      view: { kind: "calendar", month: currentMonth },
    });
  });

  const calendarSection = screen.getByRole("region", { name: "Calendar" });

  expect(within(calendarSection).getByRole("status")).toHaveTextContent("Loading tasks...");
  expect(invokeMock).toHaveBeenCalledWith("list_tasks", {
    view: { kind: "calendar", month: currentMonth },
  });
});

it("renders a rejected calendar request inside the Calendar section", async () => {
  const user = userEvent.setup();
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockRejectedValueOnce({
    code: "storage.unavailable",
    message_key: "errors.storage.unavailable",
  });

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Calendar" }));

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith("list_tasks", {
      view: { kind: "calendar", month: currentMonth },
    });
  });

  const calendarSection = screen.getByRole("region", { name: "Calendar" });
  const alert = await within(calendarSection).findByRole("alert");

  expect(alert).toHaveTextContent("Local storage is temporarily unavailable");
  expect(invokeMock).toHaveBeenCalledWith("list_tasks", {
    view: { kind: "calendar", month: currentMonth },
  });
});

it("keeps only the latest calendar month response during rapid month changes", async () => {
  const user = userEvent.setup();
  const currentDate = new Date();
  const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const nextDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthRequest = createDeferred<TaskSummaryDto[]>();
  const nextMonthRequest = createDeferred<TaskSummaryDto[]>();
  const currentMonthTask: TaskSummaryDto = {
    ...todaySummary,
    id: "current-calendar-task",
    scheduledAt: `${currentMonth}-12T04:00:00.000Z`,
    title: "Current calendar task",
  };
  const nextMonthTask: TaskSummaryDto = {
    ...todaySummary,
    id: "next-calendar-task",
    scheduledAt: `${nextMonth}-12T04:00:00.000Z`,
    title: "Next calendar task",
  };

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => currentMonthRequest.promise)
    .mockImplementationOnce(() => nextMonthRequest.promise);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Calendar" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_tasks", {
      view: { kind: "calendar", month: currentMonth },
    });
  });
  await user.click(screen.getByRole("button", { name: "Next month" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenNthCalledWith(3, "list_tasks", {
      view: { kind: "calendar", month: nextMonth },
    });
  });

  await act(async () => {
    currentMonthRequest.resolve([currentMonthTask]);
  });

  expect(screen.queryByText("Current calendar task")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: formatMonthHeading(nextDate) })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading tasks...");

  await act(async () => {
    nextMonthRequest.resolve([nextMonthTask]);
  });

  expect(await screen.findByText("Next calendar task")).toBeInTheDocument();
  expect(screen.queryByText("Current calendar task")).not.toBeInTheDocument();
});

it("ignores a calendar response and error after leaving the calendar", async () => {
  const user = userEvent.setup();
  const firstCalendarRequest = createDeferred<TaskSummaryDto[]>();
  const secondCalendarRequest = createDeferred<TaskSummaryDto[]>();
  const currentDate = new Date();
  const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const nextDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
  const calendarTask: TaskSummaryDto = {
    ...todaySummary,
    id: "late-calendar-task",
    scheduledAt: `${currentMonth}-12T04:00:00.000Z`,
    title: "Late calendar task",
  };

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => firstCalendarRequest.promise)
    .mockImplementationOnce(() => secondCalendarRequest.promise)
    .mockResolvedValueOnce([]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Calendar" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_tasks", {
      view: { kind: "calendar", month: currentMonth },
    });
  });
  await user.click(screen.getByRole("button", { name: "Next month" }));
  await waitFor(() => {
    expect(invokeMock).toHaveBeenNthCalledWith(3, "list_tasks", {
      view: { kind: "calendar", month: nextMonth },
    });
  });
  await user.click(screen.getByRole("button", { name: "Today" }));
  await screen.findByText("No tasks in this view.");

  await act(async () => {
    firstCalendarRequest.resolve([calendarTask]);
    secondCalendarRequest.reject({
      code: "storage.unavailable",
      message_key: "errors.storage.unavailable",
    });
  });

  expect(screen.queryByText("Late calendar task")).not.toBeInTheDocument();
  expect(screen.queryByText("Local storage is temporarily unavailable")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
});

it("updates the selected project detail title after a rename", async () => {
  const user = userEvent.setup();
  const renamedProject = { ...releaseProject, name: "Release notes" };

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([releaseProject])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(renamedProject)
    .mockResolvedValueOnce([renamedProject]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));
  await user.click(await screen.findByRole("button", { name: "Release" }));
  await user.click(screen.getByRole("button", { name: "Rename Release" }));
  const renameInput = screen.getByLabelText("Rename Release");
  await user.clear(renameInput);
  await user.type(renameInput, "Release notes");
  await user.click(screen.getByRole("button", { name: "Save project name" }));

  expect(await screen.findByRole("heading", { name: "Release notes" })).toBeInTheDocument();
});

it("clears a selected project after it is archived", async () => {
  const user = userEvent.setup();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([releaseProject])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce({ ...releaseProject, archivedAt: "2026-08-28T01:00:00Z" })
    .mockResolvedValueOnce([]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));
  await user.click(await screen.findByRole("button", { name: "Release" }));
  await user.click(screen.getByRole("button", { name: "Archive Release" }));

  expect(screen.queryByRole("heading", { name: "Release" })).not.toBeInTheDocument();
  expect(screen.queryByRole("status", { name: "Loading tasks..." })).not.toBeInTheDocument();
});

it("keeps a selected project ready when it is selected again", async () => {
  const user = userEvent.setup();
  const projectSummary: TaskSummaryDto = {
    ...todaySummary,
    id: "release-task",
    projectName: "Release",
    title: "Publish release notes",
  };

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([releaseProject])
    .mockResolvedValueOnce([projectSummary]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));
  const projectButton = await screen.findByRole("button", { name: "Release" });
  await user.click(projectButton);
  await screen.findByText("Publish release notes");
  await user.click(projectButton);

  expect(screen.queryByRole("status", { name: "Loading tasks..." })).not.toBeInTheDocument();
  expect(invokeMock).toHaveBeenCalledTimes(3);
});

it("reloads a selected project summary after returning to Projects", async () => {
  const user = userEvent.setup();
  const projectSummary: TaskSummaryDto = {
    ...todaySummary,
    id: "release-task",
    projectName: "Release",
    title: "Publish release notes",
  };

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([releaseProject])
    .mockResolvedValueOnce([projectSummary])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([releaseProject])
    .mockResolvedValueOnce([projectSummary]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));
  await user.click(await screen.findByRole("button", { name: "Release" }));
  await screen.findByText("Publish release notes");
  await user.click(screen.getByRole("button", { name: "Inbox" }));
  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Projects" }));

  expect(await screen.findByText("Publish release notes")).toBeInTheDocument();
  expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", {
    view: { kind: "project", projectId: "project-1" },
  });
});

it("persists completion before rendering the refreshed empty inbox", async () => {
  const user = userEvent.setup();
  const completedTask = {
    ...savedTask,
    completedAt: "2026-08-27T02:00:00Z",
    updatedAt: "2026-08-27T02:00:00Z",
  };

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([savedTask])
    .mockResolvedValueOnce(completedTask)
    .mockResolvedValueOnce([]);

  render(<App />);

  await screen.findByText("Review schema");
  await user.click(screen.getByRole("checkbox", { name: "Complete task task-1" }));

  expect(invokeMock).toHaveBeenCalledWith("complete_task", { id: "task-1" });
  expect(await screen.findByText("No tasks in inbox.")).toBeInTheDocument();
});

it("restores a completed task and shows it again in the inbox", async () => {
  const user = userEvent.setup();
  const completedSummary = {
    childCompleted: 0,
    childTotal: 0,
    completed: true,
    dueAt: null,
    id: "task-1",
    priority: "Normal",
    projectName: null,
    scheduledAt: null,
    tags: [],
    title: "Review schema",
  };
  const completedTask = {
    ...savedTask,
    completedAt: "2026-08-27T02:00:00Z",
    updatedAt: "2026-08-27T02:00:00Z",
  };

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([savedTask])
    .mockResolvedValueOnce(completedTask)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([completedSummary])
    .mockResolvedValueOnce(savedTask)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([savedTask]);

  render(<App />);

  await user.click(await screen.findByRole("checkbox", { name: "Complete task task-1" }));
  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Completed" }));
  const restoreButton = await screen.findByRole("button", { name: "Restore task Review schema" });

  expect(restoreButton).toHaveClass("task-ledger-row__toggle");
  await user.click(restoreButton);

  expect(invokeMock).toHaveBeenCalledWith("update_task", {
    id: "task-1",
    patch: { completedAt: null },
  });

  await user.click(screen.getByRole("button", { name: "Inbox" }));

  expect(await screen.findByText("Review schema")).toBeInTheDocument();
  expect(invokeMock).toHaveBeenCalledWith("list_tasks", { view: { kind: "completed" } });
  expect(invokeMock).toHaveBeenLastCalledWith("list_inbox");
});

it("keeps completion unchecked and reports a structured already-completed failure", async () => {
  const user = userEvent.setup();

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([savedTask]).mockRejectedValueOnce({
    code: "task.already_completed",
    message_key: "errors.task.already_completed",
  });

  render(<App />);

  const completionCheckbox = await screen.findByRole("checkbox", {
    name: "Complete task task-1",
  });
  await user.click(completionCheckbox);

  expect(invokeMock).toHaveBeenCalledWith("complete_task", { id: "task-1" });
  expect(await screen.findByRole("alert")).toHaveTextContent("This task is already completed.");
  expect(completionCheckbox).not.toBeChecked();
});

it("keeps a deferred summary request scoped to the current view during rapid navigation", async () => {
  const user = userEvent.setup();
  const todayRequest = createDeferred<TaskSummaryDto[]>();
  const upcomingRequest = createDeferred<TaskSummaryDto[]>();
  const completedRequest = createDeferred<TaskSummaryDto[]>();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => todayRequest.promise)
    .mockImplementationOnce(() => upcomingRequest.promise)
    .mockImplementationOnce(() => completedRequest.promise);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Today" }));
  await user.click(screen.getByRole("button", { name: "Upcoming" }));
  await user.click(screen.getByRole("button", { name: "Completed" }));

  expect(
    within(screen.getByRole("region", { name: "Task ledger" })).getByRole("status"),
  ).toHaveTextContent("Loading tasks...");

  await act(async () => {
    todayRequest.resolve([todaySummary]);
    upcomingRequest.resolve([upcomingSummary]);
  });

  expect(screen.queryByText("Today-only task")).not.toBeInTheDocument();
  expect(screen.queryByText("Upcoming-only task")).not.toBeInTheDocument();

  await act(async () => {
    completedRequest.resolve([completedSummary]);
  });

  expect(await screen.findByText("Completed-only task")).toBeInTheDocument();
});

it("shows a current summary request error without a loading announcement", async () => {
  const user = userEvent.setup();

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockRejectedValueOnce({
    code: "storage.unavailable",
    message_key: "errors.storage.unavailable",
  });

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Today" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Local storage is temporarily unavailable",
  );
  expect(
    within(screen.getByRole("region", { name: "Task ledger" })).queryByRole("status"),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("complementary", { name: "Schedule overview" })).getByRole("status"),
  ).toHaveTextContent("Task details are unavailable.");
});

it("does not show a completed-view mutation failure after navigation and disables repeat restore", async () => {
  const user = userEvent.setup();
  const restoreRequest = createDeferred<typeof savedTask>();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([completedSummary])
    .mockImplementationOnce(() => restoreRequest.promise)
    .mockResolvedValueOnce([]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Completed" }));
  const restoreButton = await screen.findByRole("button", {
    name: "Restore task Completed-only task",
  });
  await user.click(restoreButton);

  expect(restoreButton).toBeDisabled();
  expect(invokeMock).toHaveBeenCalledTimes(3);

  await user.click(screen.getByRole("button", { name: "Today" }));
  await screen.findByText("No tasks in this view.");

  await act(async () => {
    restoreRequest.reject({
      code: "storage.unavailable",
      message_key: "errors.storage.unavailable",
    });
  });

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("refreshes Inbox after a completed-view restore succeeds during navigation", async () => {
  const user = userEvent.setup();
  const restoreRequest = createDeferred<typeof savedTask>();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([completedSummary])
    .mockImplementationOnce(() => restoreRequest.promise)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([savedTask]);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Completed" }));
  await user.click(await screen.findByRole("button", { name: "Restore task Completed-only task" }));
  await user.click(screen.getByRole("button", { name: "Inbox" }));
  await screen.findByText("No tasks in inbox.");

  await act(async () => {
    restoreRequest.resolve(savedTask);
  });

  expect(await screen.findByText("Review schema")).toBeInTheDocument();
  expect(invokeMock).toHaveBeenLastCalledWith("list_inbox");
});

it("refreshes Completed after an inbox completion succeeds during navigation", async () => {
  const user = userEvent.setup();
  const completedTask = {
    ...savedTask,
    completedAt: "2026-08-27T02:00:00Z",
    updatedAt: "2026-08-27T02:00:00Z",
  };
  const completionRequest = createDeferred<typeof completedTask>();
  const completedSavedSummary: TaskSummaryDto = {
    ...completedSummary,
    id: "task-1",
    title: "Review schema",
  };

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([savedTask])
    .mockImplementationOnce(() => completionRequest.promise)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([completedSavedSummary]);

  render(<App />);

  await user.click(await screen.findByRole("checkbox", { name: "Complete task task-1" }));
  await user.click(screen.getByRole("button", { name: "Completed" }));
  await screen.findByText("No tasks in this view.");

  await act(async () => {
    completionRequest.resolve(completedTask);
  });

  expect(await screen.findByText("Review schema")).toBeInTheDocument();
  expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", { view: { kind: "completed" } });
});

it("hides a ready Today summary immediately when switching to Upcoming", async () => {
  const user = userEvent.setup();
  const upcomingRequest = createDeferred<TaskSummaryDto[]>();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([todaySummary])
    .mockImplementationOnce(() => upcomingRequest.promise);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Today" }));
  await screen.findByText("Today-only task");
  await user.click(screen.getByRole("button", { name: "Upcoming" }));

  expect(screen.queryByText("Today-only task")).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Task ledger" })).getByRole("status"),
  ).toHaveTextContent("Loading tasks...");
});

it("hides a Today request error immediately when switching to Upcoming", async () => {
  const user = userEvent.setup();
  const upcomingRequest = createDeferred<TaskSummaryDto[]>();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce({
      code: "storage.unavailable",
      message_key: "errors.storage.unavailable",
    })
    .mockImplementationOnce(() => upcomingRequest.promise);

  render(<App />);

  await screen.findByText("No tasks in inbox.");
  await user.click(screen.getByRole("button", { name: "Today" }));
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Upcoming" }));

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Task ledger" })).getByRole("status"),
  ).toHaveTextContent("Loading tasks...");
});

it("opens global search with Ctrl+K, debounces the strict search query, and shows completion state", async () => {
  const user = userEvent.setup();
  const searchResult: TaskSummaryDto = {
    ...completedSummary,
    id: "search-result",
    title: "Release checklist",
  };

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce([searchResult]);

  render(<App />);
  await screen.findByText("No tasks in inbox.");

  await user.keyboard("{Control>}k{/Control}");

  const input = screen.getByRole("searchbox", { name: "Search tasks" });
  expect(input).toHaveFocus();
  await user.type(input, "  release  ");

  expect(invokeMock).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => window.setTimeout(resolve, 220));

  expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", {
    view: { kind: "search", query: "release" },
  });
  expect(await screen.findByText("Release checklist")).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByText("Completed")).toBeInTheDocument();
});

it("waits exactly 200ms before sending a search request", async () => {
  const searchResult: TaskSummaryDto = {
    ...completedSummary,
    id: "timed-search-result",
    title: "Release checklist",
  };

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce([searchResult]);

  render(<App />);
  await screen.findByText("No tasks in inbox.");

  vi.useFakeTimers();

  try {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }),
      );
    });

    const input = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(input, { target: { value: "release" } });

    act(() => {
      vi.advanceTimersByTime(199);
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", {
      view: { kind: "search", query: "release" },
    });
  } finally {
    vi.useRealTimers();
  }
});

it("does not query blank search input and ignores a deferred result after closing", async () => {
  const user = userEvent.setup();
  const searchRequest = createDeferred<TaskSummaryDto[]>();

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockImplementationOnce(() => searchRequest.promise);

  render(<App />);
  await screen.findByText("No tasks in inbox.");
  await user.keyboard("{Control>}k{/Control}");

  const input = screen.getByRole("searchbox", { name: "Search tasks" });
  await user.type(input, "   ");
  await new Promise((resolve) => window.setTimeout(resolve, 220));
  expect(invokeMock).toHaveBeenCalledTimes(1);

  await user.clear(input);
  await user.type(input, "release");
  await new Promise((resolve) => window.setTimeout(resolve, 220));
  await user.keyboard("{Escape}");

  await act(async () => {
    searchRequest.resolve([completedSummary]);
  });

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("Completed-only task")).not.toBeInTheDocument();
});

it("opens global search with Meta+K", async () => {
  render(<App />);

  await screen.findByText("No tasks in inbox.");

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "k", metaKey: true }),
    );
  });

  expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveFocus();
});

it("keeps only the latest search response after the query changes", async () => {
  const firstSearchRequest = createDeferred<TaskSummaryDto[]>();
  const secondSearchRequest = createDeferred<TaskSummaryDto[]>();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => firstSearchRequest.promise)
    .mockImplementationOnce(() => secondSearchRequest.promise);

  render(<App />);
  await screen.findByText("No tasks in inbox.");

  vi.useFakeTimers();

  try {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }),
      );
    });

    const input = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(input, { target: { value: "release" } });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", {
      view: { kind: "search", query: "release" },
    });

    fireEvent.change(input, { target: { value: "schema" } });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", {
      view: { kind: "search", query: "schema" },
    });

    await act(async () => {
      firstSearchRequest.resolve([completedSummary]);
    });

    expect(screen.queryByText("Completed-only task")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      secondSearchRequest.resolve([todaySummary]);
    });

    expect(screen.getByText("Today-only task")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("ignores an older search failure after the query changes", async () => {
  const firstSearchRequest = createDeferred<TaskSummaryDto[]>();
  const secondSearchRequest = createDeferred<TaskSummaryDto[]>();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => firstSearchRequest.promise)
    .mockImplementationOnce(() => secondSearchRequest.promise);

  render(<App />);
  await screen.findByText("No tasks in inbox.");

  vi.useFakeTimers();

  try {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }),
      );
    });

    const input = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(input, { target: { value: "release" } });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    fireEvent.change(input, { target: { value: "schema" } });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    await act(async () => {
      firstSearchRequest.reject({
        code: "storage.unavailable",
        message_key: "errors.storage.unavailable",
      });
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      secondSearchRequest.resolve([todaySummary]);
    });

    expect(screen.getByText("Today-only task")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("ignores a deferred search failure after closing", async () => {
  const searchRequest = createDeferred<TaskSummaryDto[]>();

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([]).mockImplementationOnce(() => searchRequest.promise);

  render(<App />);
  await screen.findByText("No tasks in inbox.");

  vi.useFakeTimers();

  try {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }),
      );
    });

    const input = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(input, { target: { value: "release" } });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    fireEvent.keyDown(input, { key: "Escape" });

    await act(async () => {
      searchRequest.reject({
        code: "storage.unavailable",
        message_key: "errors.storage.unavailable",
      });
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("renders translated navigation and editor controls for a Chinese browser language", async () => {
  const user = userEvent.setup();
  const restoreNavigatorLanguage = setNavigatorLanguage("zh-TW");

  try {
    document.documentElement.lang = "unset";
    await loadMainWithMockedReactRoot();

    expect(document.documentElement.lang).toBe("zh-CN");

    render(<App />);

    await screen.findByText("收件箱没有任务。");
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建任务" }));
    expect(screen.getByLabelText("任务标题")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存任务" })).toBeInTheDocument();
  } finally {
    restoreNavigatorLanguage();
  }
});

it("sets the root document language to the English fallback", async () => {
  const restoreNavigatorLanguage = setNavigatorLanguage("fr-FR");

  try {
    document.documentElement.lang = "unset";
    await loadMainWithMockedReactRoot();

    expect(document.documentElement.lang).toBe("en-US");
  } finally {
    restoreNavigatorLanguage();
  }
});
