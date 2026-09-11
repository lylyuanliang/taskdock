import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { SearchQueryState } from "./searchQueryState";
import SearchDialog from "./SearchDialog";

const searchTask = {
  childCompleted: 0,
  childTotal: 0,
  completed: false,
  dueAt: null,
  id: "search-task",
  priority: "Normal" as const,
  projectName: null,
  scheduledAt: null,
  tags: [],
  title: "Release checklist",
};

function createSearchState(
  loadState: SearchQueryState["loadState"],
  query = "release",
): SearchQueryState {
  return {
    input: query,
    isOpen: true,
    loadState,
    query,
  };
}

afterEach(() => {
  cleanup();
});

it("marks only an active search result region as busy", () => {
  const loadingState = createSearchState({ query: "release", requestId: 1, status: "loading" });

  render(<SearchDialog isOpen onClose={vi.fn()} state={loadingState} />);

  expect(screen.getByRole("region", { name: "Search results" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  expect(screen.getByRole("searchbox", { name: "Search tasks" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Close search" })).toBeEnabled();
});

it("announces a prompt before a search query exists", () => {
  const promptState = createSearchState({ status: "idle" }, "");

  render(<SearchDialog isOpen onClose={vi.fn()} state={promptState} />);

  const results = screen.getByRole("region", { name: "Search results" });

  expect(results).not.toHaveAttribute("aria-busy");
  expect(screen.getByRole("status")).toHaveTextContent("Enter a search term to find tasks.");
});

it("announces a loading search without disabling dialog controls", () => {
  const loadingState = createSearchState({ query: "release", requestId: 1, status: "loading" });

  render(<SearchDialog isOpen onClose={vi.fn()} state={loadingState} />);

  expect(screen.getByRole("status")).toHaveTextContent("Searching tasks...");
  expect(screen.getByRole("searchbox", { name: "Search tasks" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Close search" })).toBeEnabled();
});

it("announces a translated search failure as an alert", () => {
  const errorState = createSearchState({
    errorMessageKey: "errors.storage.unavailable",
    query: "release",
    requestId: 1,
    status: "error",
  });

  render(<SearchDialog isOpen onClose={vi.fn()} state={errorState} />);

  expect(screen.getByRole("alert")).toHaveTextContent("Local storage is temporarily unavailable");
});

it("announces an empty ready search as a status", () => {
  const emptyState = createSearchState({
    query: "release",
    requestId: 1,
    status: "ready",
    tasks: [],
  });

  render(<SearchDialog isOpen onClose={vi.fn()} state={emptyState} />);

  expect(screen.getByRole("status")).toHaveTextContent("No matching tasks.");
});

it("renders ready search results without mutation controls", () => {
  const readyState = createSearchState({
    query: "release",
    requestId: 1,
    status: "ready",
    tasks: [searchTask],
  });

  render(<SearchDialog isOpen onClose={vi.fn()} state={readyState} />);

  const results = screen.getByRole("region", { name: "Search results" });

  expect(results).not.toHaveAttribute("aria-busy");
  expect(screen.getByText("Release checklist")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /complete|restore/i })).not.toBeInTheDocument();
});

it("focuses the search input and restores the opener after Escape", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();

  function SearchDialogHarness() {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <button onClick={() => setIsOpen(true)} type="button">
          Search
        </button>
        <SearchDialog
          isOpen={isOpen}
          onClose={() => {
            onClose();
            setIsOpen(false);
          }}
        />
      </>
    );
  }

  render(<SearchDialogHarness />);

  const opener = screen.getByRole("button", { name: "Search" });
  await user.click(opener);

  const dialog = screen.getByRole("dialog", { name: "Search tasks" });
  const input = screen.getByRole("searchbox", { name: "Search tasks" });

  expect(input).toHaveFocus();
  expect(dialog).toHaveAttribute("aria-modal", "true");

  await user.tab();
  expect(screen.getByRole("button", { name: "Close search" })).toHaveFocus();
  await user.tab();
  expect(input).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Close search" })).toHaveFocus();

  await user.keyboard("{Escape}");

  expect(onClose).toHaveBeenCalledOnce();
  expect(opener).toHaveFocus();
});
