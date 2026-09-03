import { expect, test } from "@playwright/test";

/**
 * The primary journey from docs/spec/02-user-journeys.md, walked against
 * the deterministic seed (apps/api/src/infra/db/seed.ts): payments-api's
 * error_rate_pct spikes in production ~6h ago, a few minutes after a
 * v2.14.0 deploy, and that spike is what produces the one firing alert.
 * Requires the seed to have run — see playwright.config.ts.
 */
test("dashboard → service → metric chart → deployment correlation → alert detail", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
  await page.getByRole("link", { name: "Payments API" }).click();

  await expect(page.getByRole("heading", { name: "Payments API" })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "error_rate_pct" }).getByRole("link", { name: "production" }).click();

  await expect(page).toHaveURL(/\/services\/.+\/metrics\/.+\?environment=production/);
  await expect(page.getByRole("heading", { name: /error_rate_pct/ })).toBeVisible();

  // The alert rule that will fire from this spike (gt 5%, seed.ts) overlaid
  // as a threshold line — and stated as text, per
  // docs/spec/11-accessibility.md ("never conveyed only by a canvas line").
  await expect(page.getByText("Alert threshold:")).toBeVisible();

  // The deployment marker is drawn on canvas; this list is the same data
  // as accessible text (docs/spec/11-accessibility.md, "Metric chart").
  await expect(page.getByRole("heading", { name: "Deployments in this window" })).toBeVisible();
  await expect(page.getByText("v2.14.0")).toBeVisible();

  await page.getByRole("link", { name: "Alerts" }).click();
  await expect(page).toHaveURL("/alerts");

  await page
    .getByRole("table")
    .getByRole("row")
    .filter({ hasText: "Payments API" })
    .getByRole("link", { name: "Payments API" })
    .click();

  await expect(page).toHaveURL(/\/alerts\/.+/);
  await expect(page.getByRole("heading", { name: "error_rate_pct" })).toBeVisible();
  await expect(page.getByText("Firing")).toBeVisible();
  await expect(page.getByText("gt 5 for 180s")).toBeVisible();
});
