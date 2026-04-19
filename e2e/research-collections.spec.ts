// e2e/research-collections.spec.ts
//
// Smoke tests for /research/collections (Phase 2.2.4).
// Mirrors e2e/research.spec.ts convention: no Clerk bypass, status<500
// + body-visible checks. Interactive flows (create, share, tag) covered
// by manual UAT per spec §9.

import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

test.describe("Research collections — smoke tests", () => {
  test("/research/collections list page returns <500", async ({ page }) => {
    const res = await page.goto("/research/collections");
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("/research/collections/[collectionId] handles unknown id", async ({ page }) => {
    const res = await page.goto(`/research/collections/${FAKE_UUID}`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
