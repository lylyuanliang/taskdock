import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MobileTodayView from "./MobileTodayView";
import type { TaskDto } from "../../features/tasks/taskTypes";

afterEach(cleanup);

const task: TaskDto = {
  id: "task-1",
  title: "A very long title that should stay on two lines",
  note: "Details",
  projectId: "project-1",
  parentId: null,
  priority: "High",
  scheduledAt: "2026-09-24T09:00:00Z",
  dueAt: null,
  completedAt: null,
  recurrence: null,
  createdAt: "2026-09-24T00:00:00Z",
  updatedAt: "2026-09-24T00:00:00Z",
  revision: 1,
};

it("renders two-line title, note, metadata and completion control", () => {
  const onToggleCompleted = vi.fn();
  render(
    <MobileTodayView
      tasks={[task]}
      completedTasks={[]}
      isLoading={false}
      errorMessageKey={null}
      onOpenTask={vi.fn()}
      onToggleCompleted={onToggleCompleted}
      onCreateTask={vi.fn()}
    />,
  );
  expect(screen.getByRole("region", { name: "Today" })).toHaveAttribute("data-state", "default");
  expect(screen.getByText(task.title)).toHaveClass("mobile-today__title");
  expect(screen.getByLabelText("Note")).toBeInTheDocument();
  expect(screen.getByText("Assigned to a project")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Complete task" }));
  expect(onToggleCompleted).toHaveBeenCalledWith(task);
});

it("exposes explicit visual fixture states without relying on DOM structure", () => {
  render(
    <MobileTodayView
      tasks={[]}
      completedTasks={[]}
      isLoading={false}
      errorMessageKey={null}
      visualState="longText"
      onOpenTask={vi.fn()}
      onToggleCompleted={vi.fn()}
      onCreateTask={vi.fn()}
    />,
  );

  expect(screen.getByRole("region", { name: "Today" })).toHaveAttribute("data-state", "longText");
});

it("collapses completed tasks and exposes create and empty states", () => {
  const completed = { ...task, completedAt: "2026-09-24T10:00:00Z" };
  render(
    <MobileTodayView
      tasks={[]}
      completedTasks={[completed]}
      isLoading={false}
      errorMessageKey={null}
      onOpenTask={vi.fn()}
      onToggleCompleted={vi.fn()}
      onCreateTask={vi.fn()}
    />,
  );
  expect(screen.getByText("Completed today")).toBeInTheDocument();
  expect(screen.queryByText(completed.title)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Completed today" }));
  expect(screen.getByText(completed.title)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
});

it("uses translated priority and accessible note metadata", () => {
  const originalLanguage = Object.getOwnPropertyDescriptor(navigator, "language");

  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: "zh-CN",
  });

  try {
    render(
      <MobileTodayView
        tasks={[task]}
        completedTasks={[]}
        isLoading={false}
        errorMessageKey={null}
        onOpenTask={vi.fn()}
        onToggleCompleted={vi.fn()}
        onCreateTask={vi.fn()}
      />,
    );

    expect(screen.getByText("高")).toBeInTheDocument();
    expect(screen.getByLabelText("备注")).toBeInTheDocument();
  } finally {
    if (originalLanguage) {
      Object.defineProperty(navigator, "language", originalLanguage);
    } else {
      Reflect.deleteProperty(navigator, "language");
    }
  }
});
