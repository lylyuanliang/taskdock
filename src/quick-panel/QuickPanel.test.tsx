import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskSummaryDto } from "../features/tasks/taskTypes";
import { QuickPanel } from "./QuickPanel";
import "./quickPanel.css";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

const openTodayTask: TaskSummaryDto = {
  childCompleted: 0,
  childTotal: 0,
  completed: false,
  dueAt: null,
  hasNote: true,
  id: "open-today",
  priority: "Normal",
  projectName: null,
  scheduledAt: "2026-08-28T09:00:00.000Z",
  tags: [],
  title: "Ship quick panel",
};

const completedTodayTask: TaskSummaryDto = {
  ...openTodayTask,
  completed: true,
  id: "completed-today",
  title: "Already complete",
};

describe("QuickPanel", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps Today tasks hidden until hover expansion completes", async () => {
    vi.useFakeTimers();

    render(
      <QuickPanel
        behavior="hover"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn().mockResolvedValue(undefined)}
        tasks={[openTodayTask, completedTodayTask]}
      />,
    );

    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();
    fireEvent.pointerEnter(screen.getByLabelText("Quick panel"));

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByText(openTodayTask.title)).toBeVisible();
    expect(screen.getByText(completedTodayTask.title)).toBeVisible();
  });

  it("shows completed Today tasks after active tasks in the expanded list", async () => {
    const user = userEvent.setup();

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn()}
        tasks={[openTodayTask, completedTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));

    expect(screen.getByText(openTodayTask.title)).toBeVisible();
    expect(screen.getByText(completedTodayTask.title)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Complete task Already complete" })).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Complete task Already complete" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("reserves a localized full-height collapsed drag handle beside the toggle", () => {
    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn()}
        tasks={[openTodayTask]}
      />,
    );

    const dragHandle = screen.getByLabelText("Move quick panel");
    const toggle = screen.getByRole("button", { name: "Open quick panel" });
    const dragHandleStyle = window.getComputedStyle(dragHandle);
    const toggleStyle = window.getComputedStyle(toggle);

    expect(dragHandle).toHaveAttribute("title", "Move quick panel");
    expect(dragHandle.querySelector("svg")).toHaveClass("lucide-grip-vertical");
    expect(dragHandleStyle.height).toBe("44px");
    expect(dragHandleStyle.left).toBe("0px");
    expect(dragHandleStyle.width).toBe("16px");
    expect(toggleStyle.right).toBe("0px");
    expect(toggleStyle.width).toBe("28px");
    expect(toggle).not.toHaveAttribute("data-tauri-drag-region");
  });

  it("starts native dragging when the collapsed handle icon receives a primary mouse press", () => {
    const startDragging = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getCurrentWindow).mockReturnValue({
      startDragging,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn()}
        tasks={[openTodayTask]}
      />,
    );

    const dragIcon = screen.getByLabelText("Move quick panel").querySelector("svg");
    if (!dragIcon) {
      throw new Error("Expected the collapsed drag icon to render");
    }

    fireEvent.mouseDown(dragIcon, { button: 0, buttons: 1 });

    expect(startDragging).toHaveBeenCalledOnce();
  });

  it("collapses after the hover exit delay", async () => {
    vi.useFakeTimers();

    render(
      <QuickPanel
        behavior="hover"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn().mockResolvedValue(undefined)}
        tasks={[openTodayTask]}
      />,
    );

    fireEvent.pointerEnter(screen.getByLabelText("Quick panel"));
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.pointerLeave(screen.getByLabelText("Quick panel"));

    act(() => {
      vi.advanceTimersByTime(219);
    });
    expect(screen.getByText(openTodayTask.title)).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();
  });

  it("uses the floating icon as the only state toggle in click mode", async () => {
    const user = userEvent.setup();

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn()}
        tasks={[openTodayTask]}
      />,
    );

    fireEvent.pointerEnter(screen.getByLabelText("Quick panel"));
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    expect(screen.getByText(openTodayTask.title)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Collapse quick panel" }));
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();
  });

  it("exposes the full title while clamping long task text", async () => {
    const user = userEvent.setup();
    const longTitle = "A task title that is long enough to require two-line truncation";

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn()}
        tasks={[{ ...openTodayTask, title: longTitle }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));

    expect(screen.getByRole("button", { name: longTitle })).toHaveAttribute("title", longTitle);
  });

  it("opens the main window from the expanded header without starting a drag", async () => {
    const user = userEvent.setup();
    const onOpenMainWindow = vi.fn().mockResolvedValue(undefined);
    const startDragging = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getCurrentWindow).mockReturnValue({
      startDragging,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn().mockResolvedValue(undefined)}
        onOpenMainWindow={onOpenMainWindow}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    await user.click(screen.getByRole("button", { name: "Open main window" }));

    expect(onOpenMainWindow).toHaveBeenCalledOnce();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("exits the application from the expanded header without starting a drag", async () => {
    const user = userEvent.setup();
    const onExitApp = vi.fn().mockResolvedValue(undefined);
    const startDragging = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getCurrentWindow).mockReturnValue({
      startDragging,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onExitApp={onExitApp}
        onModeChange={vi.fn().mockResolvedValue(undefined)}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    await user.click(screen.getByRole("button", { name: "Exit TaskDock" }));

    expect(onExitApp).toHaveBeenCalledOnce();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("exposes a draggable header and a directional collapse control when expanded", async () => {
    const user = userEvent.setup();

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn().mockResolvedValue(undefined)}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));

    const dragHeader = screen.getByLabelText("Move quick panel");
    const collapseButton = screen.getByRole("button", { name: "Collapse quick panel" });

    expect(dragHeader).toHaveAttribute("title", "Move quick panel");
    expect(dragHeader.querySelector("svg")).toHaveClass("lucide-grip-horizontal");
    expect(collapseButton.querySelector("svg")).toHaveClass("lucide-minus");
    expect(collapseButton.closest(".quick-panel__header")).not.toBeNull();
  });

  it("opens the project picker from the selected rail tab with counts and selection state", async () => {
    const user = userEvent.setup();
    const workProject = {
      archivedAt: null,
      createdAt: "2026-08-28T09:00:00.000Z",
      id: "project-work",
      name: "Work",
      updatedAt: "2026-08-28T09:00:00.000Z",
    };

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn()}
        projects={[workProject]}
        tasks={[
          { ...openTodayTask, projectName: "Work" },
          { ...completedTodayTask, projectName: "Work" },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    await user.click(screen.getByRole("button", { name: "All projects" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeVisible();
    const allProjectsOption = within(dialog).getByRole("button", { name: /All projects/ });
    expect(allProjectsOption).toHaveTextContent("2");
    expect(allProjectsOption).toHaveAttribute("aria-checked", "true");
  });

  it("switches projects directly from a neighboring rail tab", async () => {
    const user = userEvent.setup();
    const workProject = {
      archivedAt: null,
      createdAt: "2026-08-28T09:00:00.000Z",
      id: "project-work",
      name: "Work",
      updatedAt: "2026-08-28T09:00:00.000Z",
    };
    const personalProject = {
      ...workProject,
      id: "project-personal",
      name: "Personal",
    };

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn()}
        projects={[workProject, personalProject]}
        tasks={[
          { ...openTodayTask, id: "work-task", projectName: "Work", title: "Work task" },
          {
            ...openTodayTask,
            id: "personal-task",
            projectName: "Personal",
            title: "Personal task",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    await user.click(screen.getByRole("button", { name: "Work" }));

    expect(screen.getByText("Work task")).toBeVisible();
    expect(screen.queryByText("Personal task")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("completes an open Today task through the supplied real task callback", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    render(
      <QuickPanel
        behavior="click"
        onComplete={onComplete}
        onCreate={vi.fn()}
        onModeChange={vi.fn()}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    await user.click(screen.getByRole("checkbox", { name: "Complete task Ship quick panel" }));

    expect(onComplete).toHaveBeenCalledWith(openTodayTask.id);
  });

  it("creates a scheduled Today task through the supplied callback", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={onCreate}
        onModeChange={vi.fn()}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    const titleInput = screen.getByRole("textbox", { name: "Add task" });
    await user.type(titleInput, "Capture release note");
    vi.setSystemTime(new Date("2026-08-28T14:30:00.000Z"));
    fireEvent.submit(titleInput.closest("form") as HTMLFormElement);

    expect(onCreate).toHaveBeenCalledWith({
      note: "",
      scheduledAt: "2026-08-28T14:30:00.000Z",
      title: "Capture release note",
    });
  });

  it("opens from keyboard focus and retains focus work after the pointer leaves", async () => {
    vi.useFakeTimers();
    const onModeChange = vi.fn().mockResolvedValue(undefined);

    render(
      <QuickPanel
        behavior="hover"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={onModeChange}
        tasks={[openTodayTask]}
      />,
    );

    fireEvent.focus(screen.getByRole("button", { name: "Open quick panel" }));
    await act(async () => undefined);

    expect(onModeChange).toHaveBeenCalledWith("expanded");
    const titleInput = screen.getByRole("textbox", { name: "Add task" });
    fireEvent.focus(titleInput);
    fireEvent.pointerLeave(screen.getByLabelText("Quick panel"));
    act(() => vi.advanceTimersByTime(220));
    expect(titleInput).toBeVisible();

    fireEvent.blur(titleInput, { relatedTarget: null });
    act(() => vi.advanceTimersByTime(220));
    await act(async () => undefined);
    expect(screen.queryByRole("textbox", { name: "Add task" })).not.toBeInTheDocument();
  });

  it("cancels a pending hover expansion when behavior changes to click", () => {
    vi.useFakeTimers();
    const onModeChange = vi.fn();
    const { rerender } = render(
      <QuickPanel
        behavior="hover"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={onModeChange}
        tasks={[openTodayTask]}
      />,
    );

    fireEvent.pointerEnter(screen.getByLabelText("Quick panel"));
    rerender(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={onModeChange}
        tasks={[openTodayTask]}
      />,
    );
    act(() => vi.advanceTimersByTime(150));

    expect(onModeChange).not.toHaveBeenCalled();
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();
  });

  it("keeps the current mode and reports a rejected native mode change", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn().mockRejectedValue({
      code: "quick_panel_unavailable",
      message_key: "errors.storage.unavailable",
    });

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={onModeChange}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));

    expect(screen.getByRole("button", { name: "Open quick panel" })).toBeEnabled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Local storage is temporarily unavailable",
    );
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();
  });

  it("layers a command error outside the expanded panel's normal content layout", async () => {
    const user = userEvent.setup();

    render(
      <QuickPanel
        behavior="click"
        errorMessageKey="errors.storage.unavailable"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onModeChange={vi.fn().mockResolvedValue(undefined)}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));

    const alert = screen.getByRole("alert");
    const errorStyle = window.getComputedStyle(alert);

    expect(errorStyle.position).toBe("absolute");
    expect(errorStyle.bottom).toBe("48px");
  });

  it("retains failed capture input and blocks duplicate create submissions", async () => {
    const user = userEvent.setup();
    const createRequest = deferred<void>();
    const onCreate = vi.fn().mockReturnValue(createRequest.promise);

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={onCreate}
        onModeChange={vi.fn().mockResolvedValue(undefined)}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    const titleInput = screen.getByRole("textbox", { name: "Add task" });
    await user.type(titleInput, "Keep this title");
    const form = titleInput.closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(titleInput).toBeDisabled();

    await act(async () => {
      createRequest.reject({
        code: "storage_unavailable",
        message_key: "errors.storage.unavailable",
      });
    });

    expect(titleInput).toHaveValue("Keep this title");
    expect(titleInput).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Local storage is temporarily unavailable");
  });

  it("blocks duplicate completion while pending and recovers after rejection", async () => {
    const user = userEvent.setup();
    const completeRequest = deferred<void>();
    const onComplete = vi.fn().mockReturnValue(completeRequest.promise);

    render(
      <QuickPanel
        behavior="click"
        onComplete={onComplete}
        onCreate={vi.fn()}
        onModeChange={vi.fn().mockResolvedValue(undefined)}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    const completeButton = screen.getByRole("checkbox", {
      name: "Complete task Ship quick panel",
    });
    await user.click(completeButton);
    await user.click(completeButton);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(completeButton).toBeDisabled();

    await act(async () => {
      completeRequest.reject({
        code: "storage_unavailable",
        message_key: "errors.storage.unavailable",
      });
    });

    expect(completeButton).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Local storage is temporarily unavailable");
  });

  it("edits a task title inline and saves a note from the anchored bubble", async () => {
    const user = userEvent.setup();
    const onLoadTaskEditor = vi.fn().mockResolvedValue({
      subtasks: [],
      tagNames: [],
      task: {
        ...openTodayTask,
        createdAt: "2026-08-28T09:00:00.000Z",
        note: "Existing note",
        parentId: null,
        projectId: null,
        updatedAt: "2026-08-28T09:00:00.000Z",
        completedAt: null,
        revision: 1,
      },
    });
    const onUpdateTask = vi.fn().mockResolvedValue(undefined);

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onLoadTaskEditor={onLoadTaskEditor}
        onModeChange={vi.fn()}
        onUpdateTask={onUpdateTask}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    await user.click(screen.getByRole("button", { name: openTodayTask.title }));
    const titleInput = screen.getByRole("textbox", { name: /Task title/ });
    await user.clear(titleInput);
    await user.type(titleInput, "Updated task");
    fireEvent.blur(titleInput, { relatedTarget: null });
    await waitFor(() =>
      expect(onUpdateTask).toHaveBeenCalledWith(openTodayTask.id, { title: "Updated task" }),
    );

    await user.click(screen.getByRole("button", { name: `Edit note ${openTodayTask.title}` }));
    const noteInput = await screen.findByRole("textbox", { name: `Note ${openTodayTask.title}` });
    expect(onLoadTaskEditor).toHaveBeenCalledWith(openTodayTask.id);
    await user.clear(noteInput);
    await user.type(noteInput, "Updated note");
    expect(screen.getByText("Auto-save")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save note" })).toBeVisible();
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(onUpdateTask).toHaveBeenCalledWith(openTodayTask.id, { note: "Updated note" }),
    );
  });

  it("keeps an add-note entry visible until a task has a note", async () => {
    const user = userEvent.setup();
    const onLoadTaskEditor = vi.fn().mockResolvedValue({
      subtasks: [],
      tagNames: [],
      task: {
        ...openTodayTask,
        note: "",
      },
    });

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={vi.fn()}
        onLoadTaskEditor={onLoadTaskEditor}
        onModeChange={vi.fn()}
        tasks={[{ ...openTodayTask, hasNote: false }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));

    const addNoteButton = screen.getByRole("button", {
      name: `Add note ${openTodayTask.title}`,
    });
    expect(addNoteButton).toBeVisible();
    expect(addNoteButton.querySelector("svg")).toHaveClass("lucide-message-square-plus");

    await user.click(addNoteButton);
    expect(onLoadTaskEditor).toHaveBeenCalledWith(openTodayTask.id);
    expect(
      await screen.findByRole("textbox", { name: `Note ${openTodayTask.title}` }),
    ).toBeVisible();
  });

  it("expands quick capture with a project and creates the task", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const project = {
      archivedAt: null,
      createdAt: "2026-08-28T09:00:00.000Z",
      id: "project-work",
      name: "Work",
      updatedAt: "2026-08-28T09:00:00.000Z",
    };

    render(
      <QuickPanel
        behavior="click"
        onComplete={vi.fn()}
        onCreate={onCreate}
        onModeChange={vi.fn()}
        projects={[project]}
        tasks={[openTodayTask]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open quick panel" }));
    await user.click(screen.getByRole("button", { name: "Add note or project" }));
    expect(
      screen.getByRole("button", { name: "Add note or project" }).querySelector("svg"),
    ).toHaveClass("lucide-minus");
    expect(screen.getByText("Enter")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create task" })).toHaveTextContent("Add");
    await user.type(screen.getByRole("textbox", { name: "Add task" }), "Capture release note");
    await user.type(screen.getByRole("textbox", { name: "New task note" }), "Release details");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Project for new task" }),
      project.id,
    );
    await user.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          note: "Release details",
          projectId: project.id,
          title: "Capture release note",
        }),
      ),
    );
  });
});

function deferred<T>() {
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return { promise, reject: rejectPromise, resolve: resolvePromise };
}
