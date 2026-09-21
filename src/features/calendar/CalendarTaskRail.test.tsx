import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CalendarTaskRail from "./CalendarTaskRail";
import type { TaskSummaryDto } from "../tasks/taskTypes";

afterEach(cleanup);

const task: TaskSummaryDto = {
  childCompleted: 0,
  childTotal: 0,
  completed: false,
  dueAt: null,
  id: "task-1",
  priority: "High",
  projectName: "Release",
  scheduledAt: "2026-09-21T09:30:00",
  tags: ["review"],
  title: "Review release notes",
};

describe("CalendarTaskRail", () => {
  it("shows a selected date, real task metadata, and priority rail", () => {
    render(<CalendarTaskRail selectedDate="2026-09-21" tasks={[task]} />);

    const rail = screen.getByTestId("calendar-task-rail");
    expect(rail.querySelector("h2")).toBeInTheDocument();
    expect(within(rail).getByText("Review release notes")).toBeInTheDocument();
    expect(within(rail).getByText("Release · review")).toBeInTheDocument();
    expect(rail.querySelector(".calendar-task-rail__priority--high")).toBeInTheDocument();
    expect(within(rail).getByText("09:30")).toBeInTheDocument();
  });

  it("sorts by scheduled time and marks completed tasks as subdued", () => {
    render(
      <CalendarTaskRail
        selectedDate="2026-09-21"
        tasks={[
          { ...task, id: "late", scheduledAt: "2026-09-21T15:00:00", title: "Later" },
          {
            ...task,
            completed: true,
            id: "done",
            scheduledAt: "2026-09-21T08:00:00",
            title: "Done",
          },
        ]}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Done");
    expect(rows[1]).toHaveTextContent("Later");
    expect(rows[0]).toHaveClass("is-completed");
    expect(within(rows[0]).getByText("Completed")).toBeInTheDocument();
  });

  it("keeps loading, error, and empty states explicit", () => {
    const { rerender } = render(
      <CalendarTaskRail isLoading selectedDate="2026-09-21" tasks={[]} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading tasks...");

    rerender(
      <CalendarTaskRail errorMessage="Unable to load" selectedDate="2026-09-21" tasks={[]} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load");

    rerender(<CalendarTaskRail selectedDate="2026-09-21" tasks={[]} />);
    expect(screen.getByText("No tasks planned for this day.")).toBeInTheDocument();
  });
});
