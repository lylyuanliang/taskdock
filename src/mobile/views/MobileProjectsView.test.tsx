import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import MobileProjectsView from "./MobileProjectsView";

afterEach(cleanup);

it("renders projects separately from the Today view", () => {
  render(
    <MobileProjectsView
      errorMessageKey={null}
      isLoading={false}
      onCreateProject={vi.fn()}
      onSelectProject={vi.fn()}
      projects={[{ archivedAt: null, createdAt: "", id: "p1", name: "Work", updatedAt: "" }]}
      selectedProjectId="p1"
      tasks={[
        {
          childCompleted: 0,
          childTotal: 0,
          completed: false,
          dueAt: null,
          hasNote: false,
          id: "t1",
          priority: "Normal",
          projectName: "Work",
          scheduledAt: null,
          tags: [],
          title: "Ship release",
        },
      ]}
    />,
  );

  expect(screen.getByTestId("mobile-projects-view")).toBeInTheDocument();
  expect(screen.getByText("Work")).toBeInTheDocument();
  expect(screen.getByText("Ship release")).toBeInTheDocument();
});

it("creates a project from the mobile projects view and selects it", async () => {
  const user = userEvent.setup();
  const onCreateProject = vi.fn().mockResolvedValue({
    archivedAt: null,
    createdAt: "",
    id: "p2",
    name: "Personal",
    updatedAt: "",
  });
  const onSelectProject = vi.fn();

  render(
    <MobileProjectsView
      errorMessageKey={null}
      isLoading={false}
      onCreateProject={onCreateProject}
      onSelectProject={onSelectProject}
      projects={[]}
      selectedProjectId={null}
      tasks={[]}
    />,
  );

  await user.type(screen.getByLabelText("Project name"), "Personal");
  await user.click(screen.getByRole("button", { name: "Create project" }));

  await waitFor(() => expect(onCreateProject).toHaveBeenCalledWith("Personal"));
  expect(onSelectProject).toHaveBeenCalledWith("p2");
});
