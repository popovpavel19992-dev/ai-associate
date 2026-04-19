// e2e/research-memo.spec.ts
//
// Smoke tests for the /research/memos feature (Phase 2.2.3).
// Mirrors e2e/research.spec.ts convention: no Clerk bypass, status<500
// + body-visible checks. Interactive memo generation requires a valid
// ANTHROPIC_API_KEY + Inngest dev server; covered by manual UAT.

import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

test.describe("Research memos — smoke tests", () => {
  test("/research/memos list page returns <500", async ({ page }) => {
    const res = await page.goto("/research/memos");
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("/research/memos/[memoId] handles unknown id gracefully", async ({ page }) => {
    const res = await page.goto(`/research/memos/${FAKE_UUID}`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("export endpoint requires auth", async ({ request }) => {
    const res = await request.get(`/api/research/memos/${FAKE_UUID}/export?format=pdf`);
    expect([401, 404]).toContain(res.status());
  });
});
