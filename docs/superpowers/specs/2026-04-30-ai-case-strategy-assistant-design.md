# AI Case Strategy Assistant — Design

**Date:** 2026-04-30
**Phase:** Post-Phase-3 forward work, Module 1 of 4 prioritized in 2026-04-30 mega-session memo.
**Status:** Brainstormed and approved; pending implementation plan.

---

## Summary

Per-case AI surface that gives lawyers a structured assessment of "what to do next" on a matter, grounded in the case's own context (deadlines, filings, motions, discovery, depo prep, settlement state, recent client communications, and case documents). Hybrid format: a structured panel of categorized recommendations on first load, plus a follow-up chat for deeper questions. Recommendations cite specific case entities so the lawyer can verify each suggestion against source material in one click.

Beta-gated v1 to internal + 2–3 trusted firms. After 4–6 weeks of usage data, GA with prompt and behavior tuning informed by real dismissal patterns.

## Goals

1. Surface high-leverage strategic moves a lawyer might miss when buried in a busy matter.
2. Make every suggestion verifiable: each recommendation cites specific case-context items (documents, deadlines, filings, messages).
3. Be safe by default: AI disclaimers visible, beta-gated access, no automatic actions.
4. Stay within reasonable cost envelope per refresh; respect existing credits/billing.

## Non-goals (v1)

- Automatic actions (drafting motions, scheduling deadlines) from a recommendation.
- Self-improving prompts via dismissal feedback.
- Per-user private chat threads (collaborative shared thread only).
- Confidence scoring or two-pass validation.
- Re-embedding documents on every edit.
- Multilingual content.
- Event-driven proactive refresh.

These are deliberately out of scope; revisit after beta yields data.

---

## Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| Q1 | Format | Hybrid: proactive structured panel + chat follow-up | Strongest product value; chat backstops cases where the panel misses |
| Q2 | Inputs | RAG: structured digest + top-K relevant doc chunks | Quality on large cases; needed because docs are the substantive material |
| Q3 | Trigger | Lazy + manual refresh button | Honest signal of value (each refresh = explicit user demand); cheap |
| Q4 | Output structure | Structured with categories + citations | Categorization aids scanning; citations defeat hallucination class |
| Q5 | Storage | Persist runs and recommendations + minimal `dismissed_at` flag | Audit trail; allow per-rec hide without lifecycle complexity |
| Q6 | Embeddings provider | Voyage AI `voyage-law-2` | Legal-tuned, SOC2/HIPAA available, comparable quality to OpenAI |
| Q7 | Embedding lifecycle | Eager for strategically-relevant doc kinds, lazy otherwise (see `STRATEGIC_DOC_KINDS` constant) | Cuts ~50–70% of embed cost without latency impact on common path |
| Q8 | Cost guard | Existing credits + per-case 5-min rate limit | Reuses existing billing UX; rate limit prevents accidental refresh-spam |
| Q9 | Quality controls | Citation filter + disclaimer banner + beta gate | Defense-in-depth; cheap to ship; meaningful before any model self-review |
| Q10 | Chat scope | Persistent shared thread per case | Cases are collaborative spaces; private threads can come later |

---

## Architecture

```
/cases/[id]/strategy   (new tab)
  ├─ Recommendations panel  ──┐
  └─ Chat panel               │
                              │ tRPC
                              ▼
       caseStrategy router     caseStrategyChat router
              │                       │
              ▼                       ▼
       ┌─ src/server/services/case-strategy/ ────────────────────┐
       │  collect.ts   build digest + RAG chunks                 │
       │  generate.ts  Claude prompt → JSON output               │
       │  validate.ts  citation filter + sanitization            │
       │  persist.ts   write strategy_runs + recommendations     │
       │  embed.ts     Voyage law-2 → pgvector upsert            │
       │  chat.ts      message thread w/ strategy context        │
       └────────────────────────┬────────────────────────────────┘
                                ▼
              Inngest jobs:
                strategy/embed-document
                strategy/refresh.requested
```

Modules are isolated by responsibility. The strategy service knows nothing about UI; tRPC knows nothing about Voyage; chat is a sub-domain sharing only env config and the credits service.

### New tables (migration 0055)

- `document_embeddings` — `(document_id, chunk_index, content, embedding vector(1024), model_version)`. Indexed `ivfflat` on `embedding`.
- `case_strategy_runs` — one row per refresh attempt with status, input hash (idempotency dedup), token counts, credits charged, raw response, error message.
- `case_strategy_recommendations` — denormalized list per run with category, priority, title, rationale, jsonb citations, optional `dismissed_at`/`dismissed_by`.
- `case_strategy_chat_messages` — per-case thread with role, body, optional `references_run_id`, creator.

### Strategically-relevant document kinds

The eager-embed path applies only to `documents.kind` values likely to inform legal strategy:

```
STRATEGIC_DOC_KINDS = [
  "pleading",         "motion",          "discovery_request",
  "discovery_response","deposition_prep","deposition_transcript",
  "settlement_offer", "demand_letter",   "client_communication",
  "court_order",      "filing",          "research_memo",
  "expert_report",    "exhibit",
]
```

Anything outside this set (e.g., `intake_form`, `billing_attachment`, generic `upload`) is left unembedded; if a refresh later surfaces such a document via heuristics, it is embedded lazily on demand. The exact enum members will be reconciled with `documents.kind` during plan stage.

### New ENV

```
VOYAGE_API_KEY=
STRATEGY_BETA_ORG_IDS=                   # comma-separated UUIDs
STRATEGY_MODEL=claude-sonnet-4-6
STRATEGY_TOP_K_CHUNKS=12
```

### New deps

- `voyageai` SDK (or `@voyageai/sdk` — pick exact name in plan).
- `pgvector` extension enabled in Supabase (one-time, via migration `CREATE EXTENSION IF NOT EXISTS vector`).

---

## Data flow — refresh pipeline

1. **tRPC `caseStrategy.refresh({ caseId })`** runs synchronously to validate, then dispatches to Inngest:
   - `assertCaseAccess(ctx.user, caseId)` — throws `FORBIDDEN` if not authorized.
   - **Beta gate**: if `ctx.user.org.id` not in `STRATEGY_BETA_ORG_IDS` → `FORBIDDEN`.
   - **Rate limit**: query `case_strategy_runs` for last `succeeded` run within 5 minutes → `TOO_MANY_REQUESTS` if found.
   - **Credits check**: org has ≥ 10 credits → `INSUFFICIENT_CREDITS` if not. (Charged only on success.)
   - Insert `case_strategy_runs` row with `status='pending'`, return `runId` to UI.
   - `inngest.send({ name: "strategy/refresh.requested", data: { runId } })`.

2. **Inngest `strategy/refresh.requested`** runs the pipeline:
   - **collect**: aggregate the case digest (reusing existing aggregation helpers from `case-digest`/`client-comms`); query `document_embeddings` for top-K chunks via cosine similarity using a query embedding derived from digest summary + recent activity excerpt; for any strategically-relevant document missing from `document_embeddings`, lazy-embed before querying.
   - **generate**: compute `input_hash = sha256(canonical_json(context))`; check for prior `succeeded` run with the same hash within 24 hours — if hit, copy its `raw_response` and recommendations into the new run, mark credits charged 0, finish. Otherwise call Claude (Sonnet 4.6 by default) with prompt cache enabled on the static portion (system + cached digest + chunks); enforce JSON schema response.
   - **validate**: drop recommendations whose citation IDs do not appear in the collected context; trim string lengths (title ≤ 80, rationale ≤ 600); cap recommendations to 5 per category, 15 total.
   - **persist**: in a transaction, update the run row to `status='succeeded'` with token counts and `credits_charged=10`; insert recommendation rows; call `credits.deduct(orgId, 10)`. On any pipeline failure, set `status='failed'` with `error_message` and do not charge credits.

3. **UI** invalidates the React Query for `getLatest`; the panel re-renders with the new recommendations.

### Chat pipeline

1. `caseStrategyChat.send({ caseId, body })` validates access + beta gate, charges 1 credit on success, inserts the user message, builds context (latest succeeded run's recommendations + last 10 chat messages), streams Claude response via SSE, persists the assistant message at stream end.
2. `caseStrategyChat.listMessages({ caseId, limit })` returns the thread for display.

---

## UI

A new `/cases/[id]/strategy` route with the following layout:

- A persistent disclaimer banner ("AI-generated, verify before acting") at the top.
- Two-column body on desktop (60/40 recs/chat); stacked on mobile with a tab switcher.
- Recommendations panel: 4 category groups (Procedural, Discovery, Substantive, Client) with up to 5 cards each. Each card shows priority, title, rationale, citation chips, and a Dismiss button. A footer area shows the refresh button (with credit cost), last-refresh timestamp, and any rate-limit/insufficient-credits state.
- Chat panel: thread of user/assistant messages, input box (cmd+enter to send), per-message credit footnote.

Empty/loading/failure states are explicit:
- Never run: centered CTA to generate first run.
- Generating: skeleton + "Reviewing case context…".
- Failed: error card with retry button + run id for support.
- All recs dismissed: "No active recommendations. Refresh for new suggestions."
- Out of credits: disabled refresh + tooltip explaining upgrade/wait.
- Rate-limited: countdown until next allowed refresh.
- Beta gate fails: route returns `notFound()` (404), tab hidden in case nav.

### New components

| Component | Path |
|---|---|
| StrategyTab | `src/components/cases/strategy/strategy-tab.tsx` |
| RecommendationsPanel | `src/components/cases/strategy/recommendations-panel.tsx` |
| RecommendationCard | `src/components/cases/strategy/recommendation-card.tsx` |
| CitationChip | `src/components/cases/strategy/citation-chip.tsx` |
| StrategyChat | `src/components/cases/strategy/strategy-chat.tsx` |

CitationChip resolves to the appropriate deeplink given `kind`:
- `document` → existing doc viewer route
- `deadline` / `filing` / `motion` / `message` → existing tab on the case page

---

## Cost guard, rate limit, beta gate, disclaimer

- **Credits**: `STRATEGY_REFRESH = 10`, `STRATEGY_CHAT_MESSAGE = 1`, defined in `src/server/services/credits.ts`. Charged on success only. Cached run (input hash hit) charges 0.
- **Rate limit**: per-case 5-minute window on successful runs. Computed at tRPC mutation entrypoint via DB query.
- **Beta gate**: `src/server/lib/feature-flags.ts` reads `STRATEGY_BETA_ORG_IDS` (comma-separated). Hides nav, returns `notFound()` from route, throws `FORBIDDEN` from tRPC.
- **Disclaimer banner**: `dismissible="session"` (sessionStorage); always rendered above the recs panel and on first assistant chat message.

---

## Quality and safety

- **Citation filter** is the primary defense. Any recommendation that cites an ID not present in the collected context is dropped entirely. Sentry breadcrumb logged so we can audit dropped citations weekly.
- **Disclaimer banner** is always visible. Required by legal-tech industry norms and covers the SaaS legally.
- **Beta gate** lets us roll out behind a flag; only handpicked orgs see the feature.
- **Token + credit logging** in `case_strategy_runs` gives us a SQL-queryable usage timeline without a separate analytics pipeline.

## Observability

- Each run row contains tokens, credits, model, and (on failure) error message.
- Sentry receives an exception breadcrumb on pipeline failure.
- A daily Slack message digests "top N orgs by strategy spend yesterday" via existing alert infra (low effort: one Inngest cron + reuse of existing notification webhook).

---

## Migration / rollout sequence

1. Implement and merge with `STRATEGY_BETA_ORG_IDS=""` (no users see the feature).
2. Add one internal org id; smoke-test in production.
3. Add 2–3 beta firm org ids; observe for 2 weeks.
4. Review metrics: failure rate, dismissal rate, chat usage, credit burn, qualitative feedback from each beta firm weekly.
5. Tune the prompt and any obvious behavior issues; optionally ship Q9-B confidence scoring or Q4-C action buttons.
6. Remove the beta gate; announce in Phase 4 release notes.

## Risks

| Risk | Mitigation |
|---|---|
| Voyage API outage | Graceful degradation to digest-only with a banner explaining reduced quality |
| pgvector ivfflat drift | Scheduled re-index Inngest job (low priority — N is small in beta) |
| Citation hallucinations slip past filter | Sentry log each dropped citation; weekly review during beta |
| Power user spamming refresh | 5-minute per-case rate limit + credits cap |
| Privileged content in third-party embeddings | Voyage BAA review prior to GA (not required for internal-only beta) |
| Cost overrun in beta | Daily Slack digest of top-spending orgs; emergency kill via env flag |

## Success metrics

For the GA decision after beta:

1. **Adoption** — % of active orgs that opened the strategy tab in a given week.
2. **Retention** — orgs using week 1 still using week 4.
3. **Dismissal rate** — < 50% indicates relevance.
4. **Chat depth** — average messages per chat session as proxy for engagement.
5. **Cost per active user** — credits / DAU within plan margins.

---

## Testing

| Layer | Approach | Coverage |
|---|---|---|
| Pure functions | Vitest unit | `validate.ts` citation filter (id-exists / id-missing / empty refs / over-cap), `input_hash` canonicalization |
| Service | Vitest + mocked db + mocked Voyage/Anthropic | `collect.ts` happy path, embed cache hit/miss, rate limit boundary, credits success/failure |
| tRPC | Vitest + test db | `refresh`: permissions, rate limit, out-of-credits, beta gate; `chat`: send + list |
| Inngest | Local Inngest dev server | `strategy/refresh.requested` status transitions and error path |
| E2E smoke | Playwright | `/cases/[id]/strategy` returns <500 (route exists, beta-gated user gets 404, allowed user gets 200) |
| Manual UAT | Beta firms (2–3) | Real cases for 2 weeks, weekly feedback session |

---

## Open questions / things to settle in the implementation plan

- Exact Voyage SDK package name and import shape.
- Whether to add the `vector` extension via the existing migration runner (`scripts/apply-migrations-batch.ts`) or via Supabase dashboard one-time. Likely: migration file 0055, runner-applied.
- Whether existing case-tab navigation lives in a shared component or per-tab; will determine the smallest diff for adding the Strategy tab.
- Streaming chat transport: existing tRPC subscription pattern in repo vs. raw SSE. Pick whichever matches the rest of the chat-shaped flows.
- Document chunking strategy: token-bounded sliding window with overlap (start: 800 tokens, 100 overlap) is a sensible default; revisit if chunk boundaries hurt retrieval.
