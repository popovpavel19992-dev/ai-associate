// e2e/case-messages.spec.ts
//
// Smoke tests for /cases/[id]?tab=messages (Phase 2.3.1).
// Mirrors e2e/research.spec.ts convention: no Clerk bypass; status<500
// + body-visible. Interactive flows (send/receive/SSE) covered by manual UAT.

import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

test.describe("Case messages — smoke tests", () => {
  test("/cases/[id]?tab=messages returns <500 for unknown case (auth-gated)", async ({ page }) => {
    const res = await page.goto(`/cases/${FAKE_UUID}?tab=messages`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
