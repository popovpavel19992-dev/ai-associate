import { test, expect } from "@playwright/test";

const FAKE = "00000000-0000-0000-0000-000000000001";

test.describe("2.4.4 E-Filing Submission Tracking smoke", () => {
  test("firm-level filings page reachable", async ({ request }) => {
    const res = await request.get(`/filings`);
    expect(res.status()).toBeLessThan(500);
  });

  test("case detail with filings tab reachable", async ({ request }) => {
    const res = await request.get(`/cases/${FAKE}?tab=filings`);
    expect(res.status()).toBeLessThan(500);
  });

  test("case detail with filings tab + highlight reachable", async ({ request }) => {
    const res = await request.get(`/cases/${FAKE}?tab=filings&highlight=${FAKE}`);
    expect(res.status()).toBeLessThan(500);
  });
});
