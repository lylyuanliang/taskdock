import { expect, it } from "vitest";
import { isMobileTodayTask } from "./mobileTaskFilters";

const now = new Date("2026-09-25T12:00:00+08:00");
const task = (
  scheduledAt: string | null,
  dueAt: string | null = null,
  completedAt: string | null = null,
) => ({
  completedAt,
  dueAt,
  scheduledAt,
});

it.each([
  ["today", task("2026-09-25T09:00:00+08:00"), true],
  ["overdue", task("2026-09-20T09:00:00+08:00"), true],
  ["due today", task(null, "2026-09-25T18:00:00+08:00"), true],
  ["future", task("2026-09-26T09:00:00+08:00"), false],
  ["history without date", task(null, null), false],
  ["completed today", task("2026-09-25T09:00:00+08:00", null, "2026-09-25T10:00:00+08:00"), false],
])("filters %s using the local day", (_name, value, expected) => {
  expect(isMobileTodayTask(value, now)).toBe(expected);
});
