"""Deterministic Android-shell interaction flow with stable data selectors."""

from __future__ import annotations

import os
import subprocess
import threading
import argparse
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
from mobile_visual_flow import SYNC_FIXTURE


def run_mobile_flow(page: Page) -> None:
    shell = page.locator('[data-testid="mobile-app-shell"]')
    expect(shell).to_have_attribute("data-state", "default")
    add_task = page.get_by_role("button", name="Add task")
    expect(add_task).to_be_visible(timeout=5_000)
    add_task.click()
    editor = page.locator("form.mobile-editor[data-state]")
    expect(editor).to_be_visible()
    page.get_by_label("Task title").fill("A deterministic long mobile title for viewport checks")
    page.wait_for_timeout(100)
    page.get_by_role("button", name="Today").click()
    expect(page.get_by_role("alert")).to_be_visible()
    page.get_by_role("button", name="Discard changes").click()
    expect(page.locator('main[data-route="today"]')).to_be_visible()
    expect(page.get_by_text("E2E child task")).not_to_be_visible()
    expect(page.get_by_role("button", name="Completed today")).to_be_visible()
    page.get_by_role("button", name="Settings").click()
    sync_settings = page.get_by_role("button", name="Sync settings")
    expect(sync_settings).to_be_visible()
    sync_settings.click()
    expect(page.locator("main [data-state]")).to_be_visible()
    for password_input in page.locator("input[type=password]").all():
        if password_input.input_value():
            raise AssertionError("Mobile fixture must not expose real credentials")


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
                    run_mobile_flow,
                    SYNC_FIXTURE,
                )
            finally:
                browser.close()
        print(f"PASS mobile flow {width}x{height}")
    finally:
        stop_server(vite, port)
        output_thread.join(timeout=5)


if __name__ == "__main__":
    main()
