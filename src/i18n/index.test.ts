import { describe, expect, it } from "vitest";
import { enUS } from "./en-US";
import { resolveLocale } from "./index";
import { zhCN } from "./zh-CN";

const backendErrorKeys = [
  "errors.task.title.blank",
  "errors.task.title.too_long",
  "errors.task.id.invalid",
  "errors.task.not_found",
  "errors.task.parent.not_found",
  "errors.task.input.invalid",
  "errors.task.tag.invalid",
  "errors.task.subtask.nesting.unsupported",
  "errors.task.already_completed",
  "errors.task.completion.use_complete",
  "errors.task.concurrent_update",
  "errors.task.recurrence.restore.unsupported",
  "errors.recurrence.child.unsupported",
  "errors.recurrence.scheduled_at.required",
  "errors.recurrence.frequency.unsupported",
  "errors.task.revision.overflow",
  "errors.task.parent.write.unsupported",
  "errors.task.subtask.project.inherited",
  "errors.storage.unavailable",
] as const;

describe("resolveLocale", () => {
  it("maps Chinese browser language variants to zh-CN", () => {
    expect(resolveLocale("zh-TW")).toBe("zh-CN");
  });

  it("falls back to en-US for unsupported browser languages", () => {
    expect(resolveLocale("fr-FR")).toBe("en-US");
  });
});

it("uses TaskDock as the product identity in every supported locale", () => {
  expect(enUS["app.title"]).toBe("TaskDock");
  expect(zhCN["app.title"]).toBe("TaskDock");
  expect(enUS["quickPanel.windowTitle"]).toBe("TaskDock quick panel");
  expect(zhCN["quickPanel.windowTitle"]).toBe("TaskDock 快速面板");
});

describe("backend error translations", () => {
  it.each([
    ["zh-CN", zhCN],
    ["en-US", enUS],
  ] as const)("defines every command-reachable key for %s", (_locale, translations) => {
    for (const key of backendErrorKeys) {
      expect(translations[key]).toBeTruthy();
      expect(translations[key]).not.toBe(key);
    }
  });
});

it("localizes the accessible search result region name", () => {
  expect(enUS["search.results"]).toBe("Search results");
  expect(zhCN["search.results"]).toBe("搜索结果");
});

it("localizes task completion error messages in both supported languages", () => {
  expect(enUS["errors.task.already_completed"]).toBe("This task is already completed.");
  expect(zhCN["errors.task.already_completed"]).toBe("该任务已完成。");
  expect(enUS["errors.task.completion.use_complete"]).toBe(
    "Complete tasks with the dedicated completion action.",
  );
  expect(zhCN["errors.task.completion.use_complete"]).toBe("请使用专用完成操作来完成任务。");
  expect(enUS["errors.task.concurrent_update"]).toBe(
    "This task changed while you were editing it. Reload and try again.",
  );
  expect(zhCN["errors.task.concurrent_update"]).toBe("任务已被其他操作更新，请刷新后重试。");
  expect(enUS["errors.task.recurrence.restore.unsupported"]).toBe(
    "A completed recurring task cannot be restored.",
  );
  expect(zhCN["errors.task.recurrence.restore.unsupported"]).toBe("已完成的重复任务无法恢复。");
});
