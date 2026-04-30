# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: calendar-twoway-sync-smoke.spec.ts >> 3.19 two-way calendar sync smoke >> OAuth connect routes do not 500 when unauthenticated
- Location: e2e/calendar-twoway-sync-smoke.spec.ts:21:7

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 500
Received:   500
```

# Page snapshot

```yaml
- generic [ref=e2]: Internal Server Error
```

# Test source

```ts
  1  | // e2e/calendar-twoway-sync-smoke.spec.ts
  2  | // Phase 3.19 smoke: routes touched by the two-way calendar sync feature must
  3  | // not throw 500. Real OAuth + provider calls are out of scope here — that's
  4  | // covered by manual UAT once Google/Microsoft creds are wired in production.
  5  | import { test, expect } from "@playwright/test";
  6  | 
  7  | test.describe("3.19 two-way calendar sync smoke", () => {
  8  |   test("/settings/integrations returns <500 (Conflicts section renders)", async ({
  9  |     page,
  10 |     baseURL,
  11 |   }) => {
  12 |     const resp = await page.goto(`${baseURL}/settings/integrations`);
  13 |     expect(resp?.status()).toBeLessThan(500);
  14 |   });
  15 | 
  16 |   test("/settings/calendar-sync returns <500", async ({ page, baseURL }) => {
  17 |     const resp = await page.goto(`${baseURL}/settings/calendar-sync`);
  18 |     expect(resp?.status()).toBeLessThan(500);
  19 |   });
  20 | 
  21 |   test("OAuth connect routes do not 500 when unauthenticated", async ({
  22 |     page,
  23 |     baseURL,
  24 |   }) => {
  25 |     // Unauthenticated should bounce to sign-in (302/401) — never 500.
  26 |     const google = await page.goto(`${baseURL}/api/auth/google/connect`, {
  27 |       waitUntil: "commit",
  28 |     });
> 29 |     expect(google?.status() ?? 0).toBeLessThan(500);
     |                                   ^ Error: expect(received).toBeLessThan(expected)
  30 | 
  31 |     const outlook = await page.goto(`${baseURL}/api/auth/outlook/connect`, {
  32 |       waitUntil: "commit",
  33 |     });
  34 |     expect(outlook?.status() ?? 0).toBeLessThan(500);
  35 |   });
  36 | });
  37 | 
```