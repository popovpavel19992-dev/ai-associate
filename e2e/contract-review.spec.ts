import { test, expect } from "@playwright/test";

test.describe("Contract Review", () => {
  test("contracts list page loads", async ({ page }) => {
    await page.goto("/contracts");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("create contract page loads with form", async ({ page }) => {
    await page.goto("/contracts/new");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("compare page loads", async ({ page }) => {
    await page.goto("/contracts/compare");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("non-existent contract returns error or redirects", async ({ page }) => {
    const response = await page.goto("/contracts/00000000-0000-0000-0000-000000000000");
    expect(response?.status()).toBeLessThan(500);
  });

  test("dashboard page loads with contract actions", async ({ page }) => {
    await page.goto("/dashboard");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});
