import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The same primary journey as regression-investigation.spec.ts, walked with
 * no mouse at all — Tab to reach every control, Enter to activate it. Proves
 * docs/spec/11-accessibility.md's keyboard-operability requirement against
 * the real app rather than at the component level, where the full Tab order
 * (nav, skip link, filters, table rows, across real page navigations) isn't
 * observable.
 */
async function tabTo(page: Page, locator: Locator, maxPresses = 60): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    if (await locator.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Could not reach the target element via Tab within ${maxPresses} presses`);
}

test("keyboard-only pass: dashboard → service → metric chart → deployment correlation → alert detail", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();

  // The skip link is the very first Tab stop on every page, and activating
  // it moves real keyboard focus into <main> — not just the URL hash
  // (docs/spec/11-accessibility.md; see commit 594c916's fix).
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  const paymentsLink = page.getByRole("link", { name: "Payments API" });
  await tabTo(page, paymentsLink);
  // A visible focus indicator, not just a browser default that could be
  // silently absent (docs/spec/11-accessibility.md's "every focusable
  // element ... needs a visible focus indicator").
  await expect(paymentsLink).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Payments API" })).toBeVisible();

  const productionLink = page.getByRole("listitem").filter({ hasText: "error_rate_pct" }).getByRole("link", { name: "production" });
  await tabTo(page, productionLink);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/services\/.+\/metrics\/.+\?environment=production/);
  await expect(page.getByRole("heading", { name: /error_rate_pct/ })).toBeVisible();
  await expect(page.getByText("Alert threshold:")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deployments in this window" })).toBeVisible();
  await expect(page.getByText("v2.14.0")).toBeVisible();

  const alertsNavLink = page.getByRole("link", { name: "Alerts" });
  await tabTo(page, alertsNavLink);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/alerts");

  const alertRowLink = page.getByRole("table").getByRole("row").filter({ hasText: "Payments API" }).getByRole("link", { name: "Payments API" });
  await tabTo(page, alertRowLink);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/alerts\/.+/);
  await expect(page.getByRole("heading", { name: "error_rate_pct" })).toBeVisible();
  await expect(page.getByText("Firing")).toBeVisible();
  await expect(page.getByText("gt 5 for 180s")).toBeVisible();
});
