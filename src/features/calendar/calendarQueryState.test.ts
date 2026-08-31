import { describe, expect, it } from "vitest";
import { calendarQueryReducer, initialCalendarQueryState } from "./calendarQueryState";

describe("calendarQueryReducer", () => {
  it("ignores a resolved calendar request after the user leaves Calendar", () => {
    const calendarViewState = calendarQueryReducer(initialCalendarQueryState, {
      type: "viewChanged",
      view: "calendar",
    });
    const loadingCalendarState = calendarQueryReducer(calendarViewState, {
      month: "2026-08",
      requestId: 1,
      type: "calendarLoadStarted",
    });
    const todayState = calendarQueryReducer(loadingCalendarState, {
      type: "viewChanged",
      view: "today",
    });

    expect(
      calendarQueryReducer(todayState, {
        requestId: 1,
        tasks: [],
        type: "calendarRequestResolved",
      }),
    ).toBe(todayState);
  });

  it("ignores a rejected calendar request after the user leaves Calendar", () => {
    const calendarViewState = calendarQueryReducer(initialCalendarQueryState, {
      type: "viewChanged",
      view: "calendar",
    });
    const loadingCalendarState = calendarQueryReducer(calendarViewState, {
      month: "2026-08",
      requestId: 1,
      type: "calendarLoadStarted",
    });
    const todayState = calendarQueryReducer(loadingCalendarState, {
      type: "viewChanged",
      view: "today",
    });

    expect(
      calendarQueryReducer(todayState, {
        errorMessageKey: "errors.storage.unavailable",
        requestId: 1,
        type: "calendarRequestRejected",
      }),
    ).toBe(todayState);
  });
});
