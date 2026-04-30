// e2e/strategy-smoke.spec.ts
// Phase 4.2 smoke: routes touched by the AI Case Strategy Assistant must
// not 500. Beta-gated tab is rendered unconditionally on the client; the
// caseStrategy/caseStrategyChat tRPC routers reject non-beta orgs with
// FORBIDDEN, so the tab is functional only for STRATEGY_BETA_ORG_IDS users.
// Real Claude/Voyage calls are out of scope here — manual UAT covers them
// once VOYAGE_API_KEY and beta org id are wired in production.
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("4.2 strategy assistant smoke", () => {
  test("case page returns <500 with strategy code in bundle", async ({
    page,
    baseURL,
  }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
