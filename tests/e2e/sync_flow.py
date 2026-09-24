"""Controlled browser acceptance coverage for the WebDAV sync workspace."""

from __future__ import annotations

from playwright.sync_api import Page, expect, sync_playwright

from daily_flow import (
    CHROME,
    ROOT,
    build_vite_command,
    calls,
    run_page_flow,
    stop_server,
    wait_for_call,
    wait_for_vite_ready,
    pump_process_output,
    vite_process_options,
    find_available_port,
)


SYNC_MOCK = r"""
(() => {
  const originalInvoke = window.__TAURI_INTERNALS__.invoke;
  const record = (command, args) => {
    window.__taskDockMock.calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
  };
  let config = null;
  let paused = false;
  let rejectNextTest = false;
  let preserveConflictsOnNextSync = false;
  let conflicts = [{
    entityId: "task-inbox-1",
    entityKind: "task",
    fieldName: "title",
    localValue: "Local title",
    remoteValue: "Remote title",
    baseValue: "Base title",
  }];
  const syncState = () => ({
    status: paused ? "paused" : (conflicts.length ? "conflictsPending" : "synced"),
    lastSyncedAt: "2026-09-23T09:00:00.000Z",
    lastErrorCode: null,
    pendingUpload: 0,
    pendingDownload: 0,
    conflicts: conflicts.length,
    baselineSnapshotId: "snapshot-e2e",
  });
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (command === "get_sync_config") {
      record(command, args);
      return config;
    }
    if (command === "get_sync_status") {
      record(command, args);
      return syncState();
    }
    if (command === "list_sync_conflicts") {
      record(command, args);
      return JSON.parse(JSON.stringify(conflicts));
    }
    if (command === "save_sync_config") {
      record(command, args);
      const input = args.input;
      config = {
        endpoint: input.endpoint,
        remoteDirectory: input.remoteDirectory,
        username: input.username,
        encryptionEnabled: input.encryptionEnabled,
        paused: input.paused,
        strategy: input.strategy,
        frequency: input.frequency,
      };
      paused = input.paused;
      return config;
    }
    if (command === "test_sync_connection") {
      record(command, args);
      if (rejectNextTest) {
        rejectNextTest = false;
        throw {
          code: "sync.remote.authentication_failed",
          message_key: "errors.sync.remote.authentication_failed",
        };
      }
      return { ok: true };
    }
    if (command === "sync_now") {
      record(command, args);
      if (!preserveConflictsOnNextSync) conflicts = [];
      preserveConflictsOnNextSync = false;
      return {
        status: conflicts.length ? "conflictsPending" : "synced",
        localOnly: 1,
        remoteOnly: 0,
        merged: 1,
        conflicts: conflicts.length,
        uploaded: !conflicts.length,
      };
    }
    if (command === "pause_sync") {
      record(command, args);
      paused = true;
      return syncState();
    }
    if (command === "resume_sync") {
      record(command, args);
      paused = false;
      return syncState();
    }
    if (command === "resolve_sync_conflict") {
      record(command, args);
      conflicts = conflicts.filter((conflict) =>
        conflict.entityId !== args.input.entityId ||
        conflict.fieldName !== args.input.fieldName
      );
      return null;
    }
    return originalInvoke(command, args);
  };
  window.__taskDockMock.seedSyncConflict = () => {
    preserveConflictsOnNextSync = true;
    conflicts = [{
      entityId: "task-inbox-1",
      entityKind: "task",
      fieldName: "title",
      localValue: "Local title",
      remoteValue: "Remote title",
      baseValue: "Base title",
    }];
  };
  window.__taskDockMock.rejectNextTest = () => {
    rejectNextTest = true;
  };
})();
"""


def run_sync_flow(page: Page) -> None:
    settings_button = page.get_by_role("button", name="Settings")
    settings_button.wait_for(state="visible")
    settings_button.click()
    expect(page.get_by_role("heading", name="Sync settings", level=2)).to_be_visible()

    page.get_by_label("Server URL").fill("https://dav.example.test/remote.php/dav/files/user")
    page.get_by_label("Remote directory").fill("taskdock-sync")
    page.get_by_label("Account").fill("e2e-user")
    page.get_by_label("Password").fill("e2e-password")
    page.get_by_label("Encryption passphrase").fill("e2e-passphrase")

    page.get_by_role("button", name="Test connection").click()
    wait_for_call(
        page,
        "test_sync_connection",
        {
            "input": {
                "endpoint": "https://dav.example.test/remote.php/dav/files/user",
                "remoteDirectory": "taskdock-sync",
                "username": "e2e-user",
                "webdavPassword": "e2e-password",
            }
        },
    )
    expect(
        page.get_by_text("Connection successful; WebDAV is available.", exact=True)
    ).to_be_visible()
    assert len([call for call in calls(page) if call["command"] == "save_sync_config"]) == 0

    page.evaluate("() => window.__taskDockMock.rejectNextTest()")
    page.get_by_role("button", name="Test connection").click()
    expect(
        page.get_by_text("The account or third-party app password is incorrect.", exact=True)
    ).to_be_visible()
    assert "e2e-password" not in page.locator("body").inner_text()

    page.get_by_role("button", name="Save settings").click()
    page.get_by_text("Settings saved", exact=True).wait_for()
    save_calls = [call for call in calls(page) if call["command"] == "save_sync_config"]
    assert len(save_calls) == 1
    assert save_calls[0]["args"]["input"]["webdavPassword"] == "e2e-password"
    assert save_calls[0]["args"]["input"]["strategy"] == "smartMerge"
    assert save_calls[0]["args"]["input"]["frequency"] == "fiveMinutes"

    page.locator(".sync-page__actions").get_by_role("button", name="Initial sync").click()
    expect(page.get_by_role("heading", name="Prepare initial sync", level=2)).to_be_visible()
    page.get_by_role("radio", name="Use remote").click()
    page.get_by_role("button", name="Start sync").click()
    wait_for_call(page, "sync_now", {"input": {"strategy": "keepRemote"}})
    page.get_by_role("button", name="Back to sync settings").click()

    page.locator(".sync-page__actions").get_by_role("button", name="Pause sync").click()
    wait_for_call(page, "pause_sync", {})
    page.locator(".sync-page__actions").get_by_role("button", name="Resume sync").click()
    wait_for_call(page, "resume_sync", {})

    page.locator(".sync-page__actions").get_by_role("button", name="Conflicts").click()
    expect(page.get_by_role("heading", name="Sync conflicts", level=2)).to_be_visible()
    expect(
        page.get_by_role("list").get_by_text("There are no unresolved conflicts.", exact=True)
    ).to_be_visible()
    page.get_by_role("button", name="Back to sync settings").click()
    page.evaluate("() => window.__taskDockMock.seedSyncConflict()")
    page.locator(".sync-page__actions").get_by_role("button", name="Sync now").click()
    wait_for_call(page, "sync_now", {})
    page.locator(".sync-page__actions").get_by_role("button", name="Conflicts").click()
    expect(page.get_by_role("heading", name="Sync conflicts", level=2)).to_be_visible()
    page.get_by_role("button", name="Use remote").click()
    wait_for_call(
        page,
        "resolve_sync_conflict",
        {
            "input": {
                "decision": "acceptRemote",
                "entityId": "task-inbox-1",
                "entityKind": "task",
                "fieldName": "title",
            }
        },
    )
    expect(
        page.get_by_role("list").get_by_text("There are no unresolved conflicts.", exact=True)
    ).to_be_visible()


def main() -> None:
    if not CHROME.is_file():
        raise SystemExit(
            "No usable Playwright Chrome executable. Set TASKDOCK_PLAYWRIGHT_CHROME to an existing "
            f"browser path (default: {CHROME})."
        )

    import subprocess
    import threading
    from queue import Queue

    port = find_available_port()
    vite = subprocess.Popen(
        build_vite_command(port),
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        encoding="utf-8",
        errors="replace",
        **vite_process_options(),
    )
    output_lines: list[str] = []
    readiness_output: Queue[str] = Queue()
    if vite.stdout is None:
        raise SystemExit("Unable to capture Vite startup output.")
    output_thread = threading.Thread(
        target=pump_process_output,
        args=(vite.stdout, readiness_output, output_lines),
        daemon=True,
    )
    output_thread.start()
    try:
        wait_for_vite_ready(port, vite, readiness_output, output_lines=output_lines)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(CHROME), headless=True)
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 900})
                page.set_default_navigation_timeout(10_000)
                run_page_flow(page, f"http://127.0.0.1:{port}/", run_sync_flow, SYNC_MOCK)
            finally:
                browser.close()
        print("PASS M4-SYNC: settings, WebDAV configuration, initial sync, conflicts, and pause/resume.")
    except BaseException as error:
        raise SystemExit(f"Sync E2E failure: {error}") from error
    finally:
        stop_server(vite, port)
        output_thread.join(timeout=5)


if __name__ == "__main__":
    main()
