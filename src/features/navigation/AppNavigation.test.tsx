import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import AppNavigation from "./AppNavigation";

afterEach(cleanup);

it("selects the completed view", async () => {
  const user = userEvent.setup();
  const onViewChange = vi.fn();

  render(<AppNavigation activeView="inbox" onCreateTask={vi.fn()} onViewChange={onViewChange} />);

  await user.click(screen.getByRole("button", { name: "Completed" }));

  expect(onViewChange).toHaveBeenCalledWith("completed");
});

it("selects the projects view", async () => {
  const user = userEvent.setup();
  const onViewChange = vi.fn();

  render(<AppNavigation activeView="inbox" onCreateTask={vi.fn()} onViewChange={onViewChange} />);

  await user.click(screen.getByRole("button", { name: "Projects" }));

  expect(onViewChange).toHaveBeenCalledWith("projects");
});

it("renders the product identity and exposes a global new-task command", async () => {
  const user = userEvent.setup();
  const onCreateTask = vi.fn();

  render(<AppNavigation activeView="inbox" onCreateTask={onCreateTask} onViewChange={vi.fn()} />);

  expect(screen.getByText("TaskDock")).toBeInTheDocument();
  expect(screen.getByText("Technical Calm")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add task" }));

  expect(onCreateTask).toHaveBeenCalledOnce();
});

it("renders the approved primary navigation order", () => {
  render(<AppNavigation activeView="inbox" onCreateTask={vi.fn()} onViewChange={vi.fn()} />);

  const labels = within(
    screen.getByRole("navigation").querySelector(".navigation-rail__items") as HTMLElement,
  )
    .getAllByRole("button")
    .map((button) => {
      return button.getAttribute("aria-label") ?? button.textContent?.trim();
    });

  expect(labels).toEqual(["Today", "Inbox", "Upcoming", "Calendar", "Projects", "Completed"]);

  expect(screen.getByRole("button", { name: "Settings" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Support" })).toBeDisabled();
});

it("opens settings from the primary navigation", async () => {
  const user = userEvent.setup();
  const onOpenSettings = vi.fn();

  render(
    <AppNavigation
      activeView="inbox"
      onCreateTask={vi.fn()}
      onOpenSettings={onOpenSettings}
      onViewChange={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));

  expect(onOpenSettings).toHaveBeenCalledOnce();
});
