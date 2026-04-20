// e2e/milestones-smoke.spec.ts
//
// Smoke tests for status timeline & milestones functionality (Phase 2.3.4).
// Mirrors e2e/intake-forms-smoke.spec.ts convention: no Clerk bypass; status<500
// + body-visible. Interactive flows (milestone creation, retraction, editing) covered by manual UAT.

import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.4 milestones smoke", () => {
  test("/cases/[id]?tab=updates returns <500 (lawyer Updates tab)", async ({ page }) => {
    const res = await page.goto(`/cases/${FAKE_UUID}?tab=updates`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("/portal/cases/[id] returns <500 with timeline (portal CaseUpdatesTimeline)", async ({ page }) => {
    const res = await page.goto(`/portal/cases/${FAKE_UUID}`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
