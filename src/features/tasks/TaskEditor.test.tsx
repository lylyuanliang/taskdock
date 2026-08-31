import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskEditor from "./TaskEditor";
import type { TaskDto } from "./taskTypes";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const existingTask: TaskDto = {
  id: "task-1",
  title: "Review schema",
  note: "Check indexes",
  projectId: null,
  parentId: null,
  priority: "Normal",
  scheduledAt: null,
  dueAt: null,
  completedAt: null,
  recurrence: null,
  createdAt: "2026-08-27T00:00:00Z",
  updatedAt: "2026-08-27T00:00:00Z",
};

const nextTask: TaskDto = {
  ...existingTask,
  id: "task-2",
  title: "Prepare demo",
  note: "Show migration result",
};

const archivedProjectTask: TaskDto = {
  ...existingTask,
  projectId: "archived-project-1",
};

describe("TaskEditor", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") {
        return Promise.resolve([]);
      }

      return Promise.resolve({
        id: "task-1",
        title: "Review schema",
        note: "",
        projectId: null,
        parentId: null,
        priority: "Normal",
        scheduledAt: null,
        dueAt: null,
        completedAt: null,
        recurrence: null,
        createdAt: "2026-08-27T00:00:00Z",
        updatedAt: "2026-08-27T00:00:00Z",
      });
    });
  });

  it("saves a trimmed title and refreshes the list", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    render(<TaskEditor onSaved={onSaved} />);

    await user.type(screen.getByLabelText("Task title"), "  Review schema  ");
    await user.click(screen.getByRole("button", { name: "Save task" }));

    expect(invokeMock).toHaveBeenCalledWith("create_task", {
      draft: { title: "Review schema", note: "" },
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("shows the structured message key when saving fails", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") {
        return Promise.resolve([]);
      }

      return Promise.reject({
        code: "task.title.invalid",
        message_key: "errors.task.title.invalid",
        message: "Backend validation details must stay private",
      });
    });

    render(<TaskEditor onSaved={onSaved} />);

    await user.type(screen.getByLabelText("Task title"), "Review schema");
    await user.click(screen.getByRole("button", { name: "Save task" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Task title is invalid");
    expect(
      screen.queryByText("Backend validation details must stay private"),
    ).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("updates an existing task with its prefilled title and note", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    render(<TaskEditor onSaved={onSaved} task={existingTask} />);

    const titleInput = screen.getByLabelText("Task title");
    const noteInput = screen.getByLabelText("Note");
    expect(titleInput).toHaveValue("Review schema");
    expect(noteInput).toHaveValue("Check indexes");

    await user.clear(titleInput);
    await user.type(titleInput, "  Review release  ");
    await user.clear(noteInput);
    await user.type(noteInput, "Add migration result");
    await user.click(screen.getByRole("button", { name: "Update task" }));

    expect(invokeMock).toHaveBeenCalledWith("update_task", {
      id: "task-1",
      patch: { title: "Review release", note: "Add migration result" },
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("sends projectId only when the selected project changes", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    invokeMock
      .mockReset()
      .mockResolvedValueOnce([
        {
          archivedAt: null,
          createdAt: "2026-08-28T00:00:00Z",
          id: "project-1",
          name: "Release",
          updatedAt: "2026-08-28T00:00:00Z",
        },
      ])
      .mockResolvedValue(existingTask);

    render(<TaskEditor onSaved={onSaved} task={existingTask} />);

    await user.selectOptions(await screen.findByLabelText("Project"), "project-1");
    await user.click(screen.getByRole("button", { name: "Update task" }));

    expect(invokeMock).toHaveBeenLastCalledWith("update_task", {
      id: "task-1",
      patch: { note: "Check indexes", projectId: "project-1", title: "Review schema" },
    });
  });

  it("preserves an archived project association when only title and note change", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    render(<TaskEditor onSaved={onSaved} task={archivedProjectTask} />);

    const titleInput = screen.getByLabelText("Task title");
    const noteInput = screen.getByLabelText("Note");
    await user.clear(titleInput);
    await user.type(titleInput, "Publish final notes");
    await user.clear(noteInput);
    await user.type(noteInput, "Keep archived history");
    await user.click(screen.getByRole("button", { name: "Update task" }));

    expect(invokeMock).toHaveBeenLastCalledWith("update_task", {
      id: "task-1",
      patch: { note: "Keep archived history", title: "Publish final notes" },
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("replaces an unsaved draft when a different task is selected", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const { rerender } = render(<TaskEditor onSaved={onSaved} task={existingTask} />);

    const titleInput = screen.getByLabelText("Task title");
    const noteInput = screen.getByLabelText("Note");
    await user.clear(titleInput);
    await user.type(titleInput, "Unsaved title");
    await user.clear(noteInput);
    await user.type(noteInput, "Unsaved note");

    rerender(<TaskEditor onSaved={onSaved} task={nextTask} />);

    expect(titleInput).toHaveValue("Prepare demo");
    expect(noteInput).toHaveValue("Show migration result");
  });
});
