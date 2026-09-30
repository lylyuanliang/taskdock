import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { SyncConfigDto, SyncStateDto, TestSyncConnectionInput } from "../../api/sync";
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

function renderPage(
  onTestConnection: (input: TestSyncConnectionInput) => Promise<void>,
  options: {
    config?: SyncConfigDto | null;
    onRevealPassword?: () => Promise<string | null>;
  } = {},
) {
  const onSave = vi.fn().mockResolvedValue(undefined);

  const rendered = render(
    <SyncSettingsPage
      config={options.config ?? null}
      isSaving={false}
      onOpenConflicts={vi.fn()}
      onOpenInitialSync={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onSave={onSave}
      onRevealPassword={options.onRevealPassword}
      onSyncNow={vi.fn().mockResolvedValue(undefined)}
      onTestConnection={onTestConnection}
      state={state}
    />,
  );

  return { onSave, ...rendered };
}

const savedConfig: SyncConfigDto = {
  endpoint: "https://dav.example.test/dav/",
  encryptionEnabled: true,
  frequency: "fiveMinutes",
  paused: false,
  remoteDirectory: "taskdock-sync",
  strategy: "smartMerge",
  username: "user@example.com",
  webdavPasswordSaved: true,
};

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

it("masks a saved WebDAV password until the user explicitly reveals it", async () => {
  const user = userEvent.setup();
  const onRevealPassword = vi.fn().mockResolvedValue("saved-password");

  renderPage(vi.fn().mockResolvedValue(undefined), {
    config: savedConfig,
    onRevealPassword,
  });

  const password = await screen.findByLabelText("Password");
  await screen.findByRole("button", { name: "Show saved password" });
  expect(password).toHaveValue("");
  expect(password).toHaveAttribute("placeholder", "********");
  expect(document.body).not.toHaveTextContent("saved-password");

  await user.click(screen.getByRole("button", { name: "Show saved password" }));

  expect(onRevealPassword).toHaveBeenCalledTimes(1);
  expect(password).toHaveAttribute("type", "text");
  expect(password).toHaveValue("saved-password");
  expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Hide password" }));

  expect(password).toHaveAttribute("type", "password");
  expect(password).toHaveValue("");
});

it("hides the saved-password viewer when the account changes", async () => {
  const user = userEvent.setup();
  renderPage(vi.fn().mockResolvedValue(undefined), { config: savedConfig });

  await user.clear(screen.getByLabelText("Account"));
  await user.type(screen.getByLabelText("Account"), "other@example.com");

  expect(screen.queryByRole("button", { name: "Show saved password" })).not.toBeInTheDocument();
});

it("keeps a failed saved-password reveal masked", async () => {
  const user = userEvent.setup();
  const onRevealPassword = vi.fn().mockRejectedValue(new Error("credential unavailable"));

  renderPage(vi.fn().mockResolvedValue(undefined), {
    config: savedConfig,
    onRevealPassword,
  });

  const password = await screen.findByLabelText("Password");
  await user.click(await screen.findByRole("button", { name: "Show saved password" }));

  expect(
    await screen.findByText("Saved password is unavailable. Enter it again and save."),
  ).toBeInTheDocument();
  expect(password).toHaveAttribute("type", "password");
  expect(password).toHaveValue("");
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
