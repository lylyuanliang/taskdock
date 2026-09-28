import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MobileAppShell from "./MobileAppShell";
import { getMobileBackRoute, transitionMobileRoute, type MobileRoute } from "./mobileRoutes";

afterEach(cleanup);

it("allows the four primary routes from the bottom navigation", () => {
  const onRouteChange = vi.fn();
  const { rerender } = render(
    <MobileAppShell
      activeRoute="today"
      hasUnsavedChanges={false}
      onBack={vi.fn()}
      onRouteChange={onRouteChange}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
  rerender(
    <MobileAppShell
      activeRoute="inbox"
      hasUnsavedChanges={false}
      onBack={vi.fn()}
      onRouteChange={onRouteChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Projects" }));
  rerender(
    <MobileAppShell
      activeRoute="projects"
      hasUnsavedChanges={false}
      onBack={vi.fn()}
      onRouteChange={onRouteChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  rerender(
    <MobileAppShell
      activeRoute="settings"
      hasUnsavedChanges={false}
      onBack={vi.fn()}
      onRouteChange={onRouteChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Today" }));

  expect(onRouteChange.mock.calls.map(([route]) => route)).toEqual([
    "inbox",
    "projects",
    "settings",
    "today",
  ]);
});

it("delegates the page back action and responds to the system back event", () => {
  const onBack = vi.fn();

  render(
    <MobileAppShell
      activeRoute="syncSettings"
      hasUnsavedChanges={false}
      onBack={onBack}
      onRouteChange={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent(window, new PopStateEvent("popstate"));

  expect(onBack).toHaveBeenCalledTimes(2);
});

it("blocks navigation while an editor has unsaved changes until discarded", () => {
  const onRouteChange = vi.fn();
  const onBack = vi.fn();

  render(
    <MobileAppShell
      activeRoute="taskEditor"
      hasUnsavedChanges
      onBack={onBack}
      onRouteChange={onRouteChange}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Inbox" }));

  expect(onRouteChange).not.toHaveBeenCalled();
  expect(onBack).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

  expect(onRouteChange).toHaveBeenCalledWith("inbox");
});

it("keeps special routes on their defined return paths", () => {
  expect(getMobileBackRoute("taskEditor", "projects")).toBe("projects");
  expect(getMobileBackRoute("syncSettings", "today")).toBe("settings");
  expect(getMobileBackRoute("conflicts", "today")).toBe("syncSettings");
  expect(getMobileBackRoute("settings", "today")).toBe("today");
});

it("uses the controlled previous route when leaving the task editor", () => {
  const onRouteChange = vi.fn();

  render(
    <MobileAppShell
      activeRoute="taskEditor"
      hasUnsavedChanges={false}
      onBack={vi.fn()}
      onRouteChange={onRouteChange}
      previousRoute="projects"
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Projects" }));

  expect(onRouteChange).toHaveBeenCalledWith("projects");
});

it("rejects invalid transitions without changing the current route", () => {
  const cases: Array<[MobileRoute, MobileRoute, MobileRoute | undefined, MobileRoute]> = [
    ["taskEditor", "settings", "projects", "taskEditor"],
    ["today", "conflicts", undefined, "today"],
  ];

  for (const [currentRoute, requestedRoute, previousRoute, expectedRoute] of cases) {
    expect(transitionMobileRoute(currentRoute, requestedRoute, previousRoute)).toBe(expectedRoute);
  }
});

it("allows the bottom navigation to leave nested mobile settings routes", () => {
  expect(transitionMobileRoute("syncSettings", "projects")).toBe("projects");
  expect(transitionMobileRoute("conflicts", "today")).toBe("today");
});
