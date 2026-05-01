# 4.4 Brief Cite-Check — Design

**Status:** Design approved 2026-05-01. Ready for implementation plan.
**Builds on:** 4.2 Strategy Assistant (PR #66) for beta gate + RAG pattern, 4.3 Motion Drafter (PR #67) for `MotionDetail` page integration, Phase 2.2 research (CourtListener cache).
**Beta gate:** Reuses `STRATEGY_BETA_ORG_IDS`.

## Goal

A lawyer reviewing a generated motion clicks **"Cite-check"** in `MotionDetail`. The system extracts every legal citation from the motion, resolves it against the cached opinion / statute corpus (or fetches from CourtListener if missing), determines whether it's still good law via a Claude treatment pass, and renders the results inline with severity badges (✅ good law / ⚠ caution / 🚫 overruled / ❓ pending / ❌ not found / 🔧 malformed). The result is cached on the motion and re-rendered on revisit.

## Non-goals (v1)

- Jurisdiction-weighted treatment (2nd Cir not bound by 9th Cir overruling)
- Bluebook format auto-correction (we flag, we don't fix)
- Inline edit of cite from `CiteCheckPanel`
- Statute treatment richer than "in current code / repealed"
- Cite-checking research memos, drip emails, or any non-motion text
- Multi-language Bluebook (English only)

## User flow

1. Lawyer opens `/cases/[id]/motions/[motionId]` (existing 4.3 `MotionDetail`).
2. Below the section editor, sees **"Cite-check"** button. Tooltip: "Verify all citations are still good law (~1 credit per new citation)."
3. Click → backend runs:
   - Claude extracts citations from concatenated section text (1 credit upfront)
   - For each cite: cache lookup → cached treatment → fresh treatment → async fetch fallback
   - Persist `lastCiteCheckJson` on the motion
4. UI renders `CiteCheckPanel` with each cite, status badge, summary tooltip, deeplink to opinion if cached.
5. If `pendingCites > 0`, panel shows "X pending — refreshing…" and polls every 5s until all resolved or 2 min timeout.
6. Re-open motion later → `motionCiteCheck.get` returns cached `lastCiteCheckJson`. If `motion.updatedAt > runAt`, banner offers "Run again?".

## Decisions (recorded)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Treatment depth | Heuristic via Claude + structural sanity pre-pass | Real value-add; CourtListener doesn't expose Shepard's-style data |
| 2 | Source of cited text | `case_motions.sections` only | Tight integration with 4.3; standalone page deferred |
| 3 | Result storage | `case_motions.last_cite_check_json` (single column, no history) | Sufficient for v1; lawyer typically checks once before filing |
| 4 | Cite types | Opinions + statutes (CFR included via `cached_statutes`) | Statutes critical for MTD-style motions |
| 5 | Cache miss handling | Hybrid sync + async (Inngest fetches uncached, polling refresh) | Best UX without blocking UI |
| 6 | Pricing | Pay-per-NEW-cite + 7-day treatment cache, plus 1cr extract | Reflects compute; classics like Twombly / Iqbal stay free |
| 7 | Citation extraction | Claude-based | Higher recall than regex on parallel/short forms |

## Architecture

### New backend service (`src/server/services/cite-check/`)

- **`extract.ts`** — Claude call: "find all legal citations in this text, return strict JSON `[{raw, type: 'opinion'|'statute'}]`". Strips ```json fences. Validates result shape. Returns empty array if no cites found (no error).
- **`normalize.ts`** — pure: `citeKey(raw, type)`. Lowercases + strips punctuation/spaces, drops case name, keeps volume + reporter + page + year. `Smith v. Jones, 550 U.S. 544 (2007)` → `550_us_544_2007`. Statutes: `28 U.S.C. § 1331` → `28_usc_1331`.
- **`resolve.ts`** — for each `{raw, type, citeKey}`:
  1. Lookup `cite_treatments WHERE cite_key = ? AND expires_at > now()`. Hit → return cached treatment.
  2. Else, lookup in `cached_opinions` / `cached_statutes` by citation string match. Hit → run treatment + persist + charge 1cr.
  3. Else: emit `cite-check/resolve.requested` Inngest event, return `{status: "pending"}`.
- **`treatment.ts`** — Claude call with cite full_text + `metadata.citedByCount` + a short list of opinions citing TO this one (drawn from `metadata.citesTo` reverse-index): "is this still good law? return strict JSON `{status, summary, signals}`". Falls back to `unverified` on parse error (no charge).
- **`orchestrator.ts`** — full flow: load motion → extract → resolve loop → persist `last_cite_check_json` → return. Implements concurrent-run dedup (existing run within 60s + pendingCites > 0 → return existing instead of starting new).

### New tRPC router (`src/server/trpc/routers/motion-cite-check.ts`)

- `motionCiteCheck.run` mutation: `{motionId} → CiteCheckResult`. Charges credits, gates on `STRATEGY_BETA_ORG_IDS`. Pre-check uses prior run's cite count + 1 extract (or a flat `5cr` minimum if no prior run) — purely advisory `PAYMENT_REQUIRED` if balance below estimate; the real meter is per-cite mid-flight. If credit budget exhausts during the per-cite loop, stop charging, mark remaining cites as `unverified` with summary `"Credit budget exhausted — re-run after topping up"`, persist partial result. Don't refund, don't fail outright.
- `motionCiteCheck.get` query: `{motionId} → CiteCheckResult | null`. Returns `lastCiteCheckJson`. UI polls this when `pendingCites > 0`.

### New Inngest function

- `cite-check/resolve.requested` — `{citeKey, raw, type, motionId}`. Steps:
  1. Query CourtListener for `raw` (reuse existing research search client). If found → upsert `cached_opinions`. Not found → mark cite `not_found`.
  2. If found → run `treatment.ts` → upsert `cite_treatments`.
  3. Re-load motion's `lastCiteCheckJson`, swap the cite's status from `pending` → resolved status, persist (transactional read-modify-write).
- Charge deferred: 1 credit per cite that successfully resolved (not for `not_found`).

### Schema delta (migration `0057_cite_check.sql`)

```sql
ALTER TABLE case_motions
  ADD COLUMN last_cite_check_json jsonb;

CREATE TABLE cite_treatments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cite_key text NOT NULL,
  cite_type text NOT NULL CHECK (cite_type IN ('opinion','statute')),
  status text NOT NULL CHECK (status IN ('good_law','caution','overruled','unverified','not_found','malformed')),
  summary text,
  signals jsonb,
  generated_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX cite_treatments_key_idx ON cite_treatments (cite_key);
CREATE INDEX cite_treatments_expires_idx ON cite_treatments (expires_at);
```

`last_cite_check_json` shape (TS interface, `CiteCheckResult` exported from service):

```ts
interface CiteCheckCitation {
  raw: string;
  citeKey: string;
  type: "opinion" | "statute";
  status: "good_law" | "caution" | "overruled" | "unverified" | "not_found" | "pending" | "malformed";
  summary: string | null;
  signals: {
    citedByCount?: number;
    treatmentNotes?: string[];
    cachedOpinionId?: string;
  } | null;
  location: { sectionKey: "facts" | "argument" | "conclusion"; offset: number };
}

interface CiteCheckResult {
  runAt: string;            // ISO
  totalCites: number;
  pendingCites: number;
  citations: CiteCheckCitation[];
  creditsCharged: number;
}
```

### UI

- **`CiteCheckPanel`** (new component, `src/components/cases/motions/cite-check-panel.tsx`):
  - Header: "Citation check" + run button + `runAt` timestamp + "Run again" if motion edited since.
  - Body: list of cites grouped by section. Each row: severity icon, raw cite text (clickable → deeplink to `/research/opinions/[id]` if cached), summary tooltip, signals badge (e.g. "cited 1,283 times").
  - Footer: credit breakdown ("23 cites checked, 5 new × 1cr + 1cr extract = 6cr").
  - Polls `motionCiteCheck.get` every 5s while `pendingCites > 0`, max 2 min.
- **`MotionDetail`** mod (existing component): add `<CiteCheckPanel motionId={motion.id} />` below section editor when motion has `sections.facts` filled (otherwise hidden — nothing to check yet).

## Data flow

```
[User clicks Cite-check]
   └→ trpc.motionCiteCheck.run.mutate({ motionId })
        ├→ load motion + concat sections → combinedText
        ├→ assertCaseAccess + assertEnabled
        ├→ dedup check: if existing pending run < 60s old, return existing
        ├→ pre-check credits (estimate)
        ├→ extractCitations(combinedText) [Claude call, charge 1cr]
        ├→ for each cite: resolveCite(cite)
        │   ├ treatment cache hit → use it (0cr)
        │   ├ cached opinion/statute hit → treatment.ts + cache write (1cr)
        │   └ both miss → emit inngest event, mark pending
        ├→ persist last_cite_check_json
        └→ return CiteCheckResult

[Inngest cite-check/resolve.requested per uncached cite]
   ├→ CourtListener fetch
   │   ├ found → upsert cached_opinions → treatment → cite_treatments + charge 1cr
   │   └ not found → mark not_found in motion json (no charge)
   └→ rewrite motion.last_cite_check_json with new status

[UI MotionDetail]
   └→ CiteCheckPanel uses motionCiteCheck.get.useQuery
        ├ refetchInterval=5000 if pendingCites>0
        └ stops polling at 2 min
```

## Error handling

| Failure | Response |
|---|---|
| Extract returns empty array | Persist `totalCites:0`, charge 1cr extract. UI: "No citations found." |
| Extract malformed JSON | Refund 1cr, throw `TRPCError INTERNAL`. UI toast. |
| CourtListener API error in async job | Inngest retries=2. Final fail → mark cite `not_found`. No charge. |
| Treatment Claude error post-resolution | Mark cite `unverified` + `summary: "Treatment unavailable"`. Charge 0cr (we got data, couldn't analyze). |
| Insufficient credits before run | Pre-check estimate > balance → `PAYMENT_REQUIRED` BEFORE extract call. |
| Credits exhaust mid-run | Stop charging, mark remaining cites `unverified` with budget-exhausted summary, persist partial result. No refund, no throw. |
| Motion edited post-check | `runAt < motion.updatedAt` → UI banner "Run again?" |
| Concurrent runs on same motion | Dedup: `pendingCites > 0 AND runAt < 60s ago` → return existing |
| Motion deleted mid-async | drizzle update affects 0 rows → log warn, exit |
| Cite key collision (extreme) | Mitigation: include year in key (`550_us_544_2007`) |

## Permissions & quotas

- `motionCiteCheck.run/get`: `protectedProcedure`, `assertCaseAccess(ctx, motion.caseId)`, `assertEnabled(ctx.user.orgId)`.
- No separate beta flag — gated by `STRATEGY_BETA_ORG_IDS`.
- No rate limit beyond credits + dedup.

## Testing plan

- `tests/unit/cite-check-extract.test.ts` — Claude mock: happy path, malformed → throws, empty text → empty array.
- `tests/unit/cite-check-normalize.test.ts` — pure: opinion key generation; statute key generation; year inclusion; case-insensitive.
- `tests/unit/cite-check-resolve.test.ts` — DB mocks: treatment-cache hit; cached-opinion hit; cached-statute hit; both miss → Inngest emit.
- `tests/unit/cite-check-treatment.test.ts` — Claude mock: parses status + summary, clamps to enum, falls back to `unverified`.
- `tests/unit/cite-check-orchestrator.test.ts` — full mock: mix paths → correct totals; insufficient credits throws before extract; dedup returns existing; persists `lastCiteCheckJson` correctly.
- `tests/unit/cite-check-inngest.test.ts` — async job: CourtListener mock; updates motion json transactionally; charges only on resolved.
- `e2e/cite-check-smoke.spec.ts` — `/cases/[id]/motions/[id]` returns < 500 with cite-check bundle present.

## File inventory

```
src/server/db/migrations/0057_cite_check.sql
src/server/db/schema/case-motions.ts (modified — add 1 col)
src/server/db/schema/cite-treatments.ts (new)
src/server/services/cite-check/{extract,normalize,resolve,treatment,orchestrator,types}.ts (new)
src/server/inngest/functions/cite-check-resolve.ts (new, registered in inngest/index.ts)
src/server/trpc/routers/motion-cite-check.ts (new)
src/server/trpc/root.ts (modified — register motionCiteCheck)
src/components/cases/motions/cite-check-panel.tsx (new)
src/components/cases/motions/motion-detail.tsx (modified — render panel)
tests/unit/cite-check-{extract,normalize,resolve,treatment,orchestrator,inngest}.test.ts
e2e/cite-check-smoke.spec.ts
```

## Out of scope (deferred)

1. Jurisdiction-weighted treatment (2nd Cir not bound by 9th Cir overruling)
2. Bluebook format auto-correction (we flag, don't fix)
3. Inline edit of cite from `CiteCheckPanel`
4. Statutes treatment richer than "in current code / repealed"
5. Cite-checking memos / drip emails / non-motion text
6. Multi-language Bluebook (English only)
7. Per-cite re-check button (entire motion only in v1)
