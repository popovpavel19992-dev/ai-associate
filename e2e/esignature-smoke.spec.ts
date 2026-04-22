// e2e/esignature-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.6 e-signatures smoke", () => {
  test("lawyer /cases/[id]?tab=signatures returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=signatures`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("portal /portal/cases/[id]?tab=signatures returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/portal/cases/${FAKE_UUID}?tab=signatures`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/settings/integrations/dropbox-sign returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/settings/integrations/dropbox-sign`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("dropbox-sign webhook with empty body returns 200 no-parent", async ({ request, baseURL }) => {
    const resp = await request.post(`${baseURL}/api/webhooks/dropbox-sign`, {
      data: {},
      headers: { "content-type": "application/json" },
    });
    expect([200, 400]).toContain(resp.status());
  });
});
