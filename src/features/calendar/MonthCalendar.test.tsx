import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import MonthCalendar from "./MonthCalendar";
import type { TaskSummaryDto } from "../tasks/taskTypes";

afterEach(cleanup);

const scheduledTask: TaskSummaryDto = {
  childCompleted: 0,
  childTotal: 0,
  completed: false,
  dueAt: null,
  id: "scheduled-task",
  priority: "Normal",
  projectName: null,
  scheduledAt: "2026-08-12T04:00:00.000Z",
  tags: [],
  title: "Review release notes",
};

it("places returned tasks in their scheduled date cell and names completed status", () => {
  render(
    <MonthCalendar
      errorMessage={null}
      isLoading={false}
      month="2026-08"
      onMonthChange={vi.fn()}
      tasks={[
        scheduledTask,
        { ...scheduledTask, completed: true, id: "completed-task", title: "Ship release" },
      ]}
    />,
  );

  const augustTwelfth = screen.getByRole("button", {
    name: "Wednesday, August 12, 2026, 2 tasks, 1 completed",
  });

  expect(within(augustTwelfth).getByText("Review release notes")).toBeInTheDocument();
  expect(within(augustTwelfth).getByText("Ship release")).toBeInTheDocument();
  expect(within(augustTwelfth).getByText("Completed")).toBeInTheDocument();
});

it("shows the selected date details without rendering tasks in adjacent month cells", async () => {
  const user = userEvent.setup();

  render(
    <MonthCalendar
      errorMessage={null}
      isLoading={false}
      month="2026-08"
      onMonthChange={vi.fn()}
      tasks={[
        scheduledTask,
        {
          ...scheduledTask,
          id: "outside",
          scheduledAt: "2026-09-01T04:00:00.000Z",
          title: "September task",
        },
      ]}
    />,
  );

  expect(screen.queryByText("September task")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Wednesday, August 12, 2026, 1 tasks, 0 completed" }),
  );

  const detailHeading = screen.getByRole("heading", { name: "Wednesday, August 12, 2026" });

  expect(detailHeading).toBeInTheDocument();
  expect(
    within(detailHeading.parentElement as HTMLElement).getByText("Review release notes"),
  ).toBeInTheDocument();
});

it("renders selected tasks in a read-only ledger with their real project and completed state", async () => {
  const user = userEvent.setup();

  render(
    <MonthCalendar
      errorMessage={null}
      isLoading={false}
      month="2026-08"
      onMonthChange={vi.fn()}
      tasks={[{ ...scheduledTask, completed: true, projectName: "Release" }]}
    />,
  );

  expect(screen.getByText("Select a day to view tasks.")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Wednesday, August 12, 2026, 1 tasks, 1 completed" }),
  );

  const details = screen.getByRole("heading", {
    name: "Wednesday, August 12, 2026",
  }).parentElement as HTMLElement;

  expect(details.querySelector(".task-ledger")).toBeInTheDocument();
  expect(within(details).getByText("Review release notes")).toBeInTheDocument();
  expect(within(details).getByText("Release")).toBeInTheDocument();
  expect(within(details).getByText("Completed")).toBeInTheDocument();
});

it("selects the first day when the displayed month changes", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <MonthCalendar
      errorMessage={null}
      isLoading={false}
      month="2026-08"
      onMonthChange={vi.fn()}
      tasks={[scheduledTask]}
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Wednesday, August 12, 2026, 1 tasks, 0 completed" }),
  );
  expect(screen.getByRole("heading", { name: "Wednesday, August 12, 2026" })).toBeInTheDocument();

  rerender(
    <MonthCalendar
      errorMessage={null}
      isLoading={false}
      month="2026-09"
      onMonthChange={vi.fn()}
      tasks={[]}
    />,
  );

  expect(screen.getByRole("heading", { name: "Tuesday, September 1, 2026" })).toBeInTheDocument();
  expect(screen.getByText("No tasks planned for this day.")).toBeInTheDocument();
  expect(screen.queryByText("Review release notes")).not.toBeInTheDocument();
});

it("exposes date task counts and completed status with native button semantics", async () => {
  const user = userEvent.setup();

  render(
    <MonthCalendar
      errorMessage={null}
      isLoading={false}
      month="2026-08"
      onMonthChange={vi.fn()}
      tasks={[scheduledTask, { ...scheduledTask, completed: true, id: "completed-task" }]}
    />,
  );

  const augustTwelfth = screen.getByRole("button", {
    name: "Wednesday, August 12, 2026, 2 tasks, 1 completed",
  });

  expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();
  expect(augustTwelfth).toHaveAttribute("aria-controls", "calendar-day-details");

  augustTwelfth.focus();
  await user.keyboard("{Enter}");

  expect(screen.getByRole("heading", { name: "Wednesday, August 12, 2026" })).toBeInTheDocument();
  expect(screen.getAllByText("Completed")).toHaveLength(2);
});

it("changes months through labelled previous and next icon controls", async () => {
  const user = userEvent.setup();
  const onMonthChange = vi.fn();

  render(
    <MonthCalendar
      errorMessage={null}
      isLoading={false}
      month="2026-08"
      onMonthChange={onMonthChange}
      tasks={[]}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Previous month" }));
  await user.click(screen.getByRole("button", { name: "Next month" }));

  expect(onMonthChange).toHaveBeenNthCalledWith(1, "2026-07");
  expect(onMonthChange).toHaveBeenNthCalledWith(2, "2026-09");
});
