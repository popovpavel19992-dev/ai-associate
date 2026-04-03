import { test, expect } from "@playwright/test";

test.describe("Billing", () => {
  test("billing page is accessible", async ({ page }) => {
    await page.goto("/settings/billing");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("billing page does not error (no 500)", async ({ page }) => {
    const response = await page.goto("/settings/billing");
    expect(response?.status()).toBeLessThan(500);
  });
});
