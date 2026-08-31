import { invoke } from "@tauri-apps/api/core";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import type { TaskSummaryDto } from "../features/tasks/taskTypes";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
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
};

const updatedTask = {
  ...savedTask,
  title: "Review release",
  note: "Add migration result",
  updatedAt: "2026-08-27T01:00:00Z",
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
  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(savedTask)
    .mockResolvedValueOnce([savedTask]);
});

afterEach(() => {
  cleanup();
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
  expect(invokeMock).toHaveBeenNthCalledWith(3, "create_task", {
    draft: { title: "Review schema", note: "" },
  });
  expect(invokeMock).toHaveBeenNthCalledWith(4, "list_inbox");
});

it("edits an existing task and renders the refreshed result", async () => {
  const user = userEvent.setup();

  invokeMock.mockReset();
  invokeMock
    .mockResolvedValueOnce([savedTask])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(updatedTask)
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

  expect(invokeMock).toHaveBeenCalledWith("update_task", {
    id: "task-1",
    patch: { title: "Review release", note: "Add migration result" },
  });
  expect(await screen.findByText("Review release")).toBeInTheDocument();
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

  expect(invokeMock).toHaveBeenCalledWith("update_task", {
    id: "release-task",
    patch: { completedAt: expect.any(String) },
  });
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
  expect(screen.queryByRole("heading", { name: "Todo" })).not.toBeInTheDocument();
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

  expect(invokeMock).toHaveBeenCalledWith("update_task", {
    id: "task-1",
    patch: { completedAt: expect.any(String) },
  });
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

it("keeps completion unchecked and reports a structured update failure", async () => {
  const user = userEvent.setup();

  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce([savedTask]).mockRejectedValueOnce({
    code: "storage.unavailable",
    message_key: "errors.storage.unavailable",
  });

  render(<App />);

  const completionCheckbox = await screen.findByRole("checkbox", {
    name: "Complete task task-1",
  });
  await user.click(completionCheckbox);

  expect(invokeMock).toHaveBeenCalledWith("update_task", {
    id: "task-1",
    patch: { completedAt: expect.any(String) },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Local storage is temporarily unavailable",
  );
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
