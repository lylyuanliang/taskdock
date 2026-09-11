"""Controlled main-window acceptance coverage for TaskDock's browser UI."""

from __future__ import annotations

import json
import os
from queue import Empty, Queue
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CHROME = Path(r"D:\soft\playwright-chrome-win64\chrome-win64\chrome.exe")
CHROME = Path(os.environ.get("TASKDOCK_PLAYWRIGHT_CHROME", DEFAULT_CHROME))
SERVER_TIMEOUT_SECONDS = 15
SERVER_SHUTDOWN_TIMEOUT_SECONDS = 5
POSIX_SIGKILL = getattr(signal, "SIGKILL", 9)


TAURI_MOCK = r"""
(() => {
  Object.defineProperty(navigator, "language", { configurable: true, get: () => "en-US" });
  const callbacks = new Map();
  const listeners = new Map();
  const calls = [];
  const mutationKeys = new Set();
  let callbackId = 1;
  let listenerId = 1;
  const now = "2026-09-09T09:00:00.000Z";
  const project = {
    id: "project-e2e",
    name: "E2E Project",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const task = (id, title, overrides = {}) => ({
    id,
    title,
    note: "",
    projectId: null,
    parentId: null,
    priority: "Normal",
    scheduledAt: now,
    dueAt: null,
    completedAt: null,
    recurrence: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    ...overrides,
  });
  const tasks = new Map([
    ["task-inbox-1", task("task-inbox-1", "E2E initial task")],
    [
      "task-parent-e2e",
      task("task-parent-e2e", "E2E parent task", { projectId: project.id }),
    ],
    [
      "task-child-e2e",
      task("task-child-e2e", "E2E child task", {
        parentId: "task-parent-e2e",
        projectId: project.id,
      }),
    ],
  ]);
  const tags = new Map([
    ["task-inbox-1", ["initial-tag"]],
    ["task-parent-e2e", []],
    ["task-child-e2e", []],
  ]);
  let createdTaskNumber = 0;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const allTasks = () => Array.from(tasks.values());
  const taskEditor = (id) => {
    const selected = tasks.get(id);
    if (!selected) throw new Error(`Unknown task: ${id}`);
    return clone({
      task: selected,
      tagNames: tags.get(id) || [],
      subtasks: allTasks().filter((candidate) => candidate.parentId === id),
    });
  };
  const summary = (candidate) => ({
    id: candidate.id,
    title: candidate.title,
    projectName: candidate.projectId === project.id ? project.name : null,
    tags: clone(tags.get(candidate.id) || []),
    priority: candidate.priority,
    scheduledAt: candidate.scheduledAt,
    dueAt: candidate.dueAt,
    completed: candidate.completedAt !== null,
    childTotal: allTasks().filter((item) => item.parentId === candidate.id).length,
    childCompleted: allTasks().filter(
      (item) => item.parentId === candidate.id && item.completedAt !== null,
    ).length,
  });
  const emitMutation = (payload = {}) => {
    for (const listener of listeners.values()) {
      if (listener.event === "task://mutated") {
        const callback = callbacks.get(listener.handler);
        if (callback) callback({ event: listener.event, id: listener.id, payload });
      }
    }
  };
  const recordMutation = (command, args) => {
    const key = `${command}:${args.id || "new-task"}`;
    if (mutationKeys.has(key)) throw new Error(`Unexpected duplicate mutation: ${key}`);
    mutationKeys.add(key);
  };
  const invoke = async (command, args = {}) => {
    calls.push(clone({ command, args }));
    if (command === "plugin:event|listen") {
      const id = listenerId++;
      listeners.set(id, { event: args.event, handler: args.handler, id });
      return id;
    }
    if (command === "plugin:event|unlisten") {
      listeners.delete(args.eventId);
      return null;
    }
    if (command === "get_quick_panel_behavior") return "click";
    if (command === "set_quick_panel_mode") return null;
    if (command === "list_inbox") {
      return clone(allTasks().filter((candidate) => candidate.completedAt === null));
    }
    if (command === "list_projects") return clone([project]);
    if (command === "list_tasks") {
      const view = args.view;
      let result = allTasks();
      if (view.kind === "completed") result = result.filter((candidate) => candidate.completedAt !== null);
      if (view.kind === "today") result = result.filter((candidate) => candidate.completedAt === null);
      if (view.kind === "upcoming") result = result.filter((candidate) => candidate.completedAt === null);
      if (view.kind === "calendar") result = result.filter((candidate) => candidate.scheduledAt !== null);
      if (view.kind === "search") {
        const query = view.query.toLowerCase();
        result = result.filter((candidate) => candidate.title.toLowerCase().includes(query));
      }
      return clone(result.map(summary));
    }
    if (command === "get_task_editor") return taskEditor(args.id);
    if (command === "create_task_editor") {
      recordMutation(command, args);
      const id = `task-e2e-${++createdTaskNumber}`;
      tasks.set(id, task(id, args.draft.title, { ...args.draft, id }));
      tags.set(id, clone(args.tagNames));
      return taskEditor(id);
    }
    if (command === "update_task_editor") {
      recordMutation(command, args);
      const selected = tasks.get(args.id);
      if (!selected) throw new Error(`Unknown task: ${args.id}`);
      if (selected.revision !== args.expectedRevision) throw new Error("Unexpected revision");
      Object.assign(selected, args.patch, { revision: selected.revision + 1, updatedAt: now });
      tags.set(args.id, clone(args.tagNames));
      return taskEditor(args.id);
    }
    if (command === "complete_task") {
      recordMutation(command, args);
      const selected = tasks.get(args.id);
      if (!selected) throw new Error(`Unknown task: ${args.id}`);
      selected.completedAt = now;
      selected.revision += 1;
      selected.updatedAt = now;
      return clone(selected);
    }
    throw new Error(`Unexpected mocked Tauri command: ${command}`);
  };

  window.__TAURI_INTERNALS__ = {
    convertFileSrc: (path) => path,
    invoke,
    transformCallback: (callback) => {
      const id = callbackId++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event, id) => listeners.delete(id),
  };
  window.__taskDockMock = {
    calls,
    emitMutation,
    mutateAndEmit: (id, changes, tagNames, subtasks = []) => {
      const selected = tasks.get(id);
      if (!selected) throw new Error(`Unknown task: ${id}`);
      Object.assign(selected, changes, { updatedAt: now });
      if (tagNames) tags.set(id, clone(tagNames));
      for (const subtask of allTasks().filter((candidate) => candidate.parentId === id)) {
        tasks.delete(subtask.id);
        tags.delete(subtask.id);
      }
      for (const subtask of subtasks) {
        tasks.set(subtask.id, task(subtask.id, subtask.title, {
          parentId: id,
          projectId: selected.projectId,
          ...subtask,
        }));
        tags.set(subtask.id, []);
      }
      emitMutation({ id, revision: selected.revision });
    },
  };
})();
"""

QUICK_PANEL_BEHAVIOR_LOAD_FAILURE = r"""
(() => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (command === "get_quick_panel_behavior") {
      throw {
        code: "storage_unavailable",
        message_key: "errors.storage.unavailable",
      };
    }
    return invoke(command, args);
  };
})();
"""


def find_available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def build_vite_command(port: int) -> list[str]:
    return [
        "pnpm.cmd" if os.name == "nt" else "pnpm",
        "vite",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--strictPort",
    ]


def vite_process_options(platform: str | None = None) -> dict[str, bool]:
    return {"start_new_session": True} if (platform or os.name) != "nt" else {}


def get_process_group(process_id: int) -> int:
    return os.getpgid(process_id)


def kill_process_group(group_id: int, signal_number: int) -> None:
    os.killpg(group_id, signal_number)


def is_process_group_alive(group_id: int) -> bool:
    try:
        os.killpg(group_id, 0)
        return True
    except ProcessLookupError:
        return False


def wait_for_process_group_exit(
    group_id: int,
    group_is_alive: Any,
    process: Any | None = None,
) -> bool:
    deadline = time.monotonic() + SERVER_SHUTDOWN_TIMEOUT_SECONDS
    while group_is_alive(group_id):
        if process is not None and process.poll() is not None:
            try:
                process.wait(timeout=0)
            except subprocess.TimeoutExpired:
                pass
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.05)
    return True


def format_startup_output(output_lines: list[str]) -> str:
    recent_output = "".join(output_lines[-20:]).strip()
    return recent_output if recent_output else "<no startup output>"


def pump_process_output(
    stream: Any,
    readiness_output: Queue[str],
    output_lines: list[str],
) -> None:
    for line in stream:
        output_lines.append(line)
        readiness_output.put(line)


def wait_for_vite_ready(
    port: int,
    process: Any,
    readiness_output: Queue[str],
    connect: Any = socket.create_connection,
    output_lines: list[str] | None = None,
) -> None:
    expected_url = f"http://127.0.0.1:{port}/"
    deadline = time.monotonic() + SERVER_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = format_startup_output(output_lines or [])
            raise RuntimeError(
                f"Vite exited before announcing {expected_url} (exit {process.returncode}). "
                f"Startup output: {output}"
            )
        try:
            line = readiness_output.get(timeout=0.1)
        except Empty:
            continue
        if "Local:" not in line or expected_url not in line:
            continue
        if process.poll() is not None:
            output = format_startup_output(output_lines or [])
            raise RuntimeError(
                f"Vite exited after announcing {expected_url} (exit {process.returncode}). "
                f"Startup output: {output}"
            )
        try:
            with connect(("127.0.0.1", port), timeout=0.2):
                return
        except OSError as error:
            output = format_startup_output(output_lines or [])
            raise RuntimeError(
                f"Vite announced {expected_url} but its loopback listener is unavailable. "
                f"Startup output: {output}"
            ) from error
    output = format_startup_output(output_lines or [])
    raise RuntimeError(
        f"Vite did not announce its own loopback URL {expected_url}. Startup output: {output}"
    )


def find_listening_process_id(port: int) -> int | None:
    if os.name != "nt":
        return None
    result = subprocess.run(
        ["netstat", "-ano", "-p", "tcp"],
        check=False,
        capture_output=True,
        text=True,
    )
    for line in result.stdout.splitlines():
        columns = line.split()
        if (
            len(columns) >= 5
            and columns[0].upper() == "TCP"
            and columns[1] == f"127.0.0.1:{port}"
            and columns[3].upper() == "LISTENING"
        ):
            return int(columns[4])
    return None


def stop_server(
    process: Any,
    port: int,
    platform: str | None = None,
    process_group_id: int | None = None,
    get_process_group: Any = get_process_group,
    kill_process_group: Any = kill_process_group,
    is_process_group_alive: Any = is_process_group_alive,
    wait_for_group_exit: Any = wait_for_process_group_exit,
    find_listening_process_id: Any = find_listening_process_id,
    run_command: Any = subprocess.run,
    connect: Any = socket.create_connection,
    verify_port_closed: bool = True,
) -> None:
    current_platform = platform or os.name
    if current_platform == "nt":
        listener_process_id = find_listening_process_id(port)
        if listener_process_id is not None or process.poll() is None:
            run_command(
                [
                    "taskkill",
                    "/PID",
                    str(listener_process_id if listener_process_id is not None else process.pid),
                    "/T",
                    "/F",
                ],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
            )
        try:
            process.wait(timeout=SERVER_SHUTDOWN_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=SERVER_SHUTDOWN_TIMEOUT_SECONDS)
    else:
        saved_group_id = process_group_id if process_group_id is not None else process.pid
        if is_process_group_alive(saved_group_id):
            try:
                kill_process_group(saved_group_id, signal.SIGTERM)
            except ProcessLookupError:
                pass
        if not wait_for_group_exit(saved_group_id, is_process_group_alive, process):
            try:
                kill_process_group(saved_group_id, POSIX_SIGKILL)
            except ProcessLookupError:
                pass
            if not wait_for_group_exit(saved_group_id, is_process_group_alive, process):
                raise RuntimeError(f"Vite process group {saved_group_id} did not exit after SIGKILL.")
        try:
            process.wait(timeout=SERVER_SHUTDOWN_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("Vite root process did not exit after process-group cleanup.") from error
    if process.poll() is None:
        raise RuntimeError("Vite did not exit after termination.")
    if not verify_port_closed:
        return
    try:
        with connect(("127.0.0.1", port), timeout=0.2):
            raise RuntimeError(f"Vite still accepts loopback connections on port {port} after cleanup.")
    except OSError:
        return


def calls(page: Page) -> list[dict[str, Any]]:
    return page.evaluate("() => window.__taskDockMock.calls")


def wait_for_call(page: Page, command: str, expected_args: dict[str, Any]) -> None:
    page.wait_for_function(
        """([command, expected]) => window.__taskDockMock.calls.some((call) =>
          call.command === command && JSON.stringify(call.args) === JSON.stringify(expected)
        )""",
        arg=[command, expected_args],
    )


def assert_exact_mutation(
    page: Page,
    command: str,
    expected_args: dict[str, Any],
    previous_count: int,
) -> None:
    page.wait_for_function("(count) => window.__taskDockMock.calls.length > count", arg=previous_count)
    mutations = [call for call in calls(page)[previous_count:] if call["command"] == command]
    if mutations != [{"command": command, "args": expected_args}]:
        raise AssertionError(
            f"Expected one exact {command} mutation, got {json.dumps(mutations, ensure_ascii=False)}"
        )


def assert_exact_mutation_sequence(
    recorded: list[dict[str, Any]],
    expected: list[dict[str, Any]],
) -> None:
    if recorded != expected:
        raise AssertionError(
            "Expected exact final mutation sequence "
            f"{json.dumps(expected, ensure_ascii=False)}, got {json.dumps(recorded, ensure_ascii=False)}"
        )


def assert_final_mutation_sequence(page: Page, expected: list[dict[str, Any]]) -> None:
    page.evaluate(
        """() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })"""
    )
    recorded = [
        call
        for call in calls(page)
        if call["command"] in {"create_task_editor", "update_task_editor", "complete_task"}
    ]
    assert_exact_mutation_sequence(recorded, expected)


def wait_for_call_after(
    page: Page,
    command: str,
    expected_args: dict[str, Any],
    previous_count: int,
) -> None:
    page.wait_for_function(
        """([count, command, expected]) => window.__taskDockMock.calls.slice(count).some((call) =>
          call.command === command && JSON.stringify(call.args) === JSON.stringify(expected)
        )""",
        arg=[previous_count, command, expected_args],
    )


def assert_no_horizontal_overflow(page: Page, viewport: str) -> None:
    overflow = page.evaluate(
        """() => ({
          body: document.body.scrollWidth > document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          bodyWidth: document.body.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
        })"""
    )
    if overflow["body"] or overflow["document"]:
        raise AssertionError(f"{viewport} has horizontal overflow: {json.dumps(overflow)}")


def run_desktop_flow(page: Page) -> None:
    expect(page.get_by_role("heading", name="Inbox", level=1)).to_be_visible()
    expect(page.get_by_text("E2E initial task", exact=True)).to_be_visible()
    wait_for_call(page, "list_inbox", {})

    for label, view in (("Today", {"kind": "today"}), ("Completed", {"kind": "completed"})):
        page.get_by_role("button", name=label).click()
        expect(page.get_by_role("heading", name=label, level=1)).to_be_visible()
        wait_for_call(page, "list_tasks", {"view": view})

    page.get_by_role("button", name="Calendar").click()
    expect(page.get_by_role("heading", name="Calendar", level=1)).to_be_visible()
    calendar_month = page.evaluate(
        """() => {
          const now = new Date();
          return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        }"""
    )
    wait_for_call(page, "list_tasks", {"view": {"kind": "calendar", "month": calendar_month}})
    page.get_by_role("button", name="Inbox").click()
    expect(page.get_by_role("heading", name="Inbox", level=1)).to_be_visible()

    create_start = len(calls(page))
    page.get_by_role("button", name="Add task").click()
    expect(page.get_by_role("region", name="Add task")).to_be_visible()
    page.locator("#task-title").fill("E2E created task")
    page.locator("#task-note").fill("Created by the controlled browser runner")
    page.get_by_role("button", name="Save task").click()
    expect(page.get_by_role("button", name="Edit task E2E created task")).to_be_visible()
    create_payload = {
        "draft": {
            "dueAt": None,
            "note": "Created by the controlled browser runner",
            "priority": "Normal",
            "projectId": None,
            "recurrence": None,
            "scheduledAt": None,
            "title": "E2E created task",
        },
        "tagNames": [],
    }
    assert_exact_mutation(page, "create_task_editor", create_payload, create_start)

    page.get_by_role("button", name="Edit task E2E created task").click()
    expect(page.locator("#task-title")).to_have_value("E2E created task")
    update_start = len(calls(page))
    page.locator("#task-title").fill("E2E edited task")
    page.get_by_role("button", name="Update task").click()
    expect(page.get_by_role("button", name="Edit task E2E edited task")).to_be_visible()
    update_payload = {
        "expectedRevision": 1,
        "id": "task-e2e-1",
        "patch": {
            "dueAt": None,
            "note": "Created by the controlled browser runner",
            "priority": "Normal",
            "projectId": None,
            "recurrence": None,
            "scheduledAt": None,
            "title": "E2E edited task",
        },
        "tagNames": [],
    }
    assert_exact_mutation(page, "update_task_editor", update_payload, update_start)

    complete_start = len(calls(page))
    page.get_by_role("checkbox", name="Complete task task-e2e-1").click()
    expect(page.get_by_role("button", name="Edit task E2E edited task")).not_to_be_visible()
    assert_exact_mutation(page, "complete_task", {"id": "task-e2e-1"}, complete_start)

    page.get_by_role("button", name="Search").click()
    search_input = page.get_by_role("searchbox", name="Search tasks")
    expect(search_input).to_be_focused()
    search_input.fill("initial")
    wait_for_call(page, "list_tasks", {"view": {"kind": "search", "query": "initial"}})
    expect(
        page.get_by_role("region", name="Search results").get_by_text("E2E initial task", exact=True)
    ).to_be_visible()
    page.get_by_role("button", name="Close search").click()

    page.get_by_role("button", name="Edit task E2E initial task").click()
    expect(page.locator("#task-title")).to_have_value("E2E initial task")
    external_refresh_start = len(calls(page))
    page.evaluate(
        """() => window.__taskDockMock.mutateAndEmit(
          "task-inbox-1",
          { title: "E2E external title", revision: 2 },
          ["external-tag"],
          [{ id: "task-external-subtask", title: "E2E external subtask" }],
        )"""
    )
    expect(page.locator("#task-title")).to_have_value("E2E external title")
    expect(page.get_by_text("external-tag", exact=True)).to_be_visible()
    expect(
        page.get_by_role("region", name="Subtasks").get_by_text("E2E external subtask", exact=True)
    ).to_be_visible()
    wait_for_call_after(
        page,
        "get_task_editor",
        {"id": "task-inbox-1"},
        external_refresh_start,
    )

    page.get_by_role("button", name="Edit task E2E child task").click()
    expect(page.locator("#task-project")).to_be_disabled()
    expect(page.locator("#task-project")).to_have_value("Inherited from parent")
    child_update_start = len(calls(page))
    page.locator("#task-title").fill("E2E child edited")
    page.get_by_role("button", name="Update task").click()
    expect(page.get_by_role("button", name="Edit task E2E child edited")).to_be_visible()
    child_update_payload = {
        "expectedRevision": 1,
        "id": "task-child-e2e",
        "patch": {
            "dueAt": None,
            "note": "",
            "priority": "Normal",
            "recurrence": None,
            "scheduledAt": "2026-09-09T09:00:00.000Z",
            "title": "E2E child edited",
        },
        "tagNames": [],
    }
    assert_exact_mutation(page, "update_task_editor", child_update_payload, child_update_start)
    if "projectId" in child_update_payload["patch"]:
        raise AssertionError("The child editor expectation accidentally includes projectId.")
    assert_final_mutation_sequence(
        page,
        [
            {"command": "create_task_editor", "args": create_payload},
            {"command": "update_task_editor", "args": update_payload},
            {"command": "complete_task", "args": {"id": "task-e2e-1"}},
            {"command": "update_task_editor", "args": child_update_payload},
        ],
    )
    assert_no_horizontal_overflow(page, "desktop 1440x900")


def run_mobile_smoke(page: Page) -> None:
    expect(page.get_by_role("heading", name="Inbox", level=1)).to_be_visible()
    wait_for_call(page, "list_inbox", {})
    for label, view in (
        ("Today", {"kind": "today"}),
        ("Completed", {"kind": "completed"}),
    ):
        page.get_by_role("button", name=label).click()
        expect(page.get_by_role("heading", name=label, level=1)).to_be_visible()
        wait_for_call(page, "list_tasks", {"view": view})
        assert_no_horizontal_overflow(page, f"mobile 360x800 ({label})")
    page.get_by_role("button", name="Calendar").click()
    expect(page.get_by_role("heading", name="Calendar", level=1)).to_be_visible()
    assert_no_horizontal_overflow(page, "mobile 360x800 (Calendar)")


def run_quick_panel_click_flow(page: Page) -> None:
    open_button = page.get_by_role("button", name="Open quick panel")
    quick_panel = page.get_by_role("region", name="Quick panel", exact=True)

    expect(open_button).to_be_enabled()
    expect(page.get_by_role("alert")).to_be_visible()
    quick_panel.hover()
    page.wait_for_timeout(260)
    if page.get_by_text("E2E initial task", exact=True).count() != 0:
        raise AssertionError("Quick panel expanded after hover in click mode.")

    open_button.click()
    expect(page.get_by_text("E2E initial task", exact=True)).to_be_visible()
    quick_panel_calls = [
        call for call in calls(page) if call["command"] == "set_quick_panel_mode"
    ]
    expected_calls = [{"command": "set_quick_panel_mode", "args": {"mode": "expanded"}}]
    if quick_panel_calls != expected_calls:
        raise AssertionError(
            "Expected exactly one expanded quick-panel mode request, got "
            f"{json.dumps(quick_panel_calls, ensure_ascii=False)}"
        )


def run_page_flow(page: Page, url: str, flow, initialization_script: str = "") -> list[str]:
    console_errors: list[str] = []
    page_errors: list[str] = []
    page.set_default_timeout(2_500)
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.add_init_script(TAURI_MOCK + initialization_script)
    page.goto(url, wait_until="networkidle")
    try:
        flow(page)
    except BaseException as error:
        raise AssertionError(
            f"{error}; console={json.dumps(console_errors)}; page={json.dumps(page_errors)}; "
            f"IPC={json.dumps(calls(page), ensure_ascii=False)}"
        ) from error
    if console_errors or page_errors:
        raise AssertionError(
            f"Browser errors: console={json.dumps(console_errors)}, page={json.dumps(page_errors)}; "
            f"IPC={json.dumps(calls(page), ensure_ascii=False)}"
        )
    return console_errors + page_errors


def main() -> None:
    if not CHROME.is_file():
        raise SystemExit(
            "No usable Playwright Chrome executable. Set TASKDOCK_PLAYWRIGHT_CHROME to an existing "
            f"browser path (default: {DEFAULT_CHROME})."
        )

    port = find_available_port()
    vite: subprocess.Popen[str] | None = None
    vite_owns_port = False
    vite_process_group_id: int | None = None
    vite_output_thread: threading.Thread | None = None
    vite_output_lines: list[str] = []
    vite_readiness_output: Queue[str] = Queue()
    cleanup_error: BaseException | None = None
    succeeded = False
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
        if os.name != "nt":
            vite_process_group_id = vite.pid
        if vite.stdout is None:
            raise RuntimeError("Unable to capture Vite startup output.")
        vite_output_thread = threading.Thread(
            target=pump_process_output,
            args=(vite.stdout, vite_readiness_output, vite_output_lines),
            daemon=True,
        )
        vite_output_thread.start()
        wait_for_vite_ready(port, vite, vite_readiness_output, output_lines=vite_output_lines)
        vite_owns_port = True
        url = f"http://127.0.0.1:{port}/"
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(CHROME), headless=True)
            try:
                desktop = browser.new_page(viewport={"width": 1440, "height": 900})
                run_page_flow(desktop, url, run_desktop_flow)
                mobile = browser.new_page(viewport={"width": 360, "height": 800})
                run_page_flow(mobile, url, run_mobile_smoke)
                quick_panel = browser.new_page(viewport={"width": 320, "height": 480})
                run_page_flow(
                    quick_panel,
                    f"http://127.0.0.1:{port}/quick-panel.html",
                    run_quick_panel_click_flow,
                    QUICK_PANEL_BEHAVIOR_LOAD_FAILURE,
                )
            finally:
                browser.close()
        succeeded = True
    except (AssertionError, PlaywrightError, RuntimeError) as error:
        raise SystemExit(f"E2E failure: {error}") from error
    finally:
        if vite is not None:
            try:
                stop_server(
                    vite,
                    port,
                    process_group_id=vite_process_group_id,
                    verify_port_closed=vite_owns_port,
                )
            except BaseException as error:  # Cleanup failures invalidate this run.
                cleanup_error = error
        if vite_output_thread is not None:
            vite_output_thread.join(timeout=SERVER_SHUTDOWN_TIMEOUT_SECONDS)
        if cleanup_error is not None:
            raise SystemExit(f"E2E cleanup failure: {cleanup_error}") from cleanup_error
    if succeeded:
        print("PASS A1-A8: controlled UI DOM, IPC, event, viewport, and Vite cleanup succeeded.")


def run_contract_self_tests() -> None:
    command = build_vite_command(4173)
    expected = [
        "pnpm.cmd" if os.name == "nt" else "pnpm",
        "vite",
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort",
    ]
    if command != expected:
        raise AssertionError(f"Expected strict loopback Vite command {expected}, got {command}")

    class ReadyProcess:
        def poll(self) -> None:
            return None

    class DummyConnection:
        def __enter__(self) -> "DummyConnection":
            return self

        def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
            return None

    readiness_output: Queue[str] = Queue()
    readiness_output.put("  Local:   http://127.0.0.1:4173/\n")
    probes: list[tuple[tuple[str, int], float]] = []

    def connect(address: tuple[str, int], timeout: float) -> DummyConnection:
        probes.append((address, timeout))
        return DummyConnection()

    wait_for_vite_ready(4173, ReadyProcess(), readiness_output, connect)
    if probes != [(("127.0.0.1", 4173), 0.2)]:
        raise AssertionError(f"Expected readiness to probe only the announced loopback port, got {probes}")

    if vite_process_options("posix") != {"start_new_session": True}:
        raise AssertionError("POSIX Vite process must start in its own session.")

    class StoppedProcess:
        pid = 41
        returncode: int | None = None

        def poll(self) -> int | None:
            return self.returncode

        def wait(self, timeout: float) -> int:
            self.returncode = 0
            return 0

    cleanup_signals: list[tuple[int, int]] = []

    def unavailable_connection(_address: tuple[str, int], timeout: float) -> DummyConnection:
        raise OSError("port closed")

    class WindowsServerProcess:
        pid = 41
        returncode: int | None = None

        def poll(self) -> int | None:
            return self.returncode

        def wait(self, timeout: float) -> int:
            self.returncode = 0
            return self.returncode

    windows_commands: list[list[str]] = []
    stop_server(
        WindowsServerProcess(),
        4173,
        platform="nt",
        find_listening_process_id=lambda _port: 31415,
        run_command=lambda command, **_kwargs: windows_commands.append(command),
        connect=unavailable_connection,
    )
    if windows_commands != [["taskkill", "/PID", "31415", "/T", "/F"]]:
        raise AssertionError(
            f"Expected Windows cleanup to target the listening Vite PID, got {windows_commands}"
        )

    stop_server(
        StoppedProcess(),
        4173,
        platform="posix",
        process_group_id=9001,
        get_process_group=lambda _pid: 9001,
        kill_process_group=lambda group, sig: cleanup_signals.append((group, sig)),
        is_process_group_alive=lambda _group: True,
        wait_for_group_exit=lambda _group, _is_alive, _process: True,
        connect=unavailable_connection,
    )
    if cleanup_signals != [(9001, signal.SIGTERM)]:
        raise AssertionError(f"Expected only SIGTERM for a clean POSIX group shutdown, got {cleanup_signals}")

    zombie_signals: list[tuple[int, int]] = []

    class ZombieRootProcess:
        pid = 41
        returncode: int | None = None

        def __init__(self) -> None:
            self.reaped = False
            self.wait_timeouts: list[float] = []

        def poll(self) -> int | None:
            if (9001, signal.SIGTERM) in zombie_signals:
                return 0
            return None

        def wait(self, timeout: float) -> int:
            self.wait_timeouts.append(timeout)
            self.reaped = True
            self.returncode = 0
            return 0

    zombie_root = ZombieRootProcess()
    stop_server(
        zombie_root,
        4173,
        platform="posix",
        process_group_id=9001,
        kill_process_group=lambda group, sig: zombie_signals.append((group, sig)),
        is_process_group_alive=lambda _group: not zombie_root.reaped,
        connect=unavailable_connection,
    )
    if zombie_signals != [(9001, signal.SIGTERM)]:
        raise AssertionError(f"Expected zombie root cleanup to avoid SIGKILL, got {zombie_signals}")
    if zombie_root.wait_timeouts[0] != 0:
        raise AssertionError("Expected exited POSIX root to be reaped during group shutdown.")

    class RootExitedProcess:
        pid = 41
        returncode = 0

        def poll(self) -> int:
            return self.returncode

        def wait(self, timeout: float) -> int:
            return self.returncode

    exited_root_signals: list[tuple[int, int]] = []
    stop_server(
        RootExitedProcess(),
        4173,
        platform="posix",
        process_group_id=9001,
        is_process_group_alive=lambda _group: True,
        kill_process_group=lambda group, sig: exited_root_signals.append((group, sig)),
        wait_for_group_exit=lambda _group, _is_alive, _process: True,
        connect=unavailable_connection,
    )
    if exited_root_signals != [(9001, signal.SIGTERM)]:
        raise AssertionError(
            f"Expected saved group cleanup after root exit, got {exited_root_signals}"
        )

    kill_order_signals: list[tuple[int, int]] = []

    class ReapAfterKillProcess(RootExitedProcess):
        def wait(self, timeout: float) -> int:
            if (9001, POSIX_SIGKILL) not in kill_order_signals:
                raise AssertionError("POSIX root was reaped before its saved group received SIGKILL.")
            return self.returncode

    group_waits = iter([False, True])
    stop_server(
        ReapAfterKillProcess(),
        4173,
        platform="posix",
        process_group_id=9001,
        is_process_group_alive=lambda _group: True,
        kill_process_group=lambda group, sig: kill_order_signals.append((group, sig)),
        wait_for_group_exit=lambda _group, _is_alive, _process: next(group_waits),
        connect=unavailable_connection,
    )
    if kill_order_signals != [(9001, signal.SIGTERM), (9001, POSIX_SIGKILL)]:
        raise AssertionError(f"Expected TERM then KILL for the saved group, got {kill_order_signals}")

    stop_server(
        StoppedProcess(),
        4173,
        platform="posix",
        process_group_id=9001,
        get_process_group=lambda _pid: 9001,
        kill_process_group=lambda _group, _signal: None,
        is_process_group_alive=lambda _group: True,
        wait_for_group_exit=lambda _group, _is_alive, _process: True,
        connect=connect,
        verify_port_closed=False,
    )

    expected_mutations = [{"command": "complete_task", "args": {"id": "task-e2e-1"}}]
    try:
        assert_exact_mutation_sequence(expected_mutations * 2, expected_mutations)
    except AssertionError:
        pass
    else:
        raise AssertionError("A duplicate mutation must fail the final sequence assertion.")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        run_contract_self_tests()
    else:
        main()
