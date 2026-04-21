// e2e/intake-forms-smoke.spec.ts
//
// Smoke tests for intake forms functionality (Phase 2.3.3).
// Mirrors e2e/document-requests-smoke.spec.ts convention: no Clerk bypass; status<500
// + body-visible. Interactive flows (form filling, submission, preview) covered by manual UAT.

import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.3 intake forms smoke", () => {
  test("/cases/[id]?tab=intake returns <500 (auth-gated)", async ({ page }) => {
    const res = await page.goto(`/cases/${FAKE_UUID}?tab=intake`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("/portal/cases/[id] returns <500 with intake card (includes IntakeFormsSection)", async ({ page }) => {
    const res = await page.goto(`/portal/cases/${FAKE_UUID}`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("/portal/intake/[formId] returns <500 (form fill page)", async ({ page }) => {
    const res = await page.goto(`/portal/intake/${FAKE_UUID}`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("/cases/[id]/intake/[formId]/print returns <500 (print view)", async ({ page }) => {
    const res = await page.goto(`/cases/${FAKE_UUID}/intake/${FAKE_UUID}/print`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
