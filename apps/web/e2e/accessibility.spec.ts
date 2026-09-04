import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Systematic axe-core scanning, deferred exactly as long as
 * docs/spec/11-accessibility.md's "Deferred, not excluded" section said it
 * should be — "reasonable once there are enough real components to make
 * automated scanning worthwhile," which is now. Scoped to WCAG 2 A/AA rules
 * (not axe's "best-practice" rules, which are opinionated beyond the spec)
 * against every one of the six MVP screens, reusing the seeded regression
 * scenario the other E2E specs already navigate.
 */
async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test("fleet overview", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
  await expectNoViolations(page);
});

test("alerts list", async ({ page }) => {
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await expectNoViolations(page);
});

test("deployments list", async ({ page }) => {
  await page.goto("/deployments");
  await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  await expectNoViolations(page);
});

test("service detail, metric chart, and alert detail", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Payments API" }).click();
  await expect(page.getByRole("heading", { name: "Payments API" })).toBeVisible();
  await expectNoViolations(page);

  await page.getByRole("listitem").filter({ hasText: "error_rate_pct" }).getByRole("link", { name: "production" }).click();
  await expect(page.getByRole("heading", { name: /error_rate_pct/ })).toBeVisible();
  await expect(page.getByText("Alert threshold:")).toBeVisible();
  await expectNoViolations(page);

  // Opening the accessible points-table alternative renders up to 1,000
  // more rows (metricPointsQuerySchema's cap) — scanned too, not just its
  // collapsed default state.
  await page.getByText(/Show data as a table/).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expectNoViolations(page);

  await page.getByRole("link", { name: "Alerts" }).click();
  await page.getByRole("table").getByRole("row").filter({ hasText: "Payments API" }).getByRole("link", { name: "Payments API" }).click();
  await expect(page.getByRole("heading", { name: "error_rate_pct" })).toBeVisible();
  await expectNoViolations(page);
});
