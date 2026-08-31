import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "./App";

test("renders a local application shell without links", () => {
  const { container } = render(<App />);

  expect(screen.getByRole("main")).toBeInTheDocument();
  expect(container.querySelectorAll("a")).toHaveLength(0);
});
