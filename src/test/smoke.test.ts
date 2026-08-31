import { expect, test } from "vitest";

test("configures the browser test environment", () => {
  expect(document.createElement("main").tagName).toBe("MAIN");
});
