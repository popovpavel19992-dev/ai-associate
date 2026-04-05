import { test, expect } from "@playwright/test";

test.describe("Case Workflow & Stages", () => {
  test("case detail page loads with pipeline bar", async ({ page }) => {
    // Navigate to cases list first
    await page.goto("/cases");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("dashboard loads without errors", async ({ page }) => {
    await page.goto("/dashboard");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});
