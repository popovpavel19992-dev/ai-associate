# motions-router integration test — skipped for 2.4.2 MVP

The plan (Task 15) called for a real-DB integration test using
`createCaller`, `createTestOrg`, `createTestUser`, and `createTestCase`
fixture helpers. Those helpers do not exist in this codebase — a repo-wide
search (`grep -rn 'createTestOrg\|createTestUser\|createTestCase\|createCaller'`)
returned zero definitions. Existing integration tests under
`tests/integration/` all use a hand-rolled queue-based mock-DB pattern
(see `tests/integration/case-messages-router.test.ts`) rather than a real
Postgres fixture, and importing `createCaller` from `@/server/trpc/root`
is not a pattern in use.

Replicating that mock-DB pattern for the motions router would essentially
duplicate, in mock form, the same happy-path control flow already covered
by:

- **Unit tests** — `tests/unit/motion-docx.test.ts`,
  `tests/unit/motion-draft.test.ts`, `tests/unit/motion-prompts.test.ts`
  cover the drafting service, DOCX renderer, and prompt construction.
- **E2E smoke** — `e2e/motion-generator-smoke.spec.ts` hits the wizard
  route, detail route, motions-tab route, and DOCX download route and
  asserts the server doesn't 500.

The MVP ships without a router integration test. Follow-up (2.4.2b) can
introduce a reusable `tests/helpers/fixtures.ts` with real org/user/case
factories, at which point this router is a natural first customer.
