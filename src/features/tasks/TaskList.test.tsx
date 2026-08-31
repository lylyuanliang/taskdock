import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import TaskList from "./TaskList";
import type { TaskDto } from "./taskTypes";

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
