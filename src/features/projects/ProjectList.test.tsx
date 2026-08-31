import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectList from "./ProjectList";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const project = {
  archivedAt: null,
  createdAt: "2026-08-28T00:00:00Z",
  id: "project-1",
  name: "Release",
  updatedAt: "2026-08-28T00:00:00Z",
};

describe("ProjectList", () => {
  afterEach(cleanup);

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(project);
  });

  it("announces loading and empty project states from the project context aside", () => {
    const handlers = {
      onProjectArchived: vi.fn(),
      onProjectCreated: vi.fn(),
      onProjectRenamed: vi.fn(),
      onSelect: vi.fn(),
    };

    const { rerender } = render(
      <ProjectList
        isLoading
        listErrorMessageKey={null}
        projects={[]}
        selectedProjectId={null}
        {...handlers}
      />,
    );

    expect(screen.getByRole("complementary", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects...");

    rerender(
      <ProjectList
        isLoading={false}
        listErrorMessageKey={null}
        projects={[]}
        selectedProjectId={null}
        {...handlers}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("No projects yet.");
  });

  it("creates, renames, archives, and selects projects through IPC", async () => {
    const user = userEvent.setup();
    const onProjectArchived = vi.fn();
    const onProjectCreated = vi.fn();
    const onProjectRenamed = vi.fn();
    const onSelect = vi.fn();
    invokeMock
      .mockResolvedValueOnce({ ...project, id: "project-2", name: "Planning" })
      .mockResolvedValueOnce({ ...project, name: "Release notes" })
      .mockResolvedValueOnce({ ...project, archivedAt: "2026-08-28T01:00:00Z" });

    render(
      <ProjectList
        isLoading={false}
        listErrorMessageKey={null}
        onProjectArchived={onProjectArchived}
        onProjectCreated={onProjectCreated}
        onProjectRenamed={onProjectRenamed}
        onSelect={onSelect}
        projects={[project]}
        selectedProjectId={null}
      />,
    );

    await user.type(await screen.findByLabelText("Project name"), "Planning");
    const createProjectButton = screen.getByRole("button", { name: "Create project" });
    expect(createProjectButton).toHaveAttribute("title", "Create project");
    await user.click(createProjectButton);
    expect(invokeMock).toHaveBeenCalledWith("create_project", { name: "Planning" });
    expect(onProjectCreated).toHaveBeenCalledWith({
      ...project,
      id: "project-2",
      name: "Planning",
    });

    await user.click(await screen.findByRole("button", { name: "Release" }));

    const renameButton = await screen.findByRole("button", { name: "Rename Release" });
    expect(renameButton).toHaveAttribute("title", "Rename Release");
    await user.click(renameButton);
    const renameInput = screen.getByLabelText("Rename Release");
    await user.clear(renameInput);
    await user.type(renameInput, "Release notes");
    await user.click(screen.getByRole("button", { name: "Save project name" }));
    expect(invokeMock).toHaveBeenCalledWith("rename_project", {
      id: "project-1",
      name: "Release notes",
    });

    const archiveButton = await screen.findByRole("button", { name: "Archive Release" });
    expect(archiveButton).toHaveAttribute("title", "Archive Release");
    await user.click(archiveButton);
    expect(invokeMock).toHaveBeenCalledWith("archive_project", { id: "project-1" });
    expect(onProjectRenamed).toHaveBeenCalledWith({ ...project, name: "Release notes" });
    expect(onProjectArchived).toHaveBeenCalledWith("project-1");
    expect(onSelect).toHaveBeenCalledWith("project-1");
  });
});
