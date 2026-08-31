import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import TaskSummaryList from "./TaskSummaryList";
import type { TaskSummaryDto } from "./taskTypes";

const openTask: TaskSummaryDto = {
  childCompleted: 0,
  childTotal: 0,
  completed: false,
  dueAt: null,
  id: "task-open",
  priority: "Normal",
  projectName: null,
  scheduledAt: null,
  tags: [],
  title: "Prepare release",
};

const completedTask: TaskSummaryDto = {
  ...openTask,
  completed: true,
  id: "task-completed",
  title: "Review schema",
};

it("exposes a completion action for an open summary", async () => {
  const user = userEvent.setup();
  const onToggleCompleted = vi.fn();

  render(<TaskSummaryList onToggleCompleted={onToggleCompleted} tasks={[openTask]} />);

  const completionButton = screen.getByRole("button", { name: "Complete task Prepare release" });

  expect(completionButton).toHaveClass("task-ledger-row__toggle");
  await user.click(completionButton);

  expect(onToggleCompleted).toHaveBeenCalledWith("task-open", false);
});

it("exposes a restore action for a completed summary", async () => {
  const user = userEvent.setup();
  const onToggleCompleted = vi.fn();

  render(<TaskSummaryList onToggleCompleted={onToggleCompleted} tasks={[completedTask]} />);

  const restoreButton = screen.getByRole("button", { name: "Restore task Review schema" });

  expect(restoreButton).toHaveClass("task-ledger-row__toggle");
  await user.click(restoreButton);

  expect(onToggleCompleted).toHaveBeenCalledWith("task-completed", true);
});

it("announces an empty summary list", () => {
  render(<TaskSummaryList onToggleCompleted={vi.fn()} tasks={[]} />);

  expect(screen.getByRole("status")).toHaveTextContent("No tasks in this view.");
});

it("shows non-interactive translated completion states in read-only summaries", () => {
  const { container } = render(
    <TaskSummaryList onToggleCompleted={vi.fn()} readOnly tasks={[openTask, completedTask]} />,
  );

  expect(within(container).getByText("Open")).toBeInTheDocument();
  expect(within(container).getByText("Completed")).toBeInTheDocument();
  expect(within(container).queryByRole("button")).not.toBeInTheDocument();
});
