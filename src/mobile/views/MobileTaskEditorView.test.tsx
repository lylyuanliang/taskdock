import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MobileTaskEditorView from "./MobileTaskEditorView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);
afterEach(cleanup);
beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command) => {
    if (command === "list_projects") return Promise.resolve([{ id: "project-1", name: "Launch" }]);
    return Promise.resolve({
      task: {
        id: "task-1",
        title: "Existing",
        note: "Old note",
        projectId: "project-1",
        priority: "Normal",
        scheduledAt: null,
        dueAt: null,
        completedAt: null,
        parentId: null,
        recurrence: null,
        createdAt: "2026-09-24",
        updatedAt: "2026-09-24",
        revision: 1,
      },
      tagNames: ["work"],
      subtasks: [],
    });
  });
});

it("renders editable title, note, project, priority, date and tags", async () => {
  const onDirtyChange = vi.fn();
  render(
    <MobileTaskEditorView
      taskId="task-1"
      mode="edit"
      onSaved={vi.fn()}
      onCancelled={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  );
  expect(screen.getByRole("form")).toHaveAttribute("data-state", "default");
  expect(await screen.findByLabelText("Task title")).toHaveValue("Existing");
  expect(screen.getByLabelText("Note")).toBeInTheDocument();
  expect(screen.getByLabelText("Project")).toBeInTheDocument();
  expect(screen.getByLabelText("Priority")).toBeInTheDocument();
  expect(screen.getByLabelText("Scheduled time")).toBeInTheDocument();
  expect(screen.getByLabelText("Tags")).toBeInTheDocument();
  expect(screen.getByLabelText("Scheduled time")).toHaveValue("");
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it("exposes explicit visual fixture states on the editor form", () => {
  render(
    <MobileTaskEditorView
      taskId={null}
      mode="create"
      visualState="disabled"
      onSaved={vi.fn()}
      onCancelled={vi.fn()}
      onDirtyChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("form")).toHaveAttribute("data-state", "disabled");
});

it("reports field changes as dirty and clears the state after a successful save", async () => {
  const user = userEvent.setup();
  const onDirtyChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <MobileTaskEditorView
      taskId="task-1"
      mode="edit"
      onSaved={onSaved}
      onCancelled={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  );
  const title = await screen.findByLabelText("Task title");
  await user.type(title, " changed");
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  await user.click(screen.getByRole("button", { name: "Save task" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it("prevents duplicate submits and retains input after save errors", async () => {
  const user = userEvent.setup();
  invokeMock.mockImplementation((command) => {
    if (command === "list_projects") return Promise.resolve([]);
    if (command === "get_task_editor")
      return Promise.resolve({
        task: {
          id: "task-1",
          title: "Existing",
          note: "",
          projectId: null,
          priority: "Normal",
          scheduledAt: null,
          dueAt: null,
          completedAt: null,
          parentId: null,
          recurrence: null,
          createdAt: "2026-09-24",
          updatedAt: "2026-09-24",
          revision: 1,
        },
        tagNames: [],
        subtasks: [],
      });
    return Promise.reject({ message_key: "errors.task.title.blank" });
  });
  render(
    <MobileTaskEditorView
      taskId="task-1"
      mode="edit"
      onSaved={vi.fn()}
      onCancelled={vi.fn()}
      onDirtyChange={vi.fn()}
    />,
  );
  const title = await screen.findByLabelText("Task title");
  await user.clear(title);
  await user.type(title, "Retained title");
  const save = screen.getByRole("button", { name: "Save task" });
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(title).toHaveValue("Retained title");
  expect(
    invokeMock.mock.calls.filter(([command]) => command === "update_task_editor"),
  ).toHaveLength(1);
});

it("keeps an existing task clean until an editable field changes", async () => {
  const onDirtyChange = vi.fn();

  render(
    <MobileTaskEditorView
      taskId="task-1"
      mode="edit"
      onSaved={vi.fn()}
      onCancelled={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  );

  await screen.findByDisplayValue("Existing");
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));

  fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "High" } });
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
});
