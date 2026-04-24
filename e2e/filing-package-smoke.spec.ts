// e2e/filing-package-smoke.spec.ts
//
// Route-level smoke test for 2.4.3 Filing Package Builder. Mirrors
// e2e/motion-generator-smoke.spec.ts (2.4.2): hit each package route
// with fake UUIDs and assert the server doesn't blow up (<500).
//
// Does not exercise auth or full wizard flow — richer UI coverage is
// deferred until an e2e auth fixture exists. Unit + router (mocked)
// coverage exercise the business logic.
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.4.3 filing package builder smoke", () => {
  test("package wizard route returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(
      `${baseURL}/cases/${FAKE_UUID}/motions/${FAKE_UUID}/package`,
    );
    expect(resp?.status()).toBeLessThan(500);
  });

  test("package preview API returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(
      `${baseURL}/api/packages/${FAKE_UUID}/preview`,
    );
    expect(resp?.status()).toBeLessThan(500);
  });

  test("package download API returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(
      `${baseURL}/api/packages/${FAKE_UUID}/download`,
    );
    expect(resp?.status()).toBeLessThan(500);
  });
});
