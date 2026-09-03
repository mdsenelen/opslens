import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, LoadingState } from "./resource-status";

// The three primitives every fetch-backed screen composes into its
// loading/error/empty/ready state machine (docs/spec/02-user-journeys.md,
// docs/spec/09-testing.md's "four-way ApiError state rendering" priority).
// Covered at the primitive level here; fleet-overview.test.tsx covers the
// same states wired to a real fetcher.
describe("LoadingState", () => {
  it("announces via role=status", () => {
    render(<LoadingState label="Loading services…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading services…");
  });
});

describe("ErrorState", () => {
  it("announces via role=alert and invokes onRetry when clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState message="Can't reach the API." onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Can't reach the API.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("EmptyState", () => {
  it("renders the given message as plain text", () => {
    render(<EmptyState message="No services match these filters." />);
    expect(screen.getByText("No services match these filters.")).toBeInTheDocument();
  });
});
