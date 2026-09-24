import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { SyncStateDto } from "../../api/sync";
import InitialSyncPage from "./InitialSyncPage";

afterEach(cleanup);

const state: SyncStateDto = {
  baselineSnapshotId: null,
  conflicts: 0,
  lastErrorCode: null,
  lastSyncedAt: null,
  pendingDownload: 0,
  pendingUpload: 0,
  status: "unconfigured",
};

it("starts with smart merge and submits the selected initial sync strategy", async () => {
  const user = userEvent.setup();
  const onStart = vi.fn().mockResolvedValue(undefined);

  render(<InitialSyncPage lastResult={null} onBack={vi.fn()} onStart={onStart} state={state} />);

  const smartMerge = screen.getByRole("radio", { name: /Smart merge/i });
  const useRemote = screen.getByRole("radio", { name: /Use remote/i });
  expect(smartMerge).toHaveAttribute("aria-checked", "true");
  expect(useRemote).toHaveAttribute("aria-checked", "false");

  await user.click(useRemote);
  expect(useRemote).toHaveAttribute("aria-checked", "true");

  await user.click(screen.getByRole("button", { name: "Start sync" }));
  expect(onStart).toHaveBeenCalledWith("keepRemote");
});
