// e2e/research.spec.ts
//
// Smoke tests for the /research feature (Phase 2.2.1).
// Unauthenticated visits will redirect to Clerk sign-in — we only assert
// that routes don't 500 and that the page body renders (redirect or real content).
// Interactive flows (search → chat → bookmark) require Clerk test tokens +
// seeded CourtListener data; covered by manual UAT per spec §15.

import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

test.describe("Research — smoke tests", () => {
  test("/research hub loads without 500", async ({ page }) => {
    const res = await page.goto("/research");
    expect(res?.status()).toBeLessThan(500);
  });

  test("/research body visible", async ({ page }) => {
    await page.goto("/research");
    await expect(page.locator("body")).toBeVisible();
  });

  test("/research/bookmarks loads without 500", async ({ page }) => {
    const res = await page.goto("/research/bookmarks");
    expect(res?.status()).toBeLessThan(500);
  });

  test("/research/opinions/<uuid> loads without 500", async ({ page }) => {
    const res = await page.goto(`/research/opinions/${FAKE_UUID}`);
    expect(res?.status()).toBeLessThan(500);
  });

  test("/research/sessions/<uuid> loads without 500", async ({ page }) => {
    const res = await page.goto(`/research/sessions/${FAKE_UUID}`);
    expect(res?.status()).toBeLessThan(500);
  });

  test("/research/opinions with sessionId query param does not crash", async ({ page }) => {
    const res = await page.goto(
      `/research/opinions/${FAKE_UUID}?sessionId=${FAKE_UUID}`,
    );
    expect(res?.status()).toBeLessThan(500);
  });

  test("/cases/<uuid> direct-id route loads without 500", async ({ page }) => {
    const res = await page.goto(`/cases/${FAKE_UUID}`);
    expect(res?.status()).toBeLessThan(500);
  });
});
