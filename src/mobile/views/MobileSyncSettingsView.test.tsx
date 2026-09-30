import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { SaveSyncConfigInput, SyncConfigDto, SyncStateDto } from "../../api/sync";
import MobileSyncSettingsView from "./MobileSyncSettingsView";

afterEach(cleanup);

const config: SyncConfigDto = {
  endpoint: "https://dav.example.test/files",
  remoteDirectory: "taskdock",
  username: "alice",
  webdavPasswordSaved: false,
  encryptionEnabled: true,
  paused: false,
  strategy: "smartMerge",
  frequency: "manual",
};

const state: SyncStateDto = {
  status: "synced",
  lastSyncedAt: "2026-09-24T10:00:00Z",
  lastErrorCode: null,
  pendingUpload: 0,
  pendingDownload: 0,
  conflicts: 0,
  baselineSnapshotId: "baseline-1",
};

function renderView(overrides: Partial<React.ComponentProps<typeof MobileSyncSettingsView>> = {}) {
  return render(
    <MobileSyncSettingsView
      config={config}
      state={state}
      isLoading={false}
      isSaving={false}
      isOnline
      onSave={vi.fn().mockResolvedValue(undefined)}
      onTestConnection={vi.fn().mockResolvedValue({ ok: true })}
      onSyncNow={vi.fn().mockResolvedValue(undefined)}
      onReviewConflicts={vi.fn()}
      {...overrides}
    />,
  );
}

it("renders ready status, endpoint, strategy and Android Keystore", () => {
  renderView();
  expect(screen.getByRole("region", { name: "Sync settings" })).toHaveAttribute(
    "data-state",
    "default",
  );
  expect(screen.getByRole("status")).toHaveTextContent(/synced|已同步/i);
  return waitFor(() => {
    expect(screen.getByLabelText(/server url|服务器地址/i)).toHaveValue(config.endpoint);
    expect(screen.getByLabelText(/strategy|方案/i)).toHaveValue("smartMerge");
    expect(screen.getByLabelText(/automatic sync frequency|自动同步频率/i)).toHaveValue("manual");
  }).then(() => expect(screen.getByText(/Android Keystore/i)).toBeInTheDocument());
});

it("exposes explicit visual fixture states on the sync settings root", () => {
  renderView({ visualState: "conflict" });

  expect(screen.getByRole("region", { name: "Sync settings" })).toHaveAttribute(
    "data-state",
    "conflict",
  );
});

it("shows loading and offline states with stable translated messages", () => {
  const { rerender } = renderView({ isLoading: true });
  expect(screen.getByRole("status")).toHaveTextContent(/loading|加载/i);
  rerender(
    <MobileSyncSettingsView
      config={config}
      state={{ ...state, status: "retryPending", lastErrorCode: "sync.network.timeout" }}
      isLoading={false}
      isSaving={false}
      isOnline={false}
      onSave={vi.fn()}
      onTestConnection={vi.fn()}
      onSyncNow={vi.fn()}
      onReviewConflicts={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/offline|离线|network|网络/i);
  expect(screen.getByRole("alert")).not.toHaveTextContent("sync.network.timeout");
});

it("blocks incomplete config and never renders password or passphrase", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderView({ config: null, onSave });
  fireEvent.change(screen.getByLabelText(/server url|服务器地址/i), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /save|保存/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/required|complete|填写|配置/i);
  expect(screen.queryByText("secret-password")).not.toBeInTheDocument();
  expect(screen.queryByText("secret-passphrase")).not.toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

it("sends only one sync request for duplicate taps", async () => {
  const onSyncNow = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
  renderView({ onSyncNow });
  const button = screen.getByRole("button", { name: /sync now|立即同步/i });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(onSyncNow).toHaveBeenCalledTimes(1));
});

it("shows immediate sync feedback below the status card", async () => {
  const user = userEvent.setup();
  let resolveSync: (() => void) | undefined;
  const onSyncNow = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSync = resolve;
      }),
  );
  renderView({ onSyncNow });

  await user.click(screen.getByRole("button", { name: /sync now|立即同步/i }));

  const feedback = screen.getByRole("status", { name: /syncing|正在同步/i });
  expect(feedback).toBeInTheDocument();
  expect(screen.getByTestId("mobile-sync-status-card").compareDocumentPosition(feedback)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );

  resolveSync?.();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/complete|完成/i));
});

it("shows a saved-password mask without exposing the secret", async () => {
  renderView({
    config: { ...config, webdavPasswordSaved: true } as SyncConfigDto,
  });

  const password = await screen.findByLabelText(/password|密码/i);
  await waitFor(() => expect(password).toHaveAttribute("placeholder", "••••••••"));
  expect(password).toHaveValue("");
  expect(
    screen.getByRole("button", { name: /show saved password|显示已保存密码/i }),
  ).toBeInTheDocument();
});

it("reveals a saved password only after an explicit eye-button tap", async () => {
  const user = userEvent.setup();
  const onRevealPassword = vi.fn().mockResolvedValue("saved-password");
  renderView({
    config: { ...config, webdavPasswordSaved: true } as SyncConfigDto,
    onRevealPassword,
  });

  const showButton = await screen.findByRole("button", {
    name: /show saved password|显示已保存密码/i,
  });
  await user.click(showButton);

  await waitFor(() => expect(onRevealPassword).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("textbox", { name: /password|密码/i })).toHaveValue("saved-password");
  expect(screen.getByRole("textbox", { name: /password|密码/i })).toHaveAttribute("type", "text");
  expect(screen.getByRole("button", { name: /hide password|隐藏密码/i })).toBeInTheDocument();
});

it("tests connection without saving credentials", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  const onTestConnection = vi.fn().mockResolvedValue({ ok: true });
  renderView({ onSave, onTestConnection });
  await user.click(screen.getByRole("button", { name: /test connection|测试连接/i }));
  await waitFor(() => expect(onTestConnection).toHaveBeenCalledTimes(1));
  expect(onSave).not.toHaveBeenCalled();
  const input = onTestConnection.mock.calls[0]?.[0] as SaveSyncConfigInput;
  expect(input).not.toHaveProperty("encryptionPassphrase");
});

it("shows an immediate testing state and blocks duplicate connection taps", async () => {
  const user = userEvent.setup();
  let resolveTest: ((result: { ok: boolean }) => void) | undefined;
  const onTestConnection = vi.fn(
    () =>
      new Promise<{ ok: boolean }>((resolve) => {
        resolveTest = resolve;
      }),
  );
  renderView({ onTestConnection });

  const button = screen.getByRole("button", { name: /test connection|测试连接/i });
  await user.click(button);

  expect(button).toBeDisabled();
  expect(screen.getByRole("status", { name: /testing|正在测试/i })).toBeInTheDocument();
  await user.click(button);
  expect(onTestConnection).toHaveBeenCalledTimes(1);

  resolveTest?.({ ok: true });
  await waitFor(() => expect(button).not.toBeDisabled());
  expect(screen.getByRole("alert")).toHaveTextContent(/connection successful|连接成功/i);
});

it("keeps the save action at the end of the scrollable form", () => {
  renderView();

  expect(screen.getByRole("button", { name: /save settings|保存设置/i }).parentElement).toHaveClass(
    "mobile-sync__actions--footer",
  );
});

it("renders the Stitch ledger sections instead of a flat form", () => {
  renderView();

  expect(screen.getByTestId("mobile-sync-status-card")).toBeInTheDocument();
  expect(screen.getByTestId("mobile-sync-endpoint-card")).toBeInTheDocument();
  expect(screen.getByTestId("mobile-sync-strategy-card")).toBeInTheDocument();
  expect(screen.getByTestId("mobile-sync-security-card")).toBeInTheDocument();
  expect(screen.getByText(/manual sync only|仅手动同步/i)).toBeInTheDocument();
});

it.each([
  ["errors.sync.configuration.missing", /complete the sync configuration|填写完整的同步配置/i],
  ["errors.sync.remote.path_not_found", /sync network|同步网络/i],
  ["errors.sync.remote.method_not_allowed", /sync network|同步网络/i],
  ["errors.sync.remote.unavailable", /sync network|同步网络/i],
  ["errors.sync.remote.network_unavailable", /sync network|同步网络/i],
  ["errors.sync.credential.failed", /authentication|账户认证/i],
  ["errors.sync.worker.unavailable", /sync network|同步网络/i],
  ["errors.sync.remote.authentication_failed", /authentication|账户认证/i],
  ["errors.sync.remote.timeout", /sync network|同步网络/i],
  ["errors.sync.encryption.failed", /encryption|加密/i],
  ["errors.sync.snapshot.invalid", /encryption|加密/i],
])("maps backend sync error %s to stable translated copy", async (messageKey, expected) => {
  const onSyncNow = vi.fn().mockRejectedValue({ code: "sync.failure", message_key: messageKey });
  renderView({ onSyncNow });

  fireEvent.click(screen.getByRole("button", { name: /sync now|立即同步/i }));

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(expected));
  expect(screen.getByRole("alert")).not.toHaveTextContent("errors.unknown");
});

it("gives the encryption toggle row a 40px touch target", () => {
  renderView();

  const toggle = screen.getByLabelText("Enable encryption").parentElement;
  expect(toggle).toHaveClass("mobile-sync__toggle");
  expect(toggle).toHaveStyle({ minHeight: "40px" });
});

it("exposes review only when conflicts exist", () => {
  const onReviewConflicts = vi.fn();
  const { rerender } = renderView({ onReviewConflicts });
  expect(
    screen.queryByRole("button", { name: /review conflicts|查看冲突/i }),
  ).not.toBeInTheDocument();
  rerender(
    <MobileSyncSettingsView
      config={config}
      state={{ ...state, conflicts: 2, status: "conflictsPending" }}
      isLoading={false}
      isSaving={false}
      isOnline
      onSave={vi.fn()}
      onTestConnection={vi.fn()}
      onSyncNow={vi.fn()}
      onReviewConflicts={onReviewConflicts}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /review conflicts|查看冲突/i }));
  expect(onReviewConflicts).toHaveBeenCalledTimes(1);
});

it("allows pausing and resuming automatic sync", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderView({ onSave });

  const pauseToggle = screen.getByRole("checkbox", { name: /pause automatic sync|暂停自动同步/i });
  expect(pauseToggle).not.toBeChecked();
  await user.click(pauseToggle);
  await user.type(screen.getByLabelText(/password|密码/i), "test-password");
  await user.click(screen.getByRole("button", { name: /save|保存/i }));

  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ paused: true })),
  );
});

it("saves changes to an existing config without asking for stored credentials again", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderView({
    config: { ...config, encryptionEnabled: false },
    onSave,
  });

  await user.selectOptions(
    screen.getByLabelText(/automatic sync frequency|自动同步频率/i),
    "oneHour",
  );
  await user.click(screen.getByRole("button", { name: /save|保存/i }));

  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: "oneHour",
        webdavPassword: "",
      }),
    ),
  );
});
