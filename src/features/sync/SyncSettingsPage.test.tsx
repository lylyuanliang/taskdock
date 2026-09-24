import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { SyncStateDto, TestSyncConnectionInput } from "../../api/sync";
import SyncSettingsPage from "./SyncSettingsPage";

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

function renderPage(onTestConnection: (input: TestSyncConnectionInput) => Promise<void>) {
  const onSave = vi.fn().mockResolvedValue(undefined);

  const rendered = render(
    <SyncSettingsPage
      config={null}
      isSaving={false}
      onOpenConflicts={vi.fn()}
      onOpenInitialSync={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onSave={onSave}
      onSyncNow={vi.fn().mockResolvedValue(undefined)}
      onTestConnection={onTestConnection}
      state={state}
    />,
  );

  return { onSave, ...rendered };
}

it("tests the current form draft without saving it first", async () => {
  const user = userEvent.setup();
  const onTestConnection = vi.fn().mockResolvedValue(undefined);

  renderPage(onTestConnection);
  await user.type(screen.getByLabelText("Server URL"), "https://dav.example.test/dav/");
  await user.clear(screen.getByLabelText("Remote directory"));
  await user.type(screen.getByLabelText("Remote directory"), "taskdock-sync");
  await user.type(screen.getByLabelText("Account"), "user@example.com");
  await user.type(screen.getByLabelText("Password"), "third-party-password");
  await user.click(screen.getByRole("button", { name: "Test connection" }));

  expect(onTestConnection).toHaveBeenCalledWith({
    endpoint: "https://dav.example.test/dav/",
    remoteDirectory: "taskdock-sync",
    username: "user@example.com",
    webdavPassword: "third-party-password",
  });
  expect(onTestConnection).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Settings saved")).not.toBeInTheDocument();
  expect(
    await screen.findByText("Connection successful; WebDAV is available."),
  ).toBeInTheDocument();
}, 10_000);

it("shows a precise authentication error returned by the backend", async () => {
  const user = userEvent.setup();
  const onTestConnection = vi.fn().mockRejectedValue({
    code: "sync.remote.authentication_failed",
    message_key: "errors.sync.remote.authentication_failed",
  });

  renderPage(onTestConnection);
  await user.click(screen.getByRole("button", { name: "Test connection" }));

  expect(
    await screen.findByText("The account or third-party app password is incorrect."),
  ).toBeInTheDocument();
  expect(document.querySelector(".sync-page__message")).toHaveTextContent(
    "The account or third-party app password is incorrect.",
  );
  expect(screen.queryByText("third-party-password")).not.toBeInTheDocument();
});

it("persists the selected automatic sync strategy with the settings", async () => {
  const user = userEvent.setup();
  const { onSave } = renderPage(vi.fn().mockResolvedValue(undefined));

  await user.selectOptions(screen.getByLabelText("Automatic sync strategy"), "keepRemote");
  await user.click(screen.getByRole("button", { name: "Save settings" }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      strategy: "keepRemote",
    }),
  );
});

it("persists the selected automatic sync frequency with the settings", async () => {
  const user = userEvent.setup();
  const { onSave } = renderPage(vi.fn().mockResolvedValue(undefined));

  await user.selectOptions(screen.getByLabelText("Automatic sync frequency"), "oneHour");
  await user.click(screen.getByRole("button", { name: "Save settings" }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      frequency: "oneHour",
    }),
  );
});
