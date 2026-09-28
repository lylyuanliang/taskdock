import { expect, it } from "vitest";
import { MOBILE_VISUAL_STATES, getMobileVisualState, type MobileVisualState } from "./mobileStates";

it("keeps the mobile visual state matrix stable", () => {
  const states: MobileVisualState[] = [...MOBILE_VISUAL_STATES];

  expect(states).toEqual([
    "default",
    "pressed",
    "focused",
    "disabled",
    "loading",
    "empty",
    "offline",
    "syncError",
    "conflict",
    "longText",
  ]);
});

it("derives stable fixture states from the shared loading and error signals", () => {
  expect(getMobileVisualState({ isLoading: true, hasError: false, isEmpty: false })).toBe(
    "loading",
  );
  expect(getMobileVisualState({ isLoading: false, hasError: true, isEmpty: false })).toBe(
    "syncError",
  );
  expect(getMobileVisualState({ isLoading: false, hasError: false, isEmpty: true })).toBe("empty");
  expect(getMobileVisualState({ isLoading: false, hasError: false, isEmpty: false })).toBe(
    "default",
  );
});
