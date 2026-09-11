import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.queryByText(completedTodayTask.title)).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Close quick panel" }));
    expect(screen.queryByText(openTodayTask.title)).not.toBeInTheDocument();
  });

  it("exposes a draggable header and an X close control when expanded", async () => {
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
    const closeButton = screen.getByRole("button", { name: "Close quick panel" });

    expect(dragHeader).toHaveAttribute("title", "Move quick panel");
    expect(dragHeader.querySelector("svg")).toHaveClass("lucide-grip-horizontal");
    expect(closeButton.querySelector("svg")).toHaveClass("lucide-x");
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
