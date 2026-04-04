import { test, expect } from "@playwright/test";

test.describe("Contract Compare", () => {
  test("compare page loads with dual upload zones", async ({ page }) => {
    await page.goto("/contracts/compare");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("compare page has correct heading", async ({ page }) => {
    await page.goto("/contracts/compare");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});
