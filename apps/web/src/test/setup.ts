import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// @testing-library/react only auto-registers this when a global `afterEach`
// already exists on globalThis; this project doesn't enable Vitest's
// `test.globals`, so it must be wired explicitly — otherwise every test
// file's DOM (and any element it renders, like the "Environment" <select>
// every FleetOverview/AlertsList render includes) accumulates across tests
// in the same file, and `screen.getByLabelText(...)` starts resolving
// stale nodes from a previous test instead of the current render.
afterEach(() => {
  cleanup();
});
