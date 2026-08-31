import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "./ThemeProvider";
import { useTheme } from "./useTheme";

function ThemeProbe() {
  const { setTheme, theme } = useTheme();

  return (
    <button onClick={() => setTheme("light")} type="button">
      {theme === "light" ? "theme.light.active" : "theme.light"}
    </button>
  );
}

describe("ThemeProvider", () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
  });

  it("sets the selected theme on the document root", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "theme.light" }));

    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
