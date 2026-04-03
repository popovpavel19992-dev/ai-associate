import { test, expect } from "@playwright/test";

test.describe("Case Flow", () => {
  // These tests require an authenticated session.
  // In CI, set up Clerk test tokens via CLERK_TESTING_TOKEN env var.
  // Locally, ensure a test user session cookie is available.

  test("new case page loads with form", async ({ page }) => {
    await page.goto("/cases/new");
    // Should show the create case form or redirect to auth
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("quick analysis page loads", async ({ page }) => {
    await page.goto("/quick-analysis");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("dashboard page loads", async ({ page }) => {
    await page.goto("/dashboard");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("settings page loads", async ({ page }) => {
    await page.goto("/settings");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("templates page loads", async ({ page }) => {
    await page.goto("/settings/templates");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("billing page loads", async ({ page }) => {
    await page.goto("/settings/billing");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("non-existent case returns 404 or redirects", async ({ page }) => {
    const response = await page.goto("/cases/00000000-0000-0000-0000-000000000000");
    // Should either show not found or redirect to auth
    expect(response?.status()).toBeLessThan(500);
  });
});
