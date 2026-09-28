import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SyncConflictDto } from "../../api/sync";
import MobileConflictView from "./MobileConflictView";

afterEach(cleanup);

const conflict: SyncConflictDto = {
  entityId: "task-1",
  entityKind: "task",
  fieldName: "title",
  localValue: "Local title",
  remoteValue: "Remote title",
  baseValue: "Original title",
};

const remoteConflict: SyncConflictDto = {
  ...conflict,
  entityId: "task-2",
  localValue: "Local remote title",
  remoteValue: "Remote remote title",
};

const copyConflict: SyncConflictDto = {
  ...conflict,
  entityId: "task-3",
  localValue: "Local copy title",
  remoteValue: "Remote copy title",
};

it("switches smart merge, keep local and keep remote decisions", async () => {
  const user = { click: async (element: HTMLElement) => fireEvent.click(element) };
  const onResolve = vi.fn().mockResolvedValue(undefined);
  render(
    <MobileConflictView
      conflicts={[conflict, remoteConflict, copyConflict]}
      onResolve={onResolve}
      onBack={vi.fn()}
    />,
  );
  expect(screen.getByText("Local title")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /keep local|保留本地/i }));
  await waitFor(() => expect(onResolve).toHaveBeenLastCalledWith(conflict, "keepLocal"));
  await user.click(screen.getByRole("button", { name: /keep remote|采用远端|use remote/i }));
  await waitFor(() => expect(onResolve).toHaveBeenLastCalledWith(remoteConflict, "acceptRemote"));
  await user.click(screen.getByRole("button", { name: /conflict copy|冲突副本/i }));
  await waitFor(() =>
    expect(onResolve).toHaveBeenLastCalledWith(copyConflict, "createConflictCopy"),
  );
});

it("resolves conflict copy through the existing decision enum", async () => {
  const onResolve = vi.fn().mockResolvedValue(undefined);
  render(<MobileConflictView conflicts={[conflict]} onResolve={onResolve} onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /conflict copy|冲突副本/i }));
  await waitFor(() => expect(onResolve).toHaveBeenCalledWith(conflict, "createConflictCopy"));
});

it("removes a resolved conflict and reports the refreshed current item", async () => {
  const onResolve = vi.fn().mockResolvedValue(undefined);
  const onResolved = vi.fn();
  render(
    <MobileConflictView
      conflicts={[conflict, remoteConflict]}
      onResolve={onResolve}
      onResolved={onResolved}
      onBack={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /keep local|保留本地/i }));

  await waitFor(() => {
    expect(onResolved).toHaveBeenCalledWith(conflict, "keepLocal");
    expect(screen.queryByText("Local title")).not.toBeInTheDocument();
    expect(screen.getByText("Local remote title")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });
});
