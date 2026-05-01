// Phase 4.3 smoke: routes touched by Motion Drafter must not 500.
// Auth + actual classifier flow are out of scope here — manual UAT covers them.
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("4.3 motion drafter smoke", () => {
  test("strategy tab still loads (Draft button is in bundle)", async ({
    page,
    baseURL,
  }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=strategy`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("motion wizard with ?fromRec= param does not 500", async ({
    page,
    baseURL,
  }) => {
    const resp = await page.goto(
      `${baseURL}/cases/${FAKE_UUID}/motions/new?fromRec=${FAKE_UUID}`,
    );
    expect(resp?.status()).toBeLessThan(500);
  });
});
