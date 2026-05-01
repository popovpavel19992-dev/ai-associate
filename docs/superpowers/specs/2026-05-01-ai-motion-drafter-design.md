# 4.3 AI Motion Drafter — Strategy → Motion bridge

**Status:** Design approved 2026-05-01. Ready for implementation plan.
**Builds on:** 2.4.2 Motion Generator (PR #22), 4.2 Strategy Assistant (PR #66).
**Beta gate:** Reuses `STRATEGY_BETA_ORG_IDS` (single flag for the whole Strategy → Motion flow).

## Goal

Let a lawyer reviewing AI strategy recommendations on `/cases/[id]?tab=strategy` click **"Draft this motion"** on a recommendation card, see a preview of which template + sources will be used, confirm, and land in the existing motion editor with the draft context pre-loaded. Reuses the 2.4.2 motion wizard for everything past confirm — no new editor, no parallel flow.

## Non-goals (v1)

- Streaming preview (one-shot wait is fine)
- Re-classify when user edits rec title
- Per-section citation chips in generated motion text
- Multi-rec batch ("draft all 3 procedural motions")
- Free flow (the 4.3 entry point charges 5 credits; the manual 2.4.2 wizard remains free)

## User flow

1. Lawyer opens `/cases/[id]?tab=strategy`, sees recommendations.
2. On a `procedural` / `discovery` / `substantive` rec, clicks **"Draft this motion"** (button hidden on `client` category — no template fits).
3. Backend runs `motionDrafter.suggest`:
   - Classify rec → template via Claude
   - Bundle auto-pulled sources (cited entities + Voyage RAG top-K)
   - Charge 5 credits (with refund on failure)
4. UI navigates to `/cases/[id]/motions/new?fromRec=<recommendationId>`.
5. Wizard opens at **new step 0** (`MotionDrafterPreview`), showing suggested template + confidence badge + sources list. Two buttons: **Confirm & continue** / **Customize**.
6. After confirm/customize, lawyer flows through the existing 2.4.2 wizard (step 1: template, step 2: memos + collections), `motions.create` persists the row with `drafter_context_json` populated.
7. Lawyer drafts each section via existing `motions.generateSection`. The draft service injects auto-pulled excerpts into the section prompt when `drafter_context_json` is present.

## Decisions (recorded)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Entry mode | Strategy → Motion bridge | Reuses 4.2 RAG infra; one-click feel without losing manual flow |
| 2 | Auto-pick UX | Hybrid preview (Section 1.C) | Auto-template, but lawyer confirms before generation |
| 3 | Template classifier | Claude classifier | Robust to paraphrase; only 3 templates today, low input cost |
| 4 | RAG scope | Augment | Auto-pulls case docs in addition to lawyer-picked memos/collections |
| 5 | Preview UX | Pre-filled wizard step 0 | Reuses existing wizard; lawyer can override template/sources in step 1 |
| 6 | Confidence threshold | Gate at 0.7 | If lower, open wizard with no template selected + banner |
| 7 | Credit cost | 5 credits per `suggest` | Charged once for classifier + RAG; section drafts remain free |

## Architecture

### New backend modules (`src/server/services/motion-drafter/`)

- **`classify.ts`** — pure-ish function: `classifyTemplate(rec, templates) → { templateId | null, confidence, reasoning }`. Calls Claude with system prompt listing template id+slug+name+description; expects JSON `{ template_id, confidence: 0..1, reasoning }`. Validates `template_id ∈ templates`. Returns `null` template if hallucinated.
- **`sources.ts`** — `bundleSources(caseId, rec) → { citedEntities, autoPulledChunks }`. Resolves cited entity ids from `rec.citations` against live tables (drops stale ids). Embeds rec title+rationale via `embedTexts(..., "query")` and runs pgvector top-8 against `document_embeddings` for the case (CTE form, same as 4.2 collect.ts).
- **`orchestrator.ts`** — `suggestMotion({ recommendationId, userId, ctx }) → { template | null, confidence, suggestedTitle, citedEntities, autoPulledChunks, suggestedFromCache: boolean }`. Sequence:
  1. Load rec + parent run (ensure org access via `assertCaseAccess`).
  2. If `rec.suggest_confidence IS NOT NULL` → already classified before (template may be null on low-confidence) → skip classify + skip credit charge (set `suggestedFromCache=true`).
  3. Else: load org templates (`motion_templates` where `org_id IS NULL OR org_id = ctx.user.orgId`), call `classifyTemplate`, persist `suggested_template_id` (may be null) + `suggest_confidence` on the rec, charge 5 credits.
  4. Always: bundle sources (RAG is fresh — digest may have changed even on rec cache hit).
  5. Build `suggestedTitle` from template name + key entity ("Motion to Dismiss — Smith v Acme").
  6. Return bundle. UI calls `motions.create` separately when user confirms.

### New tRPC router

- **`motionDrafter.suggest`** (mutation, charges 5 credits inside the orchestrator with try/catch refund). Input: `{ recommendationId: uuid }`. Output: `{ template: { id, slug, name } | null, confidence: number, suggestedTitle: string, citedEntities: Citation[], autoPulledChunks: DocChunk[], suggestedFromCache: boolean }`.
- Registered in `appRouter` as `motionDrafter` next to `caseStrategy`.
- Beta gate: same `assertEnabled(orgId)` from 4.2 (`isStrategyEnabled`).

### Schema delta (migration `0056_motion_drafter.sql`)

```sql
ALTER TABLE case_strategy_recommendations
  ADD COLUMN suggested_template_id uuid REFERENCES motion_templates(id) ON DELETE SET NULL,
  ADD COLUMN suggest_confidence numeric(3,2);

ALTER TABLE case_motions
  ADD COLUMN drafter_context_json jsonb,
  ADD COLUMN drafted_from_recommendation_id uuid REFERENCES case_strategy_recommendations(id) ON DELETE SET NULL;
```

`drafter_context_json` shape: `{ chunks: DocChunk[], citedEntities: Citation[], fromRecommendationId: string, generatedAt: ISOString }`. Read once by `draftMotionSection` per section call; not mutated after `motions.create`.

### Existing modules touched

- **`src/server/services/motions/draft.ts`** — `draftMotionSection`: if loaded `case_motions` row has `drafter_context_json`, prepend a `## Relevant case excerpts` block to the user prompt (above existing memo content). Top-3 chunks by similarity (not all 8) to keep prompt budget reasonable.
- **`motions.create` tRPC** — new optional input `drafterContextJson?: any`; persists into the new column. Validated against a Zod schema mirroring the runtime shape.
- **`motion-wizard.tsx`** — adds `step: 0 | 1 | 2`, where step 0 renders `MotionDrafterPreview` only when `searchParams.has("fromRec")`. Existing step 1/2 unchanged.
- **`recommendation-card.tsx`** — adds `Draft this motion` button when `category !== "client"`. Click calls `motionDrafter.suggest`, then `router.push(/cases/${caseId}/motions/new?fromRec=${rec.id})`.

## Data flow

```
[RecCard click]
   └→ trpc.motionDrafter.suggest.mutate({ recommendationId })
        ├→ load rec + run + assertCaseAccess + assertEnabled
        ├→ if rec.suggested_template_id: skip classify, skip charge
        │  else: classify (Claude) + persist + charge 5cr
        ├→ bundleSources: cited entities + Voyage RAG top-8
        └→ return { template, confidence, sources, suggestedTitle }

[UI receives result]
   └→ router.push("/cases/[id]/motions/new?fromRec=<recId>")

[motion-wizard step 0]
   └→ trpc.motionDrafter.suggest.mutate(...) re-runs (cache hit, free, fresh RAG)
   └→ user clicks Confirm or Customize
        └→ step 1 → step 2 → motions.create({ ..., drafterContextJson })

[motions.generateSection per section]
   └→ draftMotionSection reads drafter_context_json from row
   └→ injects top-3 chunks as "## Relevant case excerpts" before memo content
```

## Error handling

| Failure | Response |
|---|---|
| Classifier returns invalid template_id | Treat as `confidence: 0`, refund credits, return `template: null`. UI opens wizard at step 1 with banner. |
| `confidence < 0.7` | Return `template: null`. Persist `suggest_confidence` (and `suggested_template_id = null`) so a re-click is free. UI opens wizard at step 1 with banner "AI couldn't confidently match a template". Credits charged once for the classifier call. |
| Empty case (no docs / no entities) | `autoPulledChunks` and `citedEntities` are empty arrays. Preview shows "No automated sources — proceed with manual selection". Continues. |
| Repeat click on same rec | Cache hit on `suggested_template_id`, no charge. RAG re-runs (fresh case state). |
| Insufficient credits | `TRPCError PAYMENT_REQUIRED`; UI toast. |
| Voyage / Claude transient error | Throws inside orchestrator try/catch → `refundCredits` → re-throw. UI toast. |
| Template deleted between suggest and create | `motions.create` standard FK error path. Credits already paid; not refunded. (Edge case, acceptable.) |
| `client`-category rec | Button hidden in `RecommendationCard` UI. No backend guard needed (defence in depth: orchestrator returns `template: null, confidence: 0` if rec category is `client`, no charge — rare path). |

## Permissions & quotas

- `motionDrafter.suggest`: `protectedProcedure`, `assertCaseAccess(ctx, rec.caseId)`, `assertEnabled(ctx.user.orgId)`.
- No separate beta flag — gated by `STRATEGY_BETA_ORG_IDS` (the whole Strategy → Motion arc is one beta surface).
- No separate rate limit beyond credit budget (suggest is idempotent on cache hit anyway).

## Testing plan

- `tests/unit/motion-drafter-classify.test.ts` — Anthropic mock: happy path picks valid template; hallucinated id → null; malformed JSON → throws.
- `tests/unit/motion-drafter-sources.test.ts` — Voyage + db mocks: cited entities resolved + dropped if stale; RAG returns top-8 in similarity order.
- `tests/unit/motion-drafter-orchestrator.test.ts` — full pipeline mock: success / cache hit (no charge) / classifier-fail (refund) / low-confidence (no template, charge holds).
- `tests/unit/motion-drafter-prompt.test.ts` — `draftMotionSection` correctly prepends `## Relevant case excerpts` block when `drafter_context_json` present; unchanged behaviour when absent.
- `e2e/motion-drafter-smoke.spec.ts` — case page strategy tab returns < 500; motion wizard with `?fromRec=` query renders without 500.

## File inventory (new this phase)

```
src/server/db/migrations/0056_motion_drafter.sql
src/server/services/motion-drafter/{classify,sources,orchestrator}.ts
src/server/trpc/routers/motion-drafter.ts
src/server/db/schema/case-strategy-recommendations.ts (modified — 2 cols)
src/server/db/schema/case-motions.ts (modified — 2 cols)
src/server/services/motions/draft.ts (modified — context injection)
src/server/trpc/routers/motions.ts (modified — drafterContextJson on create)
src/server/trpc/root.ts (modified — register motionDrafter)
src/components/cases/strategy/recommendation-card.tsx (modified — Draft button)
src/components/cases/motions/motion-wizard.tsx (modified — step 0)
src/components/cases/motions/motion-drafter-preview.tsx (new)
tests/unit/motion-drafter-{classify,sources,orchestrator,prompt}.test.ts
e2e/motion-drafter-smoke.spec.ts
```

## Out of scope (deferred)

1. **Streaming preview** — one-shot wait OK at 5cr / ~3s
2. **Re-classify on rec edit** — recs are immutable post-generation in 4.2
3. **Auto-citation chips inside motion text** — separate feature
4. **Multi-rec batch drafting** — credit risk, ship single-rec first
5. **Custom template authoring UI** — table supports `org_id` already; admin UI is separate work
6. **Auto-attach generated motion as exhibit to a filing package** — separate feature
