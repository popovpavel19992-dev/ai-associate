// e2e/email-outreach-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.5 email outreach smoke", () => {
  test("/cases/[id]?tab=emails returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=emails`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/settings/email-templates returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/settings/email-templates`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
