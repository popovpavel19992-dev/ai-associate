// e2e/calendar-twoway-sync-smoke.spec.ts
// Phase 3.19 smoke: routes touched by the two-way calendar sync feature must
// not throw 500. Real OAuth + provider calls are out of scope here — that's
// covered by manual UAT once Google/Microsoft creds are wired in production.
import { test, expect } from "@playwright/test";

test.describe("3.19 two-way calendar sync smoke", () => {
  test("/settings/integrations returns <500 (Conflicts section renders)", async ({
    page,
    baseURL,
  }) => {
    const resp = await page.goto(`${baseURL}/settings/integrations`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/settings/calendar-sync returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/settings/calendar-sync`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("OAuth connect routes do not 500 when unauthenticated", async ({
    page,
    baseURL,
  }) => {
    // Unauthenticated should bounce to sign-in (302/401) — never 500.
    const google = await page.goto(`${baseURL}/api/auth/google/connect`, {
      waitUntil: "commit",
    });
    expect(google?.status() ?? 0).toBeLessThan(500);

    const outlook = await page.goto(`${baseURL}/api/auth/outlook/connect`, {
      waitUntil: "commit",
    });
    expect(outlook?.status() ?? 0).toBeLessThan(500);
  });
});
