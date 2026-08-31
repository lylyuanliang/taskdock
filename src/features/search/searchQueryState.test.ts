import { describe, expect, it } from "vitest";
import { initialSearchQueryState, searchQueryReducer } from "./searchQueryState";

describe("searchQueryReducer", () => {
  it("ignores resolved and rejected requests after the dialog closes", () => {
    const opened = searchQueryReducer(initialSearchQueryState, { type: "opened" });
    const enteredQuery = searchQueryReducer(opened, {
      input: "  release  ",
      type: "inputChanged",
    });
    const loading = searchQueryReducer(enteredQuery, {
      query: "release",
      requestId: 1,
      type: "requestStarted",
    });
    const closed = searchQueryReducer(loading, { type: "closed" });

    expect(
      searchQueryReducer(closed, {
        query: "release",
        requestId: 1,
        tasks: [],
        type: "requestResolved",
      }),
    ).toBe(closed);
    expect(
      searchQueryReducer(closed, {
        errorMessageKey: "errors.storage.unavailable",
        query: "release",
        requestId: 1,
        type: "requestRejected",
      }),
    ).toBe(closed);
  });

  it("ignores a request response when the normalized query changes", () => {
    const opened = searchQueryReducer(initialSearchQueryState, { type: "opened" });
    const firstQuery = searchQueryReducer(opened, {
      input: "release",
      type: "inputChanged",
    });
    const firstLoading = searchQueryReducer(firstQuery, {
      query: "release",
      requestId: 1,
      type: "requestStarted",
    });
    const changedQuery = searchQueryReducer(firstLoading, {
      input: "schema",
      type: "inputChanged",
    });

    expect(
      searchQueryReducer(changedQuery, {
        query: "release",
        requestId: 1,
        tasks: [],
        type: "requestResolved",
      }),
    ).toBe(changedQuery);
    expect(
      searchQueryReducer(changedQuery, {
        errorMessageKey: "errors.storage.unavailable",
        query: "release",
        requestId: 1,
        type: "requestRejected",
      }),
    ).toBe(changedQuery);
  });

  it("ignores an older request when raw input changes but the normalized query stays the same", () => {
    const opened = searchQueryReducer(initialSearchQueryState, { type: "opened" });
    const firstQuery = searchQueryReducer(opened, {
      input: "release",
      type: "inputChanged",
    });
    const firstLoading = searchQueryReducer(firstQuery, {
      query: "release",
      requestId: 1,
      type: "requestStarted",
    });
    const sameNormalizedQuery = searchQueryReducer(firstLoading, {
      input: " release ",
      type: "inputChanged",
    });
    const secondLoading = searchQueryReducer(sameNormalizedQuery, {
      query: "release",
      requestId: 2,
      type: "requestStarted",
    });

    expect(
      searchQueryReducer(secondLoading, {
        query: "release",
        requestId: 1,
        tasks: [],
        type: "requestResolved",
      }),
    ).toBe(secondLoading);
    expect(
      searchQueryReducer(secondLoading, {
        errorMessageKey: "errors.storage.unavailable",
        query: "release",
        requestId: 1,
        type: "requestRejected",
      }),
    ).toBe(secondLoading);
  });
});
