import { expect, test } from "@playwright/test";

/**
 * The second flow docs/spec/09-testing.md's "Priority 4" names: real-time
 * reconnection behavior, from docs/spec/06-realtime-architecture.md and the
 * useRealtimeAlerts hook (apps/web/src/lib/realtime-client.ts) it drives.
 *
 * There's no API process to kill from here, so the drop is simulated at
 * the network layer: route interception fails every request to the SSE
 * endpoint, which is exactly what useRealtimeAlerts's EventSource.onerror
 * path is built to handle (it doesn't know or care *why* the connection
 * failed) — then interception is lifted to prove the UI recovers once the
 * browser's own reconnect attempt succeeds, without a manual refresh.
 */
test("alerts list shows a paused status while the live connection is down, and recovers once it's back", async ({ page }) => {
  let blockStream = true;
  await page.route("**/api/realtime/stream**", async (route) => {
    if (blockStream) await route.abort("connectionrefused");
    else await route.continue();
  });

  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();

  // EventSource's default ~3s retry means this takes a few failed attempts
  // to reach the "lost" threshold in useRealtimeAlerts (failureCount >= 3).
  await expect(page.getByText("Live updates paused")).toBeVisible({ timeout: 20_000 });

  // Existing data must stay usable while disconnected — not the point of
  // this test to assert on table contents, but the page must not have
  // errored out from the dropped stream.
  await expect(page.getByRole("table")).toBeVisible();

  blockStream = false;

  await expect(page.getByText("Live updates paused")).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(/Connecting to live updates…|Reconnecting…/)).toBeHidden();
});
