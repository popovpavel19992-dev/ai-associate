// Phase 4.4 smoke: motion detail page renders without 500 with cite-check
// bundle present. Auth + actual classifier flow are out of scope; manual
// UAT covers them.
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("4.4 cite-check smoke", () => {
  test("motion detail page returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(
      `${baseURL}/cases/${FAKE_UUID}/motions/${FAKE_UUID}`,
    );
    expect(resp?.status()).toBeLessThan(500);
  });
});
