import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectTaskBoard from "./ProjectTaskBoard";
import { groupProjectTasks } from "./projectTaskGroups";
import type { TaskSummaryDto } from "../tasks/taskTypes";

afterEach(cleanup);

const baseTask: TaskSummaryDto = {
  childCompleted: 0,
  childTotal: 0,
  completed: false,
  dueAt: null,
  id: "task",
  priority: "Normal",
  projectName: "Release",
  scheduledAt: null,
  tags: [],
  title: "Task",
};

describe("groupProjectTasks", () => {
  const now = new Date(2026, 8, 21, 12, 0, 0);

  it("assigns high priority and earliest dated work to Next Action once", () => {
    const groups = groupProjectTasks(
      [
        { ...baseTask, id: "high", priority: "High", title: "High priority" },
        {
          ...baseTask,
          dueAt: "2026-09-22T09:00:00",
          id: "earliest",
          title: "Earliest deadline",
        },
        {
          ...baseTask,
          dueAt: "2026-09-28T09:00:00",
          id: "later",
          title: "Later deadline",
        },
      ],
      now,
    );

    expect(groups.nextAction.map((task) => task.id)).toEqual(["high", "earliest"]);
    expect(groups.doing).toHaveLength(0);
    expect(groups.todo.map((task) => task.id)).toEqual(["later"]);
  });

  it("puts today's scheduled work in Doing and removes completed tasks", () => {
    const groups = groupProjectTasks(
      [
        { ...baseTask, id: "today", scheduledAt: "2026-09-21T16:00:00" },
        { ...baseTask, completed: true, id: "done", title: "Completed" },
        { ...baseTask, id: "future", scheduledAt: "2026-09-23T16:00:00" },
      ],
      now,
    );

    expect(groups.nextAction).toHaveLength(0);
    expect(groups.doing.map((task) => task.id)).toEqual(["today"]);
    expect(groups.todo.map((task) => task.id)).toEqual(["future"]);
    expect(
      [...groups.nextAction, ...groups.doing, ...groups.todo].map((task) => task.id),
    ).not.toContain("done");
  });

  it("keeps an undated open task in To Do when no dated task exists", () => {
    const groups = groupProjectTasks([{ ...baseTask, id: "undated" }], now);

    expect(groups.nextAction).toEqual([]);
    expect(groups.doing).toEqual([]);
    expect(groups.todo.map((task) => task.id)).toEqual(["undated"]);
  });
});

describe("ProjectTaskBoard", () => {
  it("renders all columns, task metadata, empty state, and task actions", async () => {
    const user = userEvent.setup();
    const onAddTask = vi.fn();
    const onToggleCompleted = vi.fn();

    render(
      <ProjectTaskBoard
        onAddTask={onAddTask}
        onToggleCompleted={onToggleCompleted}
        tasks={[{ ...baseTask, id: "board-task", priority: "High", tags: ["release"] }]}
      />,
    );

    expect(screen.getByTestId("project-task-board")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Next Action" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Doing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "To Do" })).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("release")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("project-task-column-doing")).getByText("No tasks in this group."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add project task" }));
    await user.click(screen.getByRole("button", { name: "Complete task Task" }));

    expect(onAddTask).toHaveBeenCalledOnce();
    expect(onToggleCompleted).toHaveBeenCalledWith("board-task", false);
  });
});
