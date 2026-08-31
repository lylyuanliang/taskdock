import { describe, expect, it } from "vitest";
import { enUS } from "./en-US";
import { resolveLocale } from "./index";
import { zhCN } from "./zh-CN";

const backendErrorKeys = [
  "errors.task.title.blank",
  "errors.task.title.too_long",
  "errors.task.id.invalid",
  "errors.task.not_found",
  "errors.task.input.invalid",
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
