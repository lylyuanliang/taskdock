import type { AppView, TaskSummaryDto } from "../tasks/taskTypes";

export type CalendarLoadState =
  | {
      month: string;
      requestId: number;
      status: "loading";
    }
  | {
      month: string;
      requestId: number;
      status: "ready";
      tasks: TaskSummaryDto[];
    }
  | {
      errorMessageKey: string;
      month: string;
      requestId: number;
      status: "error";
    };

export interface CalendarQueryState {
  activeView: AppView;
  loadState: CalendarLoadState | null;
}

export type CalendarQueryAction =
  | {
      type: "viewChanged";
      view: AppView;
    }
  | {
      month: string;
      requestId: number;
      type: "calendarLoadStarted";
    }
  | {
      requestId: number;
      tasks: TaskSummaryDto[];
      type: "calendarRequestResolved";
    }
  | {
      errorMessageKey: string;
      requestId: number;
      type: "calendarRequestRejected";
    };

export const initialCalendarQueryState: CalendarQueryState = {
  activeView: "inbox",
  loadState: null,
};

export function calendarQueryReducer(
  state: CalendarQueryState,
  action: CalendarQueryAction,
): CalendarQueryState {
  switch (action.type) {
    case "viewChanged":
      if (action.view === "calendar") {
        return {
          ...state,
          activeView: action.view,
        };
      }

      return {
        activeView: action.view,
        loadState: null,
      };
    case "calendarLoadStarted":
      if (state.activeView !== "calendar") {
        return state;
      }

      return {
        ...state,
        loadState: {
          month: action.month,
          requestId: action.requestId,
          status: "loading",
        },
      };
    case "calendarRequestResolved":
      if (
        state.activeView !== "calendar" ||
        state.loadState?.status !== "loading" ||
        state.loadState.requestId !== action.requestId
      ) {
        return state;
      }

      return {
        ...state,
        loadState: {
          month: state.loadState.month,
          requestId: action.requestId,
          status: "ready",
          tasks: action.tasks,
        },
      };
    case "calendarRequestRejected":
      if (
        state.activeView !== "calendar" ||
        state.loadState?.status !== "loading" ||
        state.loadState.requestId !== action.requestId
      ) {
        return state;
      }

      return {
        ...state,
        loadState: {
          errorMessageKey: action.errorMessageKey,
          month: state.loadState.month,
          requestId: action.requestId,
          status: "error",
        },
      };
  }
}
