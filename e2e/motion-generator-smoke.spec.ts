// e2e/motion-generator-smoke.spec.ts
//
// Route-level smoke test for 2.4.2 Motion Generator. Follows the same
// pattern as e2e/deadlines-smoke.spec.ts (2.4.1): hit each motion route
// with a fake UUID and assert the server doesn't blow up (<500).
//
// This does not exercise auth or full wizard flow — richer UI coverage
// is deferred until an e2e auth fixture exists. Unit + router (mocked)
// coverage exercise the business logic.
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.4.2 motion generator smoke", () => {
  test("motions tab on case detail returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=motions`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("new motion wizard route returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}/motions/new`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("motion detail route returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}/motions/${FAKE_UUID}`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("motion DOCX download route returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/api/motions/${FAKE_UUID}/docx`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
