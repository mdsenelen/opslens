import { defineConfig, devices } from "@playwright/test";

/**
 * Scoped to exactly the two flows docs/spec/09-testing.md's "Priority 4"
 * names — the primary regression-investigation journey and the real-time
 * reconnection behavior — not a broad per-screen suite (that's what the
 * component tests in src/**\/*.test.tsx are for).
 *
 * Requires a migrated, seeded Postgres reachable at DATABASE_URL (`pnpm
 * db:up && pnpm --filter @opslens/api migrate:up && pnpm --filter
 * @opslens/api seed` from the repo root) before running. webServer below
 * then starts the API and web app itself.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @opslens/api start",
      url: "http://localhost:4000/api/ping",
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
    },
    {
      command: "pnpm --filter @opslens/web dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
    },
  ],
});
