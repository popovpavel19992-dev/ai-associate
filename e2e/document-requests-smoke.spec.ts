// e2e/document-requests-smoke.spec.ts
//
// Smoke tests for document requests functionality (Phase 2.3.2).
// Mirrors e2e/case-messages.spec.ts convention: no Clerk bypass; status<500
// + body-visible. Interactive flows (create/fulfill/status updates) covered by manual UAT.

import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

test.describe("Document requests — smoke tests", () => {
  test("/cases/[id]?tab=requests returns <500 for unknown case (auth-gated)", async ({ page }) => {
    const res = await page.goto(`/cases/${FAKE_UUID}?tab=requests`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("/portal/cases/[id] returns <500 for unknown case (includes DocumentRequestsSection)", async ({ page }) => {
    const res = await page.goto(`/portal/cases/${FAKE_UUID}`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
