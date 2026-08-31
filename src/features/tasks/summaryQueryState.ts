import type { AppView, TaskSummaryDto } from "./taskTypes";

export type SummaryView = Exclude<AppView, "inbox" | "projects" | "calendar">;

export type SummaryLoadState =
  | {
      requestId: number;
      status: "loading";
      view: SummaryView;
    }
  | {
      requestId: number;
      status: "ready";
      tasks: TaskSummaryDto[];
      view: SummaryView;
    }
  | {
      errorMessageKey: string;
      requestId: number;
      status: "error";
      view: SummaryView;
    };

export interface SummaryQueryState {
  activeView: AppView;
  loadState: SummaryLoadState | null;
}

export type SummaryQueryAction =
  | {
      requestId: number;
      type: "viewSelected";
      view: Exclude<AppView, "calendar">;
    }
  | {
      requestId: number;
      tasks: TaskSummaryDto[];
      type: "requestResolved";
    }
  | {
      errorMessageKey: string;
      requestId: number;
      type: "requestRejected";
    };

export const initialSummaryQueryState: SummaryQueryState = {
  activeView: "inbox",
  loadState: null,
};

export function summaryQueryReducer(
  state: SummaryQueryState,
  action: SummaryQueryAction,
): SummaryQueryState {
  switch (action.type) {
    case "viewSelected":
      if (action.view === "inbox") {
        return { activeView: action.view, loadState: null };
      }

      if (action.view === "projects") {
        return { activeView: action.view, loadState: null };
      }

      return {
        activeView: action.view,
        loadState: {
          requestId: action.requestId,
          status: "loading",
          view: action.view,
        },
      };
    case "requestResolved":
      if (state.loadState?.status !== "loading" || state.loadState.requestId !== action.requestId) {
        return state;
      }

      return {
        ...state,
        loadState: {
          requestId: action.requestId,
          status: "ready",
          tasks: action.tasks,
          view: state.loadState.view,
        },
      };
    case "requestRejected":
      if (state.loadState?.status !== "loading" || state.loadState.requestId !== action.requestId) {
        return state;
      }

      return {
        ...state,
        loadState: {
          errorMessageKey: action.errorMessageKey,
          requestId: action.requestId,
          status: "error",
          view: state.loadState.view,
        },
      };
  }
}
