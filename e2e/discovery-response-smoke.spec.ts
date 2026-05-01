// Phase 4.5 smoke: discovery tab renders without 500 with the incoming
// drafter bundle present. Real flow (parse + draft + DOCX) is manual UAT.
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("4.5 discovery response drafter smoke", () => {
  test("case discovery tab returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=discovery`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
