import { test, expect } from "@playwright/test";

const FAKE = "00000000-0000-0000-0000-000000000001";

test.describe("2.4.5 Service Tracking smoke", () => {
  test("standalone CoS route reachable", async ({ request }) => {
    const res = await request.get(`/api/filings/${FAKE}/cos`);
    expect(res.status()).toBeLessThan(500);
  });

  test("case detail filings tab still reachable", async ({ request }) => {
    const res = await request.get(`/cases/${FAKE}?tab=filings`);
    expect(res.status()).toBeLessThan(500);
  });
});
