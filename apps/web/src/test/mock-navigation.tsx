import { render, type RenderResult } from "@testing-library/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cloneElement, useRef, useState, type ReactElement } from "react";
import { vi } from "vitest";

/**
 * useUrlState (lib/url-state.ts) calls next/navigation's router hooks
 * directly, which throw outside a mounted App Router. Every test that
 * renders a feature depending on useUrlState needs the module mocked first:
 *
 *   vi.mock("next/navigation", () => ({
 *     useRouter: vi.fn(), usePathname: vi.fn(), useSearchParams: vi.fn(),
 *   }));
 *
 * (vi.mock's hoisting requires that factory to be self-contained, so it
 * can't live here.) renderWithNavigation then wires those three mocked
 * hooks to real React state, so that calling push() — exactly like a real
 * App Router navigation — re-renders the tree with the new search params
 * and any filter-triggered refetch actually happens, not just a spy call
 * with no observable effect.
 */
export function renderWithNavigation(ui: ReactElement, initialSearch = ""): RenderResult & { push: ReturnType<typeof vi.fn> } {
  const nav: { push?: ReturnType<typeof vi.fn> } = {};

  function Harness() {
    const [search, setSearch] = useState(() => new URLSearchParams(initialSearch));
    const pushRef = useRef(
      vi.fn((url: string) => {
        const [, qs] = url.split("?");
        setSearch(new URLSearchParams(qs ?? ""));
      }),
    );
    nav.push = pushRef.current;

    vi.mocked(useRouter).mockReturnValue({ push: pushRef.current } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(usePathname).mockReturnValue("/");
    vi.mocked(useSearchParams).mockReturnValue(search as ReturnType<typeof useSearchParams>);

    // React bails out of re-rendering a child whose element is the exact
    // same object as last render's — which `ui` always is, since the test
    // constructs it once. cloneElement forces a new element identity each
    // render so a URL-state change (via push -> setSearch above) actually
    // reaches the wrapped component instead of silently no-op'ing.
    return cloneElement(ui);
  }

  const result = render(<Harness />);
  return { ...result, push: nav.push! };
}
