import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { NavLink } from "./nav-link";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

function renderAt(pathname: string) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  render(
    <nav>
      <NavLink href="/" alsoMatches={["/services"]}>
        Fleet
      </NavLink>
      <NavLink href="/alerts">Alerts</NavLink>
    </nav>,
  );
}

// The current section is exposed to assistive tech with aria-current, not
// only drawn as an underline (docs/spec/11-accessibility.md).
describe("NavLink", () => {
  it("marks a nested route as being inside its section", () => {
    renderAt("/alerts/123");
    expect(screen.getByRole("link", { name: "Alerts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Fleet" })).not.toHaveAttribute("aria-current");
  });

  it("does not let the root link claim every route, but honours alsoMatches", () => {
    renderAt("/services/abc/metrics/def");
    expect(screen.getByRole("link", { name: "Fleet" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Alerts" })).not.toHaveAttribute("aria-current");
  });
});
