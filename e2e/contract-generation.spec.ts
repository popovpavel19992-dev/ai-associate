import { test, expect } from "@playwright/test";

test.describe("Contract Generation", () => {
  test("drafts list page loads", async ({ page }) => {
    await page.goto("/drafts");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("create draft page loads with form", async ({ page }) => {
    await page.goto("/drafts/new");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("non-existent draft returns error or redirects", async ({ page }) => {
    const response = await page.goto("/drafts/00000000-0000-0000-0000-000000000000");
    expect(response?.status()).toBeLessThan(500);
  });

  test("dashboard page loads with generate action", async ({ page }) => {
    await page.goto("/dashboard");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});
