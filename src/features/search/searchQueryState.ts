import type { TaskSummaryDto } from "../tasks/taskTypes";

export type SearchLoadState =
  | { status: "idle" }
  | { query: string; requestId: number; status: "loading" }
  | { query: string; requestId: number; status: "ready"; tasks: TaskSummaryDto[] }
  | { errorMessageKey: string; query: string; requestId: number; status: "error" };

export interface SearchQueryState {
  input: string;
  isOpen: boolean;
  loadState: SearchLoadState;
  query: string;
}

export type SearchQueryAction =
  | { type: "opened" }
  | { type: "closed" }
  | { input: string; type: "inputChanged" }
  | { query: string; requestId: number; type: "requestStarted" }
  | { query: string; requestId: number; tasks: TaskSummaryDto[]; type: "requestResolved" }
  | { errorMessageKey: string; query: string; requestId: number; type: "requestRejected" };

export const initialSearchQueryState: SearchQueryState = {
  input: "",
  isOpen: false,
  loadState: { status: "idle" },
  query: "",
};

export function searchQueryReducer(
  state: SearchQueryState,
  action: SearchQueryAction,
): SearchQueryState {
  switch (action.type) {
    case "opened":
      if (state.isOpen) {
        return state;
      }

      return { ...initialSearchQueryState, isOpen: true };
    case "closed":
      if (!state.isOpen) {
        return state;
      }

      return initialSearchQueryState;
    case "inputChanged":
      if (!state.isOpen || state.input === action.input) {
        return state;
      }

      return {
        input: action.input,
        isOpen: true,
        loadState: { status: "idle" },
        query: action.input.trim(),
      };
    case "requestStarted":
      if (
        !state.isOpen ||
        !state.query ||
        state.query !== action.query ||
        state.loadState.status !== "idle"
      ) {
        return state;
      }

      return {
        ...state,
        loadState: {
          query: action.query,
          requestId: action.requestId,
          status: "loading",
        },
      };
    case "requestResolved":
      if (
        !state.isOpen ||
        state.query !== action.query ||
        state.loadState.status !== "loading" ||
        state.loadState.query !== action.query ||
        state.loadState.requestId !== action.requestId
      ) {
        return state;
      }

      return {
        ...state,
        loadState: {
          query: action.query,
          requestId: action.requestId,
          status: "ready",
          tasks: action.tasks,
        },
      };
    case "requestRejected":
      if (
        !state.isOpen ||
        state.query !== action.query ||
        state.loadState.status !== "loading" ||
        state.loadState.query !== action.query ||
        state.loadState.requestId !== action.requestId
      ) {
        return state;
      }

      return {
        ...state,
        loadState: {
          errorMessageKey: action.errorMessageKey,
          query: action.query,
          requestId: action.requestId,
          status: "error",
        },
      };
  }
}
