import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import SearchDialog from "./SearchDialog";

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
