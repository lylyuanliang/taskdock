import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TaskList from "./TaskList";
import type { TaskDto } from "./taskTypes";

afterEach(cleanup);

const savedTask: TaskDto = {
  completedAt: null,
  createdAt: "2026-08-27T00:00:00Z",
  dueAt: null,
  id: "task-1",
  note: "",
  parentId: null,
  priority: "Normal",
  projectId: null,
  recurrence: null,
  scheduledAt: null,
  title: "Review schema",
  updatedAt: "2026-08-27T00:00:00Z",
  revision: 1,
};

it("renders a loaded inbox task as a ledger row with an icon-only edit action", () => {
  render(
    <TaskList
      errorMessageKey={null}
      isLoading={false}
      onEdit={vi.fn()}
      onToggleCompleted={vi.fn()}
      pendingTaskIds={new Set()}
      tasks={[savedTask]}
    />,
  );

  expect(screen.getByRole("list", { name: "Inbox" })).toHaveClass("task-ledger");
  expect(screen.getByRole("button", { name: "Edit task Review schema" })).toHaveClass(
    "task-ledger-row__edit",
  );
});

it("exposes task state metadata and formats scheduled timestamps for the ledger", () => {
  render(
    <TaskList
      errorMessageKey={null}
      isLoading={false}
      onEdit={vi.fn()}
      onToggleCompleted={vi.fn()}
      pendingTaskIds={new Set()}
      tasks={[
        { ...savedTask, note: "Include the migration result", scheduledAt: "2026-08-27T09:00:00" },
      ]}
    />,
  );

  const row = screen.getByRole("listitem");

  expect(row).toHaveAttribute("data-task-id", "task-1");
  expect(row).toHaveAttribute("data-task-state", "open");
  expect(screen.getByText("09:00")).toBeInTheDocument();
  expect(screen.getByLabelText("Note")).toHaveAttribute("title", "Include the migration result");
});
