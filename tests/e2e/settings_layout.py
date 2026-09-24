"""宽屏设置页的响应式布局回归覆盖。"""

from __future__ import annotations

import json
import os
import subprocess
import threading
from queue import Queue

from playwright.sync_api import Page, sync_playwright

from daily_flow import (
    CHROME,
    ROOT,
    SERVER_SHUTDOWN_TIMEOUT_SECONDS,
    build_vite_command,
    find_available_port,
    pump_process_output,
    run_page_flow,
    stop_server,
    vite_process_options,
    wait_for_vite_ready,
)
from sync_flow import SYNC_MOCK


VIEWPORTS = (
    (1280, 900, 900),
    (1920, 1080, 1100),
    (2549, 1531, 1350),
)


def run_layout_flow(page: Page, minimum_page_width: int) -> None:
    page.get_by_role("button", name="Settings").click()
    page.get_by_role("heading", name="Sync settings", level=2).wait_for()

    geometry = page.evaluate(
        """
        () => {
          const navigation = document.querySelector('.settings-navigation').getBoundingClientRect();
          const content = document.querySelector('.settings-content').getBoundingClientRect();
          const page = document.querySelector('.sync-page').getBoundingClientRect();
          return {
            navigation: { width: navigation.width, left: navigation.left, right: navigation.right },
            content: { left: content.left, right: content.right },
            page: { width: page.width, left: page.left, right: page.right },
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
          };
        }
        """
    )

    navigation = geometry["navigation"]
    content = geometry["content"]
    page_box = geometry["page"]
    if not 239 <= navigation["width"] <= 241:
        raise AssertionError(f"settings navigation width drifted: {json.dumps(geometry)}")
    if page_box["width"] < minimum_page_width:
        raise AssertionError(
            f"sync page did not expand to the expected width: {json.dumps(geometry)}"
        )
    if page_box["left"] < content["left"] - 1 or page_box["right"] > content["right"] + 1:
        raise AssertionError(f"sync page escaped the content area: {json.dumps(geometry)}")
    if geometry["documentWidth"] > geometry["viewportWidth"] + 1:
        raise AssertionError(f"settings page has horizontal overflow: {json.dumps(geometry)}")


def main() -> None:
    if not CHROME.is_file():
        raise SystemExit(
            "No usable Playwright Chrome executable. Set TASKDOCK_PLAYWRIGHT_CHROME to an existing "
            f"browser path (default: {CHROME})."
        )

    port = find_available_port()
    vite: subprocess.Popen[str] | None = None
    vite_owns_port = False
    output_thread: threading.Thread | None = None
    output_lines: list[str] = []
    readiness_output: Queue[str] = Queue()
    cleanup_error: BaseException | None = None

    try:
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
        if vite.stdout is None:
            raise RuntimeError("Unable to capture Vite startup output.")
        output_thread = threading.Thread(
            target=pump_process_output,
            args=(vite.stdout, readiness_output, output_lines),
            daemon=True,
        )
        output_thread.start()
        wait_for_vite_ready(port, vite, readiness_output, output_lines=output_lines)
        vite_owns_port = True

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(CHROME), headless=True)
            try:
                for width, height, minimum_page_width in VIEWPORTS:
                    page = browser.new_page(viewport={"width": width, "height": height})
                    try:
                        run_page_flow(
                            page,
                            f"http://127.0.0.1:{port}/",
                            lambda current_page, expected=minimum_page_width: run_layout_flow(
                                current_page, expected
                            ),
                            SYNC_MOCK,
                        )
                        page.screenshot(
                            path=os.path.join(
                                os.environ.get("TEMP", str(ROOT)),
                                f"taskdock-settings-{width}x{height}.png",
                            ),
                            full_page=True,
                        )
                    finally:
                        page.close()
            finally:
                browser.close()
    except BaseException as error:
        raise SystemExit(f"E2E failure: {error}") from error
    finally:
        if vite is not None:
            try:
                stop_server(vite, port, verify_port_closed=vite_owns_port)
            except BaseException as error:
                cleanup_error = error
        if output_thread is not None:
            output_thread.join(timeout=SERVER_SHUTDOWN_TIMEOUT_SECONDS)
        if cleanup_error is not None:
            raise SystemExit(f"E2E cleanup failure: {cleanup_error}") from cleanup_error

    print("PASS SETTINGS-LAYOUT: responsive settings widths and overflow checks succeeded.")


if __name__ == "__main__":
    main()
