import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import appStyles from "../../App.css?raw";
import TaskViewInsights from "./TaskViewInsights";

afterEach(() => {
  cleanup();
});

it("announces loading task details with a status role", () => {
  render(<TaskViewInsights items={[]} status="loading" view="inbox" />);

  expect(screen.getByRole("status")).toHaveTextContent("Loading tasks...");
});

it("announces empty task details with a status role", () => {
  render(<TaskViewInsights items={[]} status="ready" view="inbox" />);

  expect(screen.getByRole("status")).toHaveTextContent("No task details available.");
});

it("announces unavailable task details with a status role", () => {
  render(<TaskViewInsights items={[]} status="error" view="inbox" />);

  expect(screen.getByRole("status")).toHaveTextContent("Task details are unavailable.");
});

it("uses the space-unit grid for insight lists and ledger rows", () => {
  expect(appStyles).toMatch(
    /\.task-view-insights__timeline,\s*\.task-view-insights__projects ul\s*\{[\s\S]*?gap: calc\(var\(--space-unit\) \* 3\);/,
  );
  expect(appStyles).toMatch(
    /\.task-ledger-row__status\s*\{[\s\S]*?padding: var\(--space-unit\) calc\(var\(--space-unit\) \* 2\);/,
  );
  expect(appStyles).toMatch(
    /@media \(max-width: 760px\) \{[\s\S]*?\.task-ledger-row\s*\{[\s\S]*?padding: calc\(var\(--space-unit\) \* 2\);/,
  );
});

it("summarizes inbox counts from date and project associations", () => {
  render(
    <TaskViewInsights
      items={[
        {
          completed: false,
          dueAt: null,
          id: "capture",
          projectLabel: null,
          scheduledAt: null,
          title: "Capture",
        },
        {
          completed: false,
          dueAt: "2026-08-29T09:00:00Z",
          id: "review",
          projectLabel: "Assigned to a project",
          scheduledAt: null,
          title: "Review",
        },
      ]}
      status="ready"
      view="inbox"
    />,
  );

  expect(screen.getByRole("heading", { name: "Inbox overview" })).toBeInTheDocument();
  expect(screen.getByText("Tasks")).toBeInTheDocument();
  expect(screen.getByText("With a date")).toBeInTheDocument();
  expect(screen.getByText("Project links")).toBeInTheDocument();
  expect(screen.getAllByText("1")).toHaveLength(2);
  expect(screen.getByText("2")).toBeInTheDocument();
});

it("lists only dated today facts in chronological order", () => {
  render(
    <TaskViewInsights
      items={[
        {
          completed: false,
          dueAt: "2026-08-29T12:00:00Z",
          id: "later",
          projectLabel: null,
          scheduledAt: null,
          title: "Later",
        },
        {
          completed: false,
          dueAt: null,
          id: "unscheduled",
          projectLabel: null,
          scheduledAt: null,
          title: "Unscheduled",
        },
        {
          completed: false,
          dueAt: null,
          id: "earlier",
          projectLabel: "Release",
          scheduledAt: "2026-08-29T09:00:00Z",
          title: "Earlier",
        },
      ]}
      status="ready"
      view="today"
    />,
  );

  const timeline = screen.getByRole("list", { name: "Schedule overview" });

  expect(
    within(timeline)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([expect.stringContaining("Earlier"), expect.stringContaining("Later")]);
  expect(within(timeline).queryByText("Unscheduled")).not.toBeInTheDocument();
});

it("does not emit a duplicate-key warning for distinct tasks with the same schedule fact", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const items = [
    {
      completed: false,
      dueAt: "2026-08-29T09:00:00Z",
      id: "task-1",
      projectLabel: null,
      scheduledAt: null,
      title: "Review",
    },
    {
      completed: false,
      dueAt: "2026-08-29T09:00:00Z",
      id: "task-2",
      projectLabel: null,
      scheduledAt: null,
      title: "Review",
    },
  ];

  try {
    render(<TaskViewInsights items={items} status="ready" view="today" />);

    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
  }
});

it("lists only actual completed project names", () => {
  render(
    <TaskViewInsights
      items={[
        {
          completed: true,
          dueAt: null,
          id: "ship",
          projectLabel: "Release",
          scheduledAt: null,
          title: "Ship",
        },
        {
          completed: true,
          dueAt: null,
          id: "archive",
          projectLabel: null,
          scheduledAt: null,
          title: "Archive",
        },
      ]}
      status="ready"
      view="completed"
    />,
  );

  expect(screen.getByRole("heading", { name: "Completion record" })).toBeInTheDocument();
  expect(within(screen.getByRole("list")).getByText("Release")).toBeInTheDocument();
  expect(screen.queryByText("Archive")).not.toBeInTheDocument();
});
