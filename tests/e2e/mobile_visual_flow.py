"""Responsive Android-shell visual evidence using deterministic local fixtures."""

from __future__ import annotations

import json
import os
import subprocess
import argparse
import threading
from pathlib import Path
from queue import Queue

from playwright.sync_api import Page, expect, sync_playwright

from daily_flow import (
    CHROME,
    ROOT,
    TAURI_MOCK,
    build_vite_command,
    find_available_port,
    pump_process_output,
    run_page_flow,
    stop_server,
    vite_process_options,
    wait_for_vite_ready,
)


SYNC_FIXTURE = r"""
(() => {
  const originalInvoke = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (command === "get_sync_config") return null;
    if (command === "get_sync_status") return {
      status: "unconfigured", lastSyncedAt: null, lastErrorCode: null,
      pendingUpload: 0, pendingDownload: 0, conflicts: 0, baselineSnapshotId: null,
    };
    if (command === "list_sync_conflicts") return [];
    if (command === "save_sync_config") return args.input;
    if (command === "test_sync_connection") return { ok: true };
    if (command === "sync_now") return {
      status: "synced", localOnly: 0, remoteOnly: 0, merged: 0, conflicts: 0, uploaded: true,
    };
    return originalInvoke(command, args);
  };
})();
"""


def run_visual_flow(page: Page, output_dir: Path) -> None:
    shell = page.locator('[data-testid="mobile-app-shell"]')
    expect(shell).to_have_attribute("data-state", "default")
    records: list[dict[str, object]] = []

    def capture(name: str, route: str) -> None:
        page.screenshot(path=str(output_dir / f"{name}.png"), full_page=True)
        records.append(
            {
                "name": name,
                "route": route,
                "viewport": page.evaluate("() => ({ width: innerWidth, height: innerHeight })"),
                "states": page.locator("[data-state]").evaluate_all(
                    "nodes => nodes.map(node => node.getAttribute('data-state'))"
                ),
                "visual": page.evaluate(
                    """() => {
                      const read = (selector) => {
                        const node = document.querySelector(selector);
                        if (!node) return null;
                        const style = getComputedStyle(node);
                        const rect = node.getBoundingClientRect();
                        return {
                          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                          background: style.backgroundColor,
                          borderBottom: style.borderBottom,
                          borderRadius: style.borderRadius,
                        };
                      };
                      return {
                        shell: read('[data-testid="mobile-app-shell"]'),
                        content: read('main.mobile-shell__content'),
                        navigation: read('nav.mobile-shell__navigation'),
                        overflow: {
                          bodyWidth: document.body.scrollWidth,
                          documentWidth: document.documentElement.scrollWidth,
                          viewportWidth: innerWidth,
                          viewportHeight: innerHeight,
                          documentHeight: document.documentElement.scrollHeight,
                        },
                      };
                    }"""
                ),
            }
        )

    expect(page.locator('main[data-route="today"]')).to_be_visible()
    expect(page.get_by_role("button", name="Add task")).to_be_visible(timeout=5_000)
    capture("today-default", "today")
    page.get_by_role("button", name="Add task").click()
    expect(page.locator("form.mobile-editor")).to_be_visible()
    capture("task-editor-default", "taskEditor")
    page.get_by_role("button", name="Cancel").click()
    page.get_by_role("button", name="Settings").click()
    sync_settings = page.get_by_role("button", name="Sync settings")
    expect(sync_settings).to_be_visible()
    sync_settings.click()
    expect(page.locator('.mobile-sync[data-state="empty"]')).to_be_visible(timeout=5_000)
    capture("sync-settings-empty", "syncSettings")
    (output_dir / "results.json").write_text(json.dumps(records, indent=2), encoding="utf-8")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=None)
    parser.add_argument(
        "--width",
        type=int,
        default=int(os.environ.get("TASKDOCK_MOBILE_WIDTH", "360")),
    )
    parser.add_argument(
        "--height",
        type=int,
        default=int(os.environ.get("TASKDOCK_MOBILE_HEIGHT", "800")),
    )
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    width = args.width
    height = args.height
    if not CHROME.is_file():
        raise SystemExit(f"No Playwright Chrome executable at {CHROME}")
    output_dir = ROOT / "tests" / "e2e" / "artifacts" / f"mobile-{width}x{height}"
    output_dir.mkdir(parents=True, exist_ok=True)
    port = find_available_port()
    vite = subprocess.Popen(
        build_vite_command(port), cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1, encoding="utf-8", errors="replace", **vite_process_options(),
    )
    output_lines: list[str] = []
    readiness: Queue[str] = Queue()
    if vite.stdout is None:
        raise SystemExit("Unable to capture Vite startup output")
    output_thread = threading.Thread(
        target=pump_process_output, args=(vite.stdout, readiness, output_lines), daemon=True
    )
    output_thread.start()
    try:
        wait_for_vite_ready(port, vite, readiness, output_lines=output_lines)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(CHROME), headless=True)
            try:
                page = browser.new_page(
                    viewport={"width": width, "height": height},
                    user_agent="Mozilla/5.0 (Linux; Android 14; TaskDock E2E)",
                )
                page.set_default_navigation_timeout(10_000)
                run_page_flow(
                    page,
                    args.base_url or f"http://127.0.0.1:{port}/",
                    lambda current_page: run_visual_flow(current_page, output_dir),
                    SYNC_FIXTURE,
                )
            finally:
                browser.close()
        print(f"PASS mobile visual {width}x{height}: screenshots and results written to {output_dir}")
    finally:
        stop_server(vite, port)
        output_thread.join(timeout=5)


if __name__ == "__main__":
    main()
