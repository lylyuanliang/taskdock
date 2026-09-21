"""固定视口下的主窗口视觉与几何回归检查。"""

from __future__ import annotations

import os
from pathlib import Path
import socket
import subprocess
import time

from playwright.sync_api import Page, expect, sync_playwright

from daily_flow import CHROME, TAURI_MOCK


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = Path(os.environ.get("TASKDOCK_VISUAL_OUTPUT", r"C:\Users\lylyu\.codex\visualizations\2026\09\21"))


def find_available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def wait_for_server(port: int, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Vite exited before ready: {process.returncode}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError(f"Vite did not become ready on port {port}")


def stop_server(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        process.terminate()
    process.wait(timeout=5)


def assert_no_overflow(page: Page, label: str) -> None:
    overflow = page.evaluate(
        """() => ({
          bodyWidth: document.body.scrollWidth,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          bodyHeight: document.body.scrollHeight,
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: document.documentElement.clientHeight,
        })"""
    )
    if overflow["bodyWidth"] > overflow["viewportWidth"] or overflow["documentWidth"] > overflow["viewportWidth"]:
        raise AssertionError(f"{label} overflow: {overflow}")


def check_shell(page: Page, label: str, expected_navigation_width: int) -> None:
    expect(page.get_by_test_id("app-shell")).to_be_visible()
    expect(page.get_by_test_id("navigation-rail")).to_be_visible()
    expect(page.get_by_test_id("workspace-bar")).to_be_visible()
    expect(page.get_by_test_id("task-view")).to_be_visible()

    geometry = page.evaluate(
        """() => {
          const navigation = document.querySelector('[data-testid="navigation-rail"]');
          const workspace = document.querySelector('[data-testid="workspace-bar"]');
          if (!navigation || !workspace) throw new Error('shell geometry nodes are missing');
          return {
            navigationWidth: navigation.getBoundingClientRect().width,
            workspaceHeight: workspace.getBoundingClientRect().height,
          };
        }"""
    )
    if abs(geometry["navigationWidth"] - expected_navigation_width) > 1:
        raise AssertionError(f"{label} navigation width mismatch: {geometry}")
    if abs(geometry["workspaceHeight"] - 48) > 1:
        raise AssertionError(f"{label} workspace height mismatch: {geometry}")
    assert_no_overflow(page, label)


def visit_view(page: Page, url: str, view: str, viewport: tuple[int, int]) -> None:
    page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
    page.goto(url, wait_until="domcontentloaded")
    expect(page.get_by_role("heading", name="Inbox", level=1)).to_be_visible()
    if view == "projects":
        page.get_by_role("button", name="Projects").click()
        expect(page.get_by_test_id("project-task-board")).to_be_visible()
    elif view == "calendar":
        page.get_by_role("button", name="Calendar").click()
        expect(page.get_by_test_id("month-calendar")).to_be_visible()
    else:
        expect(page.get_by_test_id("task-view")).to_be_visible()
    expected_navigation_width = 240 if viewport[0] >= 1200 else (72 if viewport[0] > 760 else viewport[0])
    check_shell(page, f"{view} {viewport[0]}x{viewport[1]}", expected_navigation_width)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(OUTPUT_DIR / f"main-window-{view}-{viewport[0]}x{viewport[1]}.png"),
        full_page=True,
    )


def main() -> None:
    if not CHROME.is_file():
        raise SystemExit(f"Playwright Chrome not found: {CHROME}")

    port = find_available_port()
    process = subprocess.Popen(
        ["pnpm.cmd" if os.name == "nt" else "pnpm", "vite", "--host", "127.0.0.1", "--port", str(port)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_server(port, process)
        url = f"http://127.0.0.1:{port}/"
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(CHROME), headless=True)
            try:
                page = browser.new_page()
                page.add_init_script(TAURI_MOCK)
                for view, viewport in (
                    ("inbox", (1600, 1280)),
                    ("projects", (1600, 1280)),
                    ("calendar", (1346, 1078)),
                    ("inbox", (1440, 900)),
                    ("inbox", (1024, 768)),
                    ("calendar", (360, 800)),
                ):
                    visit_view(page, url, view, viewport)
            finally:
                browser.close()
    finally:
        stop_server(process)
    print(f"PASS visual regression: screenshots written to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
