// e2e/deadlines-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.4.1 deadlines smoke", () => {
  test("case tab returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=deadlines`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("settings/deadline-rules returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/settings/deadline-rules`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/calendar returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/calendar`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
