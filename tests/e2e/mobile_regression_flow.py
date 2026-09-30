"""Mobile regression checks for sync persistence and project creation."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import threading
from pathlib import Path
from queue import Queue

from playwright.sync_api import Page, expect, sync_playwright

from daily_flow import (
    CHROME,
    ROOT,
    build_vite_command,
    find_available_port,
    pump_process_output,
    run_page_flow,
    stop_server,
    vite_process_options,
    wait_for_vite_ready,
)


MOBILE_REGRESSION_FIXTURE = r"""
(() => {
  const originalInvoke = window.__TAURI_INTERNALS__.invoke;
  let projects = [{
    id: "project-existing",
    name: "Existing project",
    archivedAt: null,
    createdAt: "2026-09-09T09:00:00.000Z",
    updatedAt: "2026-09-09T09:00:00.000Z",
  }];
  window.__mobileRegression = {
    createProjectCalls: 0,
    saveSyncConfigCalls: 0,
    testSyncConnectionCalls: 0,
    syncNowCalls: 0,
  };
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (command === "get_sync_config") return {
      endpoint: "https://dav.example.test/files",
      remoteDirectory: "taskdock-sync",
      username: "alice",
      webdavPasswordSaved: true,
      encryptionEnabled: false,
      paused: false,
      strategy: "smartMerge",
      frequency: "fiveMinutes",
    };
    if (command === "get_sync_status") return {
      status: "synced", lastSyncedAt: null, lastErrorCode: null,
      pendingUpload: 0, pendingDownload: 0, conflicts: 0, baselineSnapshotId: null,
    };
    if (command === "list_sync_conflicts") return [];
    if (command === "save_sync_config") {
      window.__mobileRegression.saveSyncConfigCalls += 1;
      return args.input;
    }
    if (command === "test_sync_connection") {
      window.__mobileRegression.testSyncConnectionCalls += 1;
      return { ok: true };
    }
    if (command === "get_saved_webdav_password") return "saved-password";
    if (command === "sync_now") {
      window.__mobileRegression.syncNowCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        status: "synced",
        localOnly: 0,
        remoteOnly: 0,
        merged: 0,
        conflicts: 0,
        uploaded: false,
      };
    }
    if (command === "list_projects") return projects;
    if (command === "create_project") {
      window.__mobileRegression.createProjectCalls += 1;
      const created = {
        id: "project-created",
        name: args.name,
        archivedAt: null,
        createdAt: "2026-09-09T09:00:00.000Z",
        updatedAt: "2026-09-09T09:00:00.000Z",
      };
      projects = [...projects, created];
      return created;
    }
    if (command === "list_tasks") return [];
    return originalInvoke(command, args);
  };
})();
"""


def run_regression_flow(page: Page) -> None:
    page.get_by_role("button", name="Settings").click()
    page.get_by_role("button", name="Sync settings").click()
    expect(page.get_by_role("region", name="Sync settings")).to_be_visible()

    page.get_by_role("button", name="Show saved password").click()
    expect(page.get_by_role("textbox", name="Password")).to_have_value("saved-password")
    page.get_by_role("button", name="Hide password").click()
    expect(page.get_by_role("textbox", name="Password")).to_have_value("")

    page.get_by_role("button", name="Sync now").click()
    expect(page.get_by_role("status", name="Syncing...")).to_be_visible()
    expect(page.get_by_test_id("mobile-sync-status-card")).to_be_visible()
    expect(page.get_by_role("alert")).to_have_text("Action complete")
    assert page.evaluate("() => window.__mobileRegression.syncNowCalls") == 1

    page.get_by_role("textbox", name="Password").fill("test-password")
    page.get_by_role("button", name="Test connection").click()
    expect(page.get_by_role("alert")).to_have_text("Connection successful; WebDAV is available.")
    assert page.evaluate("() => window.__mobileRegression.testSyncConnectionCalls") == 1

    save_button = page.get_by_role("button", name="Save settings")
    expect(save_button).to_be_visible()
    geometry = save_button.evaluate(
        """node => {
          const rect = node.getBoundingClientRect();
          const main = node.closest('main');
          return {
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            viewport: { width: innerWidth, height: innerHeight },
            mainScrollHeight: main ? main.scrollHeight : null,
            mainClientHeight: main ? main.clientHeight : null,
          };
        }"""
    )
    print(f"SYNC_SAVE_GEOMETRY={json.dumps(geometry, ensure_ascii=False)}")
    page.get_by_label("Automatic sync frequency").select_option("oneHour")
    save_button.click()
    expect(page.get_by_role("alert")).to_have_text("Settings saved")
    assert page.evaluate("() => window.__mobileRegression.saveSyncConfigCalls") == 1

    page.get_by_role("button", name="Projects").click()
    expect(page.get_by_test_id("mobile-projects-view")).to_be_visible()
    expect(page.get_by_role("button", name="Create project")).to_be_visible()
    page.get_by_label("Project name").fill("Created from mobile")
    page.get_by_role("button", name="Create project").click()
    expect(page.get_by_role("button", name="Created from mobile")).to_be_visible()
    assert page.evaluate("() => window.__mobileRegression.createProjectCalls") == 1


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--width", type=int, default=int(os.environ.get("TASKDOCK_MOBILE_WIDTH", "360")))
    parser.add_argument("--height", type=int, default=int(os.environ.get("TASKDOCK_MOBILE_HEIGHT", "800")))
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
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
    readiness: Queue[str] = Queue()
    if vite.stdout is None:
        raise SystemExit("Unable to capture Vite startup output")
    output_thread = threading.Thread(
        target=pump_process_output,
        args=(vite.stdout, readiness, output_lines),
        daemon=True,
    )
    output_thread.start()
    try:
        wait_for_vite_ready(port, vite, readiness, output_lines=output_lines)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(CHROME), headless=True)
            try:
                page = browser.new_page(
                    viewport={"width": args.width, "height": args.height},
                    user_agent="Mozilla/5.0 (Linux; Android 14; TaskDock E2E)",
                )
                page.set_default_navigation_timeout(10_000)
                run_page_flow(
                    page,
                    args.base_url or f"http://127.0.0.1:{port}/",
                    run_regression_flow,
                    MOBILE_REGRESSION_FIXTURE,
                )
            finally:
                browser.close()
        print("PASS mobile regression")
    finally:
        stop_server(vite, port)
        output_thread.join(timeout=5)


if __name__ == "__main__":
    main()
