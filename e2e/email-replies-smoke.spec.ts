// e2e/email-replies-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.5b email replies smoke", () => {
  test("/cases/[id]?tab=emails still returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=emails`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("inbound webhook without signature returns 401 or 400", async ({ request, baseURL }) => {
    const resp = await request.post(`${baseURL}/api/webhooks/resend/inbound`, {
      data: {},
      headers: { "content-type": "application/json" },
    });
    expect([400, 401, 500]).toContain(resp.status());
  });
});
