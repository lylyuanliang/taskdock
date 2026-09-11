import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

const secondProject = {
  ...project,
  id: "project-2",
  name: "Backlog",
};

interface Deferred<Value> {
  promise: Promise<Value>;
  reject: (reason?: unknown) => void;
  resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let rejectPromise: (reason?: unknown) => void;
  let resolvePromise: (value: Value | PromiseLike<Value>) => void;

  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: (reason?: unknown) => rejectPromise(reason),
    resolve: (value: Value) => resolvePromise(value),
  };
}

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

  it("disables project mutations while the project list is loading", () => {
    render(
      <ProjectList
        isLoading
        listErrorMessageKey={null}
        onProjectArchived={vi.fn()}
        onProjectCreated={vi.fn()}
        onProjectRenamed={vi.fn()}
        onSelect={vi.fn()}
        projects={[project]}
        selectedProjectId={null}
      />,
    );

    expect(screen.getByLabelText("Project name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Release" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename Release" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive Release" })).toBeDisabled();
  });

  it("prevents duplicate creates while the create command is pending and restores controls", async () => {
    const user = userEvent.setup();
    const createRequest = deferred<typeof project>();
    const onProjectCreated = vi.fn();
    invokeMock.mockImplementation((command) =>
      command === "create_project" ? createRequest.promise : Promise.resolve(project),
    );

    render(
      <ProjectList
        isLoading={false}
        listErrorMessageKey={null}
        onProjectArchived={vi.fn()}
        onProjectCreated={onProjectCreated}
        onProjectRenamed={vi.fn()}
        onSelect={vi.fn()}
        projects={[project]}
        selectedProjectId={null}
      />,
    );

    const nameInput = screen.getByLabelText("Project name");
    const createButton = screen.getByRole("button", { name: "Create project" });
    await user.type(nameInput, "Planning");
    await user.dblClick(createButton);

    expect(nameInput).toBeDisabled();
    expect(createButton).toBeDisabled();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    createRequest.resolve({ ...project, id: "project-3", name: "Planning" });

    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledTimes(1));
    expect(nameInput).toBeEnabled();
    expect(createButton).toBeEnabled();
  });

  it("prevents same-tick direct create form reentry", async () => {
    const createRequest = deferred<typeof project>();
    const onProjectCreated = vi.fn();
    invokeMock.mockImplementation((command) =>
      command === "create_project" ? createRequest.promise : Promise.resolve(project),
    );

    render(
      <ProjectList
        isLoading={false}
        listErrorMessageKey={null}
        onProjectArchived={vi.fn()}
        onProjectCreated={onProjectCreated}
        onProjectRenamed={vi.fn()}
        onSelect={vi.fn()}
        projects={[project]}
        selectedProjectId={null}
      />,
    );

    const createForm = screen.getByLabelText("Project name").closest("form");
    if (!createForm) {
      throw new Error("The create form is required for the reentry test");
    }

    act(() => {
      createForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      createForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);

    createRequest.resolve(project);
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledTimes(1));
  });

  it("locks the pending project rename without blocking other project selection and restores after rejection", async () => {
    const user = userEvent.setup();
    const renameRequest = deferred<typeof project>();
    invokeMock.mockImplementation((command) =>
      command === "rename_project" ? renameRequest.promise : Promise.resolve(project),
    );

    render(
      <ProjectList
        isLoading={false}
        listErrorMessageKey={null}
        onProjectArchived={vi.fn()}
        onProjectCreated={vi.fn()}
        onProjectRenamed={vi.fn()}
        onSelect={vi.fn()}
        projects={[project, secondProject]}
        selectedProjectId={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rename Release" }));
    const renameInput = screen.getByLabelText("Rename Release");
    await user.clear(renameInput);
    await user.type(renameInput, "Release notes");
    await user.click(screen.getByRole("button", { name: "Save project name" }));

    expect(screen.getByRole("button", { name: "Release" })).toBeDisabled();
    expect(renameInput).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save project name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive Release" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Backlog" })).toBeEnabled();
    expect(screen.getByLabelText("Project name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename Backlog" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive Backlog" })).toBeDisabled();

    renameRequest.reject({ code: "project.rename", message_key: "errors.project.name.duplicate" });

    await waitFor(() => expect(renameInput).toBeEnabled());
    expect(screen.getByRole("button", { name: "Release" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Archive Release" })).toBeEnabled();
  });

  it("prevents same-tick direct rename form reentry", async () => {
    const user = userEvent.setup();
    const renameRequest = deferred<typeof project>();
    const onProjectRenamed = vi.fn();
    invokeMock.mockImplementation((command) =>
      command === "rename_project" ? renameRequest.promise : Promise.resolve(project),
    );

    render(
      <ProjectList
        isLoading={false}
        listErrorMessageKey={null}
        onProjectArchived={vi.fn()}
        onProjectCreated={vi.fn()}
        onProjectRenamed={onProjectRenamed}
        onSelect={vi.fn()}
        projects={[project]}
        selectedProjectId={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rename Release" }));
    const renameForm = screen.getByLabelText("Rename Release").closest("form");
    if (!renameForm) {
      throw new Error("The rename form is required for the reentry test");
    }

    act(() => {
      renameForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      renameForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);

    renameRequest.resolve(project);
    await waitFor(() => expect(onProjectRenamed).toHaveBeenCalledTimes(1));
  });

  it("locks the archived project while keeping other projects readable and restores after rejection", async () => {
    const user = userEvent.setup();
    const archiveRequest = deferred<typeof project>();
    invokeMock.mockImplementation((command) =>
      command === "archive_project" ? archiveRequest.promise : Promise.resolve(project),
    );

    render(
      <ProjectList
        isLoading={false}
        listErrorMessageKey={null}
        onProjectArchived={vi.fn()}
        onProjectCreated={vi.fn()}
        onProjectRenamed={vi.fn()}
        onSelect={vi.fn()}
        projects={[project, secondProject]}
        selectedProjectId={null}
      />,
    );

    const archiveButton = screen.getByRole("button", { name: "Archive Release" });
    await user.click(archiveButton);

    expect(screen.getByRole("button", { name: "Release" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename Release" })).toBeDisabled();
    expect(archiveButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Backlog" })).toBeEnabled();
    expect(screen.getByLabelText("Project name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename Backlog" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive Backlog" })).toBeDisabled();

    archiveRequest.reject({ code: "project.archive", message_key: "errors.project.not_found" });

    await waitFor(() => expect(archiveButton).toBeEnabled());
    expect(screen.getByRole("button", { name: "Release" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rename Release" })).toBeEnabled();
  });

  it("shows list and mutation failures as separate alerts", async () => {
    const user = userEvent.setup();
    invokeMock.mockRejectedValueOnce({
      code: "project.create",
      message_key: "errors.project.name.duplicate",
    });

    render(
      <ProjectList
        isLoading={false}
        listErrorMessageKey="errors.storage.unavailable"
        onProjectArchived={vi.fn()}
        onProjectCreated={vi.fn()}
        onProjectRenamed={vi.fn()}
        onSelect={vi.fn()}
        projects={[project]}
        selectedProjectId={null}
      />,
    );

    await user.type(screen.getByLabelText("Project name"), "Planning");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent("Local storage is temporarily unavailable");
    expect(alerts[1]).toHaveTextContent("A project with this name already exists");
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
