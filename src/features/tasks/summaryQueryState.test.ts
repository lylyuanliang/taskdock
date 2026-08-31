import { describe, expect, it } from "vitest";
import { summaryQueryReducer, type SummaryQueryState } from "./summaryQueryState";
import type { TaskSummaryDto } from "./taskTypes";

const todayTask: TaskSummaryDto = {
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

const readyTodayState: SummaryQueryState = {
  activeView: "today",
  loadState: {
    requestId: 1,
    status: "ready",
    tasks: [todayTask],
    view: "today",
  },
};

const errorTodayState: SummaryQueryState = {
  activeView: "today",
  loadState: {
    errorMessageKey: "errors.storage.unavailable",
    requestId: 1,
    status: "error",
    view: "today",
  },
};

describe("summaryQueryReducer", () => {
  it("replaces a ready Today summary with Upcoming loading in the view-change commit", () => {
    expect(
      summaryQueryReducer(readyTodayState, {
        requestId: 2,
        type: "viewSelected",
        view: "upcoming",
      }),
    ).toEqual({
      activeView: "upcoming",
      loadState: {
        requestId: 2,
        status: "loading",
        view: "upcoming",
      },
    });
  });

  it("replaces a Today error with Upcoming loading in the view-change commit", () => {
    expect(
      summaryQueryReducer(errorTodayState, {
        requestId: 2,
        type: "viewSelected",
        view: "upcoming",
      }),
    ).toEqual({
      activeView: "upcoming",
      loadState: {
        requestId: 2,
        status: "loading",
        view: "upcoming",
      },
    });
  });
});
