import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskEditor from "./TaskEditor";
import type { TaskDto } from "./taskTypes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let reject: (reason: unknown) => void = () => undefined;
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const existingTask: TaskDto = {
  completedAt: null,
  createdAt: "2026-08-27T00:00:00Z",
  dueAt: "2026-09-10T10:30:00Z",
  id: "task-1",
  note: "Check indexes",
  parentId: null,
  priority: "High",
  projectId: null,
  recurrence: { count: 3, frequency: "weekly", interval: 2, until: "2026-10-01" },
  revision: 4,
  scheduledAt: "2026-09-09T09:30:00Z",
  title: "Review schema",
  updatedAt: "2026-08-27T00:00:00Z",
};

const editor = {
  subtasks: [{ ...existingTask, id: "subtask-1", recurrence: null, title: "Confirm owners" }],
  tagNames: ["release", "database"],
  task: existingTask,
};

type EditorUser = ReturnType<typeof userEvent.setup>;

interface ParentDraftChange {
  apply: (user: EditorUser) => Promise<void>;
  description: string;
}

const parentDraftChanges: readonly ParentDraftChange[] = [
  {
    apply: async (user) => {
      await user.clear(screen.getByLabelText("Task title"));
      await user.type(screen.getByLabelText("Task title"), "Changed parent title");
    },
    description: "title",
  },
  {
    apply: async (user) => {
      await user.clear(screen.getByLabelText("Note"));
      await user.type(screen.getByLabelText("Note"), "Changed parent note");
    },
    description: "note",
  },
  {
    apply: async (user) => {
      await user.selectOptions(screen.getByLabelText("Project"), "project-1");
    },
    description: "project",
  },
  {
    apply: async () => {
      fireEvent.change(screen.getByLabelText("Scheduled time"), {
        target: { value: "2026-09-11T10:30" },
      });
    },
    description: "schedule",
  },
  {
    apply: async (user) => {
      await user.selectOptions(screen.getByLabelText("Repeat"), "daily");
    },
    description: "recurrence",
  },
  {
    apply: async (user) => {
      await user.type(screen.getByLabelText("Tags"), "parent-tag");
      await user.keyboard("{Enter}");
    },
    description: "confirmed tag",
  },
  {
    apply: async (user) => {
      await user.type(screen.getByLabelText("Tags"), "unconfirmed-parent-tag");
    },
    description: "unconfirmed tag input",
  },
];

function setupMock() {
  invokeMock.mockImplementation((command) => {
    if (command === "list_projects") return Promise.resolve([]);
    if (
      command === "get_task_editor" ||
      command === "create_task_editor" ||
      command === "update_task_editor"
    ) {
      return Promise.resolve(editor);
    }
    return Promise.resolve(existingTask);
  });
}

describe("TaskEditor", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setupMock();
  });

  afterEach(cleanup);

  it("creates a normalized tagged task through the editor API", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<TaskEditor onSaved={onSaved} />);

    await user.type(screen.getByLabelText("Task title"), "  Plan launch  ");
    await user.selectOptions(screen.getByLabelText("Priority"), "High");
    fireEvent.change(screen.getByLabelText("Scheduled time"), {
      target: { value: "2026-09-11T10:30" },
    });
    await user.type(screen.getByLabelText("Tags"), " launch, launch ");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Save task" }));

    expect(invokeMock).toHaveBeenCalledWith("create_task_editor", {
      draft: {
        dueAt: null,
        note: "",
        priority: "High",
        projectId: null,
        recurrence: null,
        scheduledAt: new Date(2026, 8, 11, 10, 30).toISOString(),
        title: "Plan launch",
      },
      tagNames: ["launch"],
    });
    expect(onSaved).toHaveBeenCalledWith(editor);
  });

  it("submits a selected weekly recurrence with the snake_case wire value", async () => {
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Task title"), "Publish weekly release");
    fireEvent.change(screen.getByLabelText("Scheduled time"), {
      target: { value: "2026-09-11T10:30" },
    });
    await user.selectOptions(screen.getByLabelText("Repeat"), "weekly");
    await user.click(screen.getByRole("button", { name: "Save task" }));

    expect(invokeMock).toHaveBeenCalledWith(
      "create_task_editor",
      expect.objectContaining({
        draft: expect.objectContaining({
          recurrence: {
            count: null,
            frequency: "weekly",
            interval: 1,
            until: null,
          },
        }),
      }),
    );
  });

  it("displays a Rust-style yearly recurrence as a disabled legacy option", async () => {
    const legacyYearlyEditor = {
      ...editor,
      task: {
        ...existingTask,
        recurrence: { count: null, frequency: "yearly", interval: 1, until: null },
      },
    };
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return Promise.resolve(legacyYearlyEditor);
      return Promise.resolve(existingTask);
    });
    render(<TaskEditor onSaved={vi.fn()} task={existingTask} />);

    const recurrenceSelect = await screen.findByLabelText("Repeat");
    expect(recurrenceSelect).toHaveValue("yearly");
    expect(screen.getByRole("option", { name: "Yearly (legacy)" })).toBeDisabled();
  });

  it("loads task details and saves a complete patch using the loaded revision", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<TaskEditor onSaved={onSaved} task={existingTask} />);

    await screen.findByText("Confirm owners");
    expect(screen.getByText("release")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Priority"), "Low");
    await user.type(screen.getByLabelText("Tags"), "backend,");
    await user.click(screen.getByRole("button", { name: "Update task" }));

    expect(invokeMock).toHaveBeenCalledWith("update_task_editor", {
      expectedRevision: 4,
      id: "task-1",
      patch: {
        dueAt: "2026-09-10T10:30:00Z",
        note: "Check indexes",
        priority: "Low",
        projectId: null,
        recurrence: { count: 3, frequency: "weekly", interval: 2, until: "2026-10-01" },
        scheduledAt: "2026-09-09T09:30:00Z",
        title: "Review schema",
      },
      tagNames: ["release", "database", "backend"],
    });
    expect(onSaved).toHaveBeenCalledWith(editor);
  });

  it("keeps an unsaved draft until the user refreshes external changes", async () => {
    const externallyChangedEditor = {
      subtasks: [{ ...existingTask, id: "subtask-2", recurrence: null, title: "Check rollout" }],
      tagNames: ["external-change"],
      task: {
        ...existingTask,
        revision: 5,
        title: "Review external migration",
        updatedAt: "2026-08-27T02:00:00Z",
      },
    };
    let editorRequestCount = 0;
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") {
        editorRequestCount += 1;
        return Promise.resolve(editorRequestCount === 1 ? editor : externallyChangedEditor);
      }
      if (command === "update_task_editor") return Promise.resolve(externallyChangedEditor);
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    const rendered = render(
      <TaskEditor editorRefreshVersion={0} onSaved={vi.fn()} task={existingTask} />,
    );

    await screen.findByDisplayValue("Review schema");
    await user.clear(screen.getByLabelText("Task title"));
    await user.type(screen.getByLabelText("Task title"), "Keep my local draft");
    rendered.rerender(
      <TaskEditor editorRefreshVersion={1} onSaved={vi.fn()} task={existingTask} />,
    );

    expect(screen.getByDisplayValue("Keep my local draft")).toBeInTheDocument();
    expect(
      await screen.findByText("External changes are available. Refresh to load them."),
    ).toHaveAttribute("role", "status");
    expect(editorRequestCount).toBe(1);

    await user.click(screen.getByRole("button", { name: "Refresh external changes" }));

    expect(await screen.findByDisplayValue("Review external migration")).toBeInTheDocument();
    expect(screen.getByText("external-change")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Complete task Check rollout" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update task" }));
    expect(invokeMock).toHaveBeenCalledWith(
      "update_task_editor",
      expect.objectContaining({ expectedRevision: 5, id: existingTask.id }),
    );
  });

  it("applies a save response when a task mutation arrives while that editor is saving", async () => {
    const save = deferred<typeof editor>();
    const savedEditor = {
      ...editor,
      task: {
        ...existingTask,
        revision: 5,
        title: "Saved after mutation",
        updatedAt: "2026-08-27T03:00:00Z",
      },
    };
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return Promise.resolve(editor);
      if (command === "update_task_editor") return save.promise;
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const rendered = render(
      <TaskEditor editorRefreshVersion={0} onSaved={onSaved} task={existingTask} />,
    );

    await screen.findByDisplayValue("Review schema");
    await user.clear(screen.getByLabelText("Task title"));
    await user.type(screen.getByLabelText("Task title"), "Saved after mutation");
    await user.click(screen.getByRole("button", { name: "Update task" }));
    rendered.rerender(
      <TaskEditor editorRefreshVersion={1} onSaved={onSaved} task={existingTask} />,
    );

    expect(
      await screen.findByText("External changes are available. Refresh to load them."),
    ).toHaveAttribute("role", "status");
    expect(invokeMock.mock.calls.filter(([command]) => command === "get_task_editor")).toHaveLength(
      1,
    );
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve(savedEditor);
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedEditor));
    expect(screen.getByDisplayValue("Saved after mutation")).toBeInTheDocument();
  });

  for (const parentDraftChange of parentDraftChanges) {
    it(`blocks subtask completion while the parent ${parentDraftChange.description} is unsaved`, async () => {
      invokeMock.mockImplementation((command) => {
        if (command === "list_projects")
          return Promise.resolve([{ id: "project-1", name: "Release" }]);
        if (command === "get_task_editor") return Promise.resolve(editor);
        return Promise.resolve(existingTask);
      });
      const onSaved = vi.fn();
      const user = userEvent.setup();
      render(<TaskEditor onSaved={onSaved} task={existingTask} />);

      await screen.findByRole("checkbox", { name: "Complete task Confirm owners" });
      await parentDraftChange.apply(user);
      const completeCheckbox = screen.getByRole("checkbox", {
        name: "Complete task Confirm owners",
      });

      expect(completeCheckbox).toBeDisabled();
      await user.click(completeCheckbox);
      expect(invokeMock.mock.calls.some(([command]) => command === "complete_task")).toBe(false);
      expect(
        invokeMock.mock.calls.filter(([command]) => command === "get_task_editor"),
      ).toHaveLength(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(
        screen.getByText("Save parent task changes before changing subtasks."),
      ).toHaveAttribute("role", "status");
    });

    it(`blocks subtask creation while the parent ${parentDraftChange.description} is unsaved`, async () => {
      invokeMock.mockImplementation((command) => {
        if (command === "list_projects")
          return Promise.resolve([{ id: "project-1", name: "Release" }]);
        if (command === "get_task_editor") return Promise.resolve(editor);
        return Promise.resolve(existingTask);
      });
      const onSaved = vi.fn();
      const user = userEvent.setup();
      render(<TaskEditor onSaved={onSaved} task={existingTask} />);

      await screen.findByLabelText("New subtask");
      await parentDraftChange.apply(user);
      await user.type(screen.getByLabelText("New subtask"), "Blocked child task");
      const subtaskForm = screen.getByLabelText("New subtask").closest("form");
      if (!subtaskForm) {
        throw new Error("Expected the new subtask form to be rendered");
      }

      fireEvent.submit(subtaskForm);

      expect(invokeMock.mock.calls.some(([command]) => command === "create_subtask")).toBe(false);
      expect(
        invokeMock.mock.calls.filter(([command]) => command === "get_task_editor"),
      ).toHaveLength(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(
        screen.getByText("Save parent task changes before changing subtasks."),
      ).toHaveAttribute("role", "status");
    });
  }

  it("allows creating a subtask when only its title is unsaved", async () => {
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return Promise.resolve(editor);
      if (command === "create_subtask") return Promise.resolve(existingTask);
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={existingTask} />);

    await screen.findByLabelText("New subtask");
    await user.type(screen.getByLabelText("New subtask"), "Allowed child task");
    await user.click(screen.getByRole("button", { name: "Add subtask" }));

    expect(invokeMock).toHaveBeenCalledWith("create_subtask", {
      parentId: existingTask.id,
      title: "Allowed child task",
    });
  });

  it("does not render subtask creation controls for a child task", async () => {
    const childTask = {
      ...existingTask,
      id: "child-task-1",
      parentId: "parent-task-1",
      title: "Child task",
    };
    const childEditor = { ...editor, subtasks: [], task: childTask };
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return Promise.resolve(childEditor);
      return Promise.resolve(existingTask);
    });

    render(<TaskEditor onSaved={vi.fn()} task={childTask} />);

    await screen.findByDisplayValue("Child task");
    expect(screen.queryByLabelText("New subtask")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add subtask" })).not.toBeInTheDocument();
    expect(invokeMock.mock.calls.some(([command]) => command === "create_subtask")).toBe(false);
  });

  it("blocks a synthetic subtask submit after the current editor becomes a child", async () => {
    const mutableTask = {
      ...existingTask,
      parentId: null as string | null,
    };
    const mutableEditor = { ...editor, task: mutableTask };
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return Promise.resolve(mutableEditor);
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={mutableTask} />);

    const subtaskTitleInput = await screen.findByLabelText("New subtask");
    await user.type(subtaskTitleInput, "Blocked nested task");
    const subtaskForm = subtaskTitleInput.closest("form");
    if (!subtaskForm) throw new Error("Expected the new subtask form to be rendered");
    mutableEditor.task.parentId = "parent-task-1";

    fireEvent.submit(subtaskForm);

    expect(invokeMock.mock.calls.some(([command]) => command === "create_subtask")).toBe(false);
  });

  it("locks the parent editor through a pending subtask completion", async () => {
    const complete = deferred<TaskDto>();
    const onSaved = vi.fn();
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return Promise.resolve(editor);
      if (command === "complete_task") return complete.promise;
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={onSaved} task={existingTask} />);

    await screen.findByRole("checkbox", { name: "Complete task Confirm owners" });
    await user.click(screen.getByRole("checkbox", { name: "Complete task Confirm owners" }));

    expect(screen.getByLabelText("Task title")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Update task" })).toBeDisabled();
    const parentForm = screen.getByRole("button", { name: "Update task" }).closest("form");
    if (!parentForm) throw new Error("Expected the parent editor form to be rendered");
    fireEvent.submit(parentForm);
    expect(invokeMock.mock.calls.some(([command]) => command === "update_task_editor")).toBe(false);

    await act(async () => {
      complete.resolve(existingTask);
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(editor));
    expect(invokeMock.mock.calls.filter(([command]) => command === "get_task_editor")).toHaveLength(
      2,
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("locks the parent editor through a pending subtask creation", async () => {
    const create = deferred<TaskDto>();
    const onSaved = vi.fn();
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return Promise.resolve(editor);
      if (command === "create_subtask") return create.promise;
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={onSaved} task={existingTask} />);

    await screen.findByLabelText("New subtask");
    await user.type(screen.getByLabelText("New subtask"), "Verify rollout");
    await user.click(screen.getByRole("button", { name: "Add subtask" }));

    expect(screen.getByLabelText("Task title")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Update task" })).toBeDisabled();
    const parentForm = screen.getByRole("button", { name: "Update task" }).closest("form");
    if (!parentForm) throw new Error("Expected the parent editor form to be rendered");
    fireEvent.submit(parentForm);
    expect(invokeMock.mock.calls.some(([command]) => command === "update_task_editor")).toBe(false);

    await act(async () => {
      create.resolve(existingTask);
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(editor));
    expect(invokeMock.mock.calls.filter(([command]) => command === "get_task_editor")).toHaveLength(
      2,
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("locks subtask creation controls while a parent update is pending", async () => {
    const save = deferred<typeof editor>();
    const onSaved = vi.fn();
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return Promise.resolve(editor);
      if (command === "update_task_editor") return save.promise;
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={onSaved} task={existingTask} />);

    const completeCheckbox = await screen.findByRole("checkbox", {
      name: "Complete task Confirm owners",
    });
    const subtaskTitleInput = screen.getByLabelText("New subtask");
    await user.type(subtaskTitleInput, "Verify rollout");
    const subtaskForm = subtaskTitleInput.closest("form");
    if (!subtaskForm) throw new Error("Expected the new subtask form to be rendered");
    await user.click(screen.getByRole("button", { name: "Update task" }));

    expect(subtaskTitleInput).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add subtask" })).toBeDisabled();
    expect(completeCheckbox).toBeDisabled();
    fireEvent.submit(subtaskForm);
    expect(invokeMock.mock.calls.some(([command]) => command === "create_subtask")).toBe(false);

    await act(async () => {
      save.resolve(editor);
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(editor));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("blocks same-tick synthetic subtask completion when a parent update starts", async () => {
    const save = deferred<typeof editor>();
    const onSaved = vi.fn();
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return Promise.resolve(editor);
      if (command === "update_task_editor") return save.promise;
      return Promise.resolve(existingTask);
    });
    render(<TaskEditor onSaved={onSaved} task={existingTask} />);

    const completeCheckbox = await screen.findByRole("checkbox", {
      name: "Complete task Confirm owners",
    });
    const parentForm = screen.getByRole("button", { name: "Update task" }).closest("form");
    if (!parentForm) throw new Error("Expected the parent editor form to be rendered");

    act(() => {
      parentForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      completeCheckbox.click();
    });
    expect(invokeMock.mock.calls.some(([command]) => command === "complete_task")).toBe(false);

    await act(async () => {
      save.resolve(editor);
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(editor));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("saves an inbox child task without sending its inherited project", async () => {
    const childTask = {
      ...existingTask,
      id: "child-task-1",
      parentId: "parent-task-1",
      projectId: "project-1",
      title: "Inbox child task",
    };
    const childEditor = { ...editor, subtasks: [], task: childTask };
    const savedChildEditor = {
      ...childEditor,
      task: {
        ...childTask,
        note: "Keep inherited project",
        priority: "Low" as const,
        title: "Edited inbox child task",
      },
    };
    invokeMock.mockImplementation((command, args) => {
      if (command === "list_projects")
        return Promise.resolve([{ id: "project-1", name: "Roadmap" }]);
      if (command === "get_task_editor") return Promise.resolve(childEditor);
      if (command === "update_task_editor") {
        const patch =
          typeof args === "object" && args !== null && "patch" in args ? args.patch : null;
        if (typeof patch === "object" && patch !== null && "projectId" in patch) {
          return Promise.reject({
            code: "task.subtask.project.inherited",
            message_key: "errors.task.subtask.project.inherited",
          });
        }

        return Promise.resolve(savedChildEditor);
      }

      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<TaskEditor onSaved={onSaved} task={childTask} />);

    await screen.findByDisplayValue("Inbox child task");
    await user.clear(screen.getByLabelText("Task title"));
    await user.type(screen.getByLabelText("Task title"), "Edited inbox child task");
    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Keep inherited project");
    await user.selectOptions(screen.getByLabelText("Priority"), "Low");
    await user.type(screen.getByLabelText("Tags"), "inbox,");
    await user.click(screen.getByRole("button", { name: "Update task" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "update_task_editor",
        expect.objectContaining({
          expectedRevision: 4,
          id: "child-task-1",
          tagNames: ["release", "database", "inbox"],
        }),
      ),
    );
    const updateArguments = invokeMock.mock.calls.find(
      ([command]) => command === "update_task_editor",
    )?.[1];
    if (
      typeof updateArguments !== "object" ||
      updateArguments === null ||
      !("patch" in updateArguments)
    ) {
      throw new Error("Expected update_task_editor arguments to include a patch.");
    }

    expect(updateArguments.patch).toMatchObject({ title: "Edited inbox child task" });
    expect(updateArguments.patch).not.toHaveProperty("projectId");
    expect(screen.getByLabelText("Project")).toBeDisabled();
    expect(screen.getByLabelText("Project")).toHaveValue("Inherited from parent");
    expect(onSaved).toHaveBeenCalledWith(savedChildEditor);
    expect(await screen.findByDisplayValue("Edited inbox child task")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides recurrence editing and clears an unsupported recurrence when saving a child task", async () => {
    const childTask = {
      ...existingTask,
      id: "child-task-1",
      parentId: "parent-task-1",
      recurrence: { count: null, frequency: "daily" as const, interval: 1, until: null },
      title: "Scheduled child task",
    };
    const childEditor = { ...editor, subtasks: [], task: childTask };
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor" || command === "update_task_editor") {
        return Promise.resolve(childEditor);
      }
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={childTask} />);

    await screen.findByDisplayValue("Scheduled child task");
    expect(screen.queryByLabelText("Repeat")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Repeat interval")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Repeat until")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Repeat count")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update task" }));

    expect(invokeMock).toHaveBeenCalledWith(
      "update_task_editor",
      expect.objectContaining({
        patch: expect.objectContaining({ recurrence: null }),
      }),
    );
  });

  it("clears a historical recurrence when removing a child task schedule", async () => {
    const childTask = {
      ...existingTask,
      id: "child-task-1",
      parentId: "parent-task-1",
      recurrence: { count: null, frequency: "yearly" as const, interval: 1, until: null },
      title: "Legacy recurring child task",
    };
    const childEditor = { ...editor, subtasks: [], task: childTask };
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor" || command === "update_task_editor") {
        return Promise.resolve(childEditor);
      }
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={childTask} />);

    await screen.findByDisplayValue("Legacy recurring child task");
    await user.clear(screen.getByLabelText("Scheduled time"));
    await user.click(screen.getByRole("button", { name: "Update task" }));

    expect(invokeMock).toHaveBeenCalledWith(
      "update_task_editor",
      expect.objectContaining({
        patch: expect.objectContaining({ recurrence: null, scheduledAt: null }),
      }),
    );
  });

  it("shows a translated error when the backend rejects child recurrence", async () => {
    const childTask = {
      ...existingTask,
      id: "child-task-1",
      parentId: "parent-task-1",
      recurrence: null,
      title: "Scheduled child task",
    };
    const childEditor = { ...editor, subtasks: [], task: childTask };
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return Promise.resolve(childEditor);
      if (command === "update_task_editor") {
        return Promise.reject({
          code: "recurrence.child.unsupported",
          message_key: "errors.recurrence.child.unsupported",
        });
      }
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={childTask} />);

    await screen.findByDisplayValue("Scheduled child task");
    await user.click(screen.getByRole("button", { name: "Update task" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Subtasks cannot repeat.");
  });

  it("shows a clear client-side warning before saving a recurrence without a schedule", async () => {
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Task title"), "Pay invoices");
    await user.selectOptions(screen.getByLabelText("Repeat"), "monthly");
    await user.click(screen.getByRole("button", { name: "Save task" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Set a scheduled time before saving a repeating task.",
    );
    expect(invokeMock.mock.calls.some(([command]) => command === "create_task_editor")).toBe(false);
  });

  it("reloads details after completing and creating a direct subtask", async () => {
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={existingTask} />);

    await screen.findByText("Confirm owners");
    await user.click(screen.getByRole("checkbox", { name: "Complete task Confirm owners" }));
    await user.type(screen.getByLabelText("New subtask"), "Verify rollout");
    await user.click(screen.getByRole("button", { name: "Add subtask" }));

    expect(invokeMock).toHaveBeenCalledWith("complete_task", { id: "subtask-1" });
    expect(invokeMock).toHaveBeenCalledWith("create_subtask", {
      parentId: "task-1",
      title: "Verify rollout",
    });
    expect(invokeMock.mock.calls.filter(([command]) => command === "get_task_editor")).toHaveLength(
      3,
    );
  });

  it("does not submit an editor mutation twice while it is pending", async () => {
    let resolveSave: (value: typeof editor) => void = () => undefined;
    const pendingSave = new Promise<typeof editor>((resolve) => {
      resolveSave = resolve;
    });
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "create_task_editor") return pendingSave;
      return Promise.resolve(editor);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Task title"), "Write release notes");
    const form = screen.getByRole("button", { name: "Save task" }).closest("form");
    if (!form) throw new Error("Task editor form was not rendered");
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(
      invokeMock.mock.calls.filter(([command]) => command === "create_task_editor"),
    ).toHaveLength(1);
    resolveSave(editor);
  });

  it("announces project loading without disabling a new task draft", async () => {
    const projects = deferred<never[]>();
    invokeMock.mockImplementation((command) =>
      command === "list_projects" ? projects.promise : Promise.resolve(editor),
    );
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} />);

    expect(await screen.findByText("Loading projects...")).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("Project")).toBeDisabled();
    await user.type(screen.getByLabelText("Task title"), "Write release notes");
    expect(screen.getByLabelText("Task title")).toHaveValue("Write release notes");
  });

  it("keeps project unavailable after a structured load failure while allowing a projectless save", async () => {
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") {
        return Promise.reject({
          code: "storage.unavailable",
          message_key: "errors.storage.unavailable",
        });
      }
      return Promise.resolve(editor);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Local storage is temporarily unavailable",
    );
    expect(screen.getByLabelText("Project")).toBeDisabled();
    await user.type(screen.getByLabelText("Task title"), "Write release notes");
    await user.click(screen.getByRole("button", { name: "Save task" }));
    expect(invokeMock).toHaveBeenCalledWith(
      "create_task_editor",
      expect.objectContaining({ tagNames: [] }),
    );
  });

  it("uses only a structured message key when saving fails", async () => {
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "create_task_editor") {
        return Promise.reject({
          code: "task.title.invalid",
          message: "private backend detail",
          message_key: "errors.task.title.invalid",
        });
      }
      return Promise.resolve(editor);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Task title"), "Review schema");
    await user.click(screen.getByRole("button", { name: "Save task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Task title is invalid");
    expect(screen.queryByText("private backend detail")).not.toBeInTheDocument();
  });

  it("locks the main editor while saving and restores it after failure", async () => {
    const save = deferred<typeof editor>();
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "create_task_editor") return save.promise;
      return Promise.resolve(editor);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Task title"), "Write release notes");
    await user.click(screen.getByRole("button", { name: "Save task" }));
    expect(await screen.findByText("Saving task...")).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("Task title")).toBeDisabled();
    save.reject({ code: "task.title.invalid", message_key: "errors.task.title.invalid" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Task title is invalid");
    expect(screen.getByLabelText("Task title")).toBeEnabled();
  });

  it("validates a blank trimmed title before invoking the editor API", async () => {
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Task title"), "   ");
    await user.click(screen.getByRole("button", { name: "Save task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Task title is required");
    expect(invokeMock.mock.calls.some(([command]) => command === "create_task_editor")).toBe(false);
  });

  it("prefills loaded task fields and includes a changed project in the complete patch", async () => {
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects")
        return Promise.resolve([{ id: "project-1", name: "Release" }]);
      if (command === "get_task_editor" || command === "update_task_editor")
        return Promise.resolve(editor);
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={existingTask} />);

    expect(await screen.findByDisplayValue("Review schema")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Project"), "project-1");
    await user.click(screen.getByRole("button", { name: "Update task" }));
    expect(invokeMock).toHaveBeenCalledWith(
      "update_task_editor",
      expect.objectContaining({
        patch: expect.objectContaining({ projectId: "project-1" }),
      }),
    );
  });

  it("replaces an unsaved draft when a different task is selected", async () => {
    const nextTask = {
      ...existingTask,
      id: "task-2",
      note: "Show migration result",
      title: "Prepare demo",
    };
    const nextEditor = { ...editor, task: nextTask };
    invokeMock.mockImplementation((command, args) => {
      if (command === "list_projects") return Promise.resolve([]);
      const taskId = typeof args === "object" && args !== null && "id" in args ? args.id : null;
      if (command === "get_task_editor")
        return Promise.resolve(taskId === "task-2" ? nextEditor : editor);
      return Promise.resolve(editor);
    });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const rendered = render(<TaskEditor onSaved={onSaved} task={existingTask} />);
    await screen.findByDisplayValue("Review schema");
    await user.clear(screen.getByLabelText("Task title"));
    await user.type(screen.getByLabelText("Task title"), "Unsaved title");
    rendered.rerender(<TaskEditor onSaved={onSaved} task={nextTask} />);
    expect(await screen.findByDisplayValue("Prepare demo")).toBeInTheDocument();
  });

  it("announces an empty project result", async () => {
    render(<TaskEditor onSaved={vi.fn()} />);

    expect(await screen.findByText("No projects available.")).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("Project")).toBeEnabled();
  });

  it("explains that subtasks are unavailable until a new task is saved", async () => {
    render(<TaskEditor onSaved={vi.fn()} />);

    expect(screen.getByText("Save the task before adding subtasks.")).toBeInTheDocument();
    expect(screen.queryByLabelText("New subtask")).not.toBeInTheDocument();
  });

  it("removes a confirmed tag before submitting the complete tag list", async () => {
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={existingTask} />);

    await screen.findByText("release");
    await user.click(screen.getByRole("button", { name: "Remove tag database" }));
    await user.click(screen.getByRole("button", { name: "Update task" }));
    expect(invokeMock).toHaveBeenCalledWith(
      "update_task_editor",
      expect.objectContaining({ tagNames: ["release"] }),
    );
  });

  it("shows only a translated key when editor detail loading fails", async () => {
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") {
        return Promise.reject({
          code: "task.not_found",
          message: "private backend detail",
          message_key: "errors.task.not_found",
        });
      }
      return Promise.resolve(editor);
    });
    render(<TaskEditor onSaved={vi.fn()} task={existingTask} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Task not found");
    expect(screen.queryByText("private backend detail")).not.toBeInTheDocument();
  });

  it("disables an existing editor after its detail load fails and retries without saving", async () => {
    const load = deferred<typeof editor>();
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") return load.promise;
      return Promise.resolve(editor);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={existingTask} />);

    load.reject({ code: "task.not_found", message_key: "errors.task.not_found" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Task not found");
    expect(screen.getByRole("button", { name: "Update task" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(invokeMock.mock.calls.filter(([command]) => command === "get_task_editor")).toHaveLength(
      2,
    );
    expect(
      invokeMock.mock.calls.some(
        ([command]) => command === "create_task_editor" || command === "update_task_editor",
      ),
    ).toBe(false);
  });

  it("displays and preserves an archived project association when saving a note", async () => {
    const archivedTask = { ...existingTask, projectId: "archived-project" };
    const archivedEditor = { ...editor, task: archivedTask };
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor" || command === "update_task_editor") {
        return Promise.resolve(archivedEditor);
      }
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={archivedTask} />);

    await screen.findByDisplayValue("Review schema");
    expect(screen.getByLabelText("Project")).toHaveValue("archived-project");
    expect(screen.getByRole("option", { name: "Archived project (unavailable)" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Document the archived project");
    await user.click(screen.getByRole("button", { name: "Update task" }));

    expect(invokeMock).toHaveBeenCalledWith(
      "update_task_editor",
      expect.objectContaining({
        patch: expect.objectContaining({ projectId: "archived-project" }),
      }),
    );
  });

  it("clears an archived project association when selecting no project", async () => {
    const archivedTask = { ...existingTask, projectId: "archived-project" };
    const archivedEditor = { ...editor, task: archivedTask };
    invokeMock.mockImplementation((command) => {
      if (command === "list_projects")
        return Promise.resolve([{ id: "project-1", name: "Release" }]);
      if (command === "get_task_editor" || command === "update_task_editor") {
        return Promise.resolve(archivedEditor);
      }
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    render(<TaskEditor onSaved={vi.fn()} task={archivedTask} />);

    await screen.findByDisplayValue("Review schema");
    await user.selectOptions(screen.getByLabelText("Project"), "");
    await user.click(screen.getByRole("button", { name: "Update task" }));

    expect(invokeMock).toHaveBeenCalledWith(
      "update_task_editor",
      expect.objectContaining({
        patch: expect.objectContaining({ projectId: null }),
      }),
    );
  });

  it("resets subtask busy state for a new task instance without letting an old operation clear it", async () => {
    const nextTask = {
      ...existingTask,
      id: "task-2",
      title: "Prepare demo",
    };
    const nextEditor = {
      ...editor,
      subtasks: [],
      task: nextTask,
    };
    const completeFirstSubtask = deferred<TaskDto>();
    const createSecondSubtask = deferred<TaskDto>();
    invokeMock.mockImplementation((command, args) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "get_task_editor") {
        const taskId = typeof args === "object" && args !== null && "id" in args ? args.id : null;
        return Promise.resolve(taskId === "task-2" ? nextEditor : editor);
      }
      if (command === "complete_task") return completeFirstSubtask.promise;
      if (command === "create_subtask") return createSecondSubtask.promise;
      return Promise.resolve(existingTask);
    });
    const user = userEvent.setup();
    const rendered = render(<TaskEditor onSaved={vi.fn()} task={existingTask} />);

    await screen.findByRole("checkbox", { name: "Complete task Confirm owners" });
    await user.click(screen.getByRole("checkbox", { name: "Complete task Confirm owners" }));
    rendered.rerender(<TaskEditor onSaved={vi.fn()} task={nextTask} />);

    expect(await screen.findByDisplayValue("Prepare demo")).toBeInTheDocument();
    expect(screen.getByLabelText("New subtask")).toBeEnabled();
    await user.type(screen.getByLabelText("New subtask"), "Verify rollout");
    await user.click(screen.getByRole("button", { name: "Add subtask" }));
    expect(screen.getByLabelText("New subtask")).toBeDisabled();

    await act(async () => {
      completeFirstSubtask.resolve(existingTask);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByLabelText("New subtask")).toBeDisabled();
  });
});
