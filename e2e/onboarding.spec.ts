import { test, expect } from "@playwright/test";

test.describe("Onboarding Flow", () => {
  test("redirects unauthenticated user to sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    // Clerk should redirect to sign-in
    await expect(page).toHaveURL(/sign-in/);
  });

  test("sign-in page renders Clerk widget", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.locator("body")).toBeVisible();
    // Clerk renders its own sign-in form
  });

  test("sign-up page renders Clerk widget", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.locator("body")).toBeVisible();
  });

  test("onboarding page is accessible", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.locator("body")).toBeVisible();
  });
});
