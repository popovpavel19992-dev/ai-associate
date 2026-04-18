# Phase 2.2.3 — Research Memo Generation (IRAC) — Design

**Status:** approved (brainstorm 2026-04-18)
**Predecessor phases:** 2.2.1 Case Law Search + AI Q&A (shipped), 2.2.2 Statutes & Regulations (shipped)
**Roadmap successor:** 2.2.4 Collections

## 1. Summary

Generate IRAC-formatted (Issue / Rule / Application / Conclusion) legal research memos from a single research session, presented in a 3-pane editor (section nav | section editor | AI rewrite chat) and exportable to PDF or DOCX.

The module is the capstone of the Phase 2.2 Legal Research track: it turns the case law + statutes + chat thread accumulated in a session into a structured artefact suitable for partner review, client memo, or brief seed.

## 2. Brainstorm decisions

| # | Question | Decision |
|---|---|---|
| 1 | Source data | One session (queries + bookmarked opinions + chat thread). |
| 2 | Format | Strict IRAC only (no CRAC / exec summary / custom templates in MVP). |
| 3 | Editing | Section-level inline editor + per-section AI rewrite (mirrors contract-drafts pattern). |
| 4 | Citations | Opinions strict from session context; statutes auto-injected via existing `legal-rag` retrieval. No mid-generation CourtListener pull. |
| 5 | Billing | Credits per generation (3), unlimited free section rewrites (mirrors contract-drafts model). |

## 3. Architecture overview

```
[Research Session]
  → "Generate memo" button (session view)
  → Generation modal (memo question, optional jurisdiction)
  → tRPC research.memo.generate
  → Inngest job: pull context → 4 parallel Claude streams → UPL filter + citation validator
                 → INSERT research_memo_sections, UPDATE research_memos.status='ready'
  → /research/memos/[memoId] (3-pane editor)
  → Export: /api/research/memos/[memoId]/export?format=pdf|docx
```

### Component reuse (saves ~50% of code)

| From | What we reuse |
|---|---|
| `contract-drafts` | 3-pane editor layout, section-level inline edit, AI-rewrite chat panel, credit-billed generation, Inngest job pattern |
| `research/legal-rag` | RAG retrieval (opinions + statutes), `applyUplFilter`, `validateCitations`, streaming pattern |
| `contract-generate` | PDF/DOCX rendering pipeline (library choice confirmed during planning) |
| `research/usage-guard` | Credit-bucket pattern (extend with `checkAndIncrementMemo` / `refundMemo` mirroring Q&A methods) |
| `notifications` | New types `research_memo_ready` + `research_memo_failed` flow through existing handler |

### New artefacts

- 2 schema tables (`research_memos`, `research_memo_sections`) + 2 enums.
- 1 service (`MemoGenerationService`) — orchestrates retrieval, Claude calls, parsing, persistence.
- 1 Inngest function (`research-memo-generate`).
- 1 router (`research.memo.*` — `generate`, `get`, `list`, `updateSection`, `regenerateSection`, `delete`).
- 4-5 React components (memo viewer page, section nav, section editor, generation modal, list page).
- 1 Next route handler (`/api/research/memos/[memoId]/export`).
- 1 hand-written migration (`0010_research_memos.sql`).

### Out of scope (YAGNI)

- Multi-session merge.
- Format variants beyond IRAC.
- Custom user templates.
- CourtListener pull during generation.
- Token-based billing.
- Collaborative editing / multi-user concurrency.
- Memo version history / edit audit log (single-level undo on AI rewrite only).

## 4. Data model

### Table `research_memos`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK users (CASCADE) | owner |
| `session_id` | uuid FK research_sessions (CASCADE) | source session |
| `case_id` | uuid FK cases NULL (SET NULL) | mirrors `session.case_id`, cached for fast filtering on case detail page |
| `title` | text NOT NULL | auto-derived from session.title or first query; user-editable |
| `jurisdiction` | `research_jurisdiction` enum NULL | optional focus filter |
| `status` | `research_memo_status` enum NOT NULL | `'generating' | 'ready' | 'failed'` |
| `memo_question` | text NOT NULL | the research question driving generation |
| `context_opinion_ids` | uuid[] NOT NULL DEFAULT '{}' | snapshot of `cached_opinions.id` used at gen time |
| `context_statute_ids` | uuid[] NOT NULL DEFAULT '{}' | snapshot of `cached_statutes.id` used at gen time |
| `flags` | jsonb NOT NULL DEFAULT '{}' | aggregated `{unverifiedCitations: string[], uplViolations: string[]}` across sections |
| `token_usage` | jsonb NOT NULL DEFAULT '{}' | `{input_tokens, output_tokens}` per gen + per regen accumulated |
| `credits_charged` | int NOT NULL DEFAULT 0 | source of truth for refund-on-failure |
| `error_message` | text NULL | populated when status='failed' |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | |
| `deleted_at` | timestamptz NULL | soft delete |

**Indexes:**
- `(user_id, deleted_at, updated_at desc)` — list page
- `(case_id) WHERE case_id IS NOT NULL` — case detail tab
- `(session_id)` — session view memo list

### Table `research_memo_sections`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `memo_id` | uuid FK research_memos (CASCADE) | |
| `section_type` | `research_memo_section_type` enum NOT NULL | `'issue' | 'rule' | 'application' | 'conclusion'` |
| `ord` | int NOT NULL | display order (1..4) |
| `content` | text NOT NULL | markdown |
| `citations` | text[] NOT NULL DEFAULT '{}' | Bluebook strings used in this section, for chip rendering |
| `ai_generated_at` | timestamptz NOT NULL | last AI write (gen or rewrite) |
| `user_edited_at` | timestamptz NULL | last manual edit |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | |

**Constraints:**
- UNIQUE `(memo_id, section_type)` — one of each kind per memo
- `ord` between 1 and 4 (CHECK)

**Index:** `(memo_id, ord)`.

### New enums

```sql
CREATE TYPE "public"."research_memo_status" AS ENUM ('generating','ready','failed');
CREATE TYPE "public"."research_memo_section_type" AS ENUM ('issue','rule','application','conclusion');
```

### Schema-level decisions

- **Soft delete only on parent.** Section deletion = memo regen. Simplifies UI and avoids orphan-section UX.
- **`section_type` is enum, not free-form** — locks IRAC for MVP, easy to extend (CRAC etc.) by adding enum values later.
- **`context_*_ids` snapshots are critical for rewrite reproducibility:** when a user regenerates a single section, we feed the SAME opinion/statute set used at original generation, not whatever's currently in cache (which may have been evicted or refreshed).
- **`flags` aggregated on parent** so the memo list can show a "⚠ 2 unverified citations" badge without joining sections.
- **`research_usage.memo_count`** already exists from 2.2.1 schema — reused, no schema change needed for billing.

## 5. Generation pipeline

### Trigger: `research.memo.generate` mutation

```ts
input: {
  sessionId: uuid,
  memoQuestion?: string,        // defaults to session.title
  jurisdiction?: Jurisdiction,  // defaults to undefined (no focus filter)
}
```

**Steps:**

1. `assertSessionOwnership(sessionId, userId)` — same helper used by research.search.
2. Validate session has ≥1 bookmarked opinion OR ≥1 chat exchange. If neither, throw `BAD_REQUEST` with hint message.
3. `UsageGuard.checkAndIncrementMemo(userId, plan)` — throws `TOO_MANY_REQUESTS` if over cap (mirrors Q&A guard).
4. INSERT `research_memos { status: 'generating', credits_charged: 3, memo_question, jurisdiction, ... }`.
5. `inngest.send({ name: "research/memo.generate.requested", data: { memoId } })`.
6. Return `{ memoId }` immediately. UI navigates to `/research/memos/[memoId]`, shows skeleton.

### Inngest function: `research-memo-generate`

1. Load memo + session (with bookmarks + chat history via existing services).
2. **Resolve context:**
   - Bookmarked opinions for session → hydrate via `OpinionCacheService.getOrFetch` (uses our v4-tolerant pathway from commit `d6cc490`).
   - Statutes referenced in chat history → `StatuteCacheService.getByInternalIds`.
   - UPDATE `memo.context_opinion_ids = [...]`, `memo.context_statute_ids = [...]`.
3. **Generate 4 sections in parallel** (Promise.all of 4 Claude streams):
   - Each section uses base `SYSTEM_PROMPT` from `legal-rag.ts` + a section-specific user message template.
   - `max_tokens: 1500` per section.
   - Stream is consumed to completion (we don't surface streaming here — caller polls memo status).
4. For each section response:
   - `applyUplFilter(text)` → `{filtered, violations}`
   - `validateCitations(filtered, contextCitations)` → `{unverified}`
   - If `unverified.length >= 4`, re-prompt that single section once with the same "regenerate using only provided materials" follow-up used in `legal-rag.ts`. Give-up threshold same as Q&A: 4 after re-prompt.
5. INSERT 4 `research_memo_sections` rows (or 1 row × 4 in a transaction).
6. Aggregate flags: `flags = { unverifiedCitations: [...all sections], uplViolations: [...all sections] }`.
7. UPDATE `research_memos { status: 'ready', flags, token_usage: {input, output sum across sections} }`.
8. `inngest.send({ name: "notification.research_memo_ready", data: { memoId, userId } })`.

### Section prompts

All four inherit the legal-rag base SYSTEM_PROMPT (UPL guardrails, banned vocabulary, attorney audience, every-claim-cited rule).

| Section | Prompt focus |
|---|---|
| **Issue** | "State the legal question(s) presented by the research, in 1–3 sentences. No analysis. Citations not required." |
| **Rule** | "State the controlling rules of law from the provided opinions and statutes. Cite every rule. No application." |
| **Application** | "Apply the rules from the provided materials to the question. Cite specific holdings. Acknowledge contrary authority where it exists in the provided materials." |
| **Conclusion** | "Summarize the answer to the question in 2–4 sentences. Restate citations parenthetically. No new analysis." |

### Failure modes

| Failure | Handling |
|---|---|
| Claude API error on a section | Retry once. If still fails → memo `status='failed'`, `error_message` populated, `UsageGuard.refundMemo`, notification fires. |
| Citation re-prompt give-up (≥4 unverified after retry) on any section | Section content is persisted with `flags.unverifiedCitations` populated; memo status still `'ready'`. UI surfaces the warning. (Don't fail the whole memo for one weak section — user can regenerate.) |
| User cancels mid-gen | Inngest job not cancellable mid-flight (acceptable — typical gen <30s); UI shows skeleton until completion or failure. |
| Empty session | Rejected at tRPC mutation step (#2) before any DB or Inngest work. |

### Single-section regeneration: `research.memo.regenerateSection`

```ts
input: {
  memoId: uuid,
  sectionType: 'issue' | 'rule' | 'application' | 'conclusion',
  steeringMessage?: string,  // e.g. "focus on damages calculation"
}
```

- Pulls memo `context_opinion_ids` + `context_statute_ids` (snapshot — NOT current cache, ensures reproducibility).
- Re-runs that section's prompt + optional steering message.
- Streams via tRPC subscription (consistent with `chat-panel.tsx` pattern; user sees streaming text in section editor).
- **No credit charge** (Q5 decision).
- UPDATE only that section's row + `memo.updated_at` + re-aggregate `memo.flags`.

### Manual section edit: `research.memo.updateSection`

```ts
input: { memoId: uuid, sectionType: ..., content: string }
```

- Plain UPDATE `{ content, user_edited_at: now }`.
- No AI involvement, no UPL filter (user owns their text).
- Throttled client-side (debounce 1s).

## 6. Editor UX

### Routes

| Route | Purpose |
|---|---|
| `/research/memos` | List page — all user's memos, filter by case, search by title |
| `/research/memos/[memoId]` | 3-pane editor (the main work surface) |
| `/research/sessions/[sessionId]` | Existing — gains "Generate memo" button + "Memos from this session" list block |
| `/cases/[id]` Research tab | Existing — adds memo count + collapsed list under sessions/bookmarks |

### `/research/memos/[memoId]` layout

```
┌─────────────────┬─────────────────────────┬──────────────────┐
│ Section nav     │  Active section editor  │  AI rewrite chat │
│ (left, 240px)   │  (center, flex-1)       │  (right, 384px)  │
├─────────────────┼─────────────────────────┼──────────────────┤
│ ◉ Issue         │  ## Issue               │  Ask AI to       │
│ ○ Rule          │  [TipTap editor]        │  rewrite this    │
│ ○ Application   │  ────                   │  section…        │
│ ○ Conclusion    │  Citations:             │  [textarea]      │
│                 │  • 410 U.S. 113         │  [Send]          │
│ Generated by AI │  • 42 USC § 1983        │                  │
│ Last edit: 2m   │  [Regenerate section]   │  ↑ chat history  │
└─────────────────┴─────────────────────────┴──────────────────┘
   Header: title (inline editable) | flags badge | Export ▾ | ⋮
```

**Behavior:**

- **Left rail:** 4 IRAC sections, click switches active. URL syncs `?section=rule`. Indicator icon shows AI-only vs user-edited (compares `ai_generated_at` vs `user_edited_at`).
- **Center:** TipTap rich-text editor (already in repo for contract-drafts). Citations rendered as `<CitationChip>` (existing component) below content. "Regenerate section" button at bottom focuses the right-rail chat input pre-populated for that section.
- **Right:** Chat panel mirrors `chat-panel.tsx`, mode `'memo_section'`. Each user message = section-rewrite request; assistant streams new content; "Apply" button replaces section content. **Undo:** client-side single-level (Cmd-Z restores pre-Apply text within the editor session); not DB-persisted. The previous section content is discarded once the user navigates away or applies a second rewrite.
- **Header:** title editable in place; flags badge shows aggregated counts → click reveals breakdown popover; Export dropdown (PDF / DOCX); ⋮ menu (delete, duplicate, view source session).

**While generating (`status='generating'`):**

- Sections show skeleton shimmers.
- Auto-poll memo status every 2s (or invalidate on `notification.research_memo_ready` event via SSE).
- When status flips to `'ready'`, editor populates without page refresh.

**Failed state (`status='failed'`):**

- Banner: "Generation failed: {error_message}. Credits refunded."
- "Retry" button → fires `research.memo.retryGenerate` mutation that re-fires the Inngest job (no new credit charge — original was refunded).

### `/research/memos` — list page

- Card or table rows: title, source session, created date, flags badge, status icon.
- Filters: case dropdown, status dropdown, free-text title search.
- Pagination (20/page).
- Empty state CTA → "Open a research session to generate your first memo".

### Generation modal (from session view)

Triggered by "Generate memo" button on `/research/sessions/[sessionId]`. Single modal:

- **Memo question** textarea (defaults to session.title).
- **Jurisdictional focus** optional dropdown (defaults to session's filter union).
- **Cost preview:** "This will use 3 credits (X / Y remaining this month)".
- **Context preview:** "Will use N bookmarked opinions, M chat exchanges, K statutes referenced".
- Validation: if 0 opinions AND 0 chat → Generate button disabled with hint "Bookmark an opinion or ask a question first".
- "Generate" → fires mutation, redirects to `/research/memos/[id]` with skeleton.

## 7. Export

**PDF:**

- Reuse contract-generate's PDF pipeline (library choice — `@react-pdf/renderer` vs Puppeteer — confirmed during planning by inspecting `src/server/services/contract-generate.ts`).
- Template: title block (case caption-ish if `case_id` present) + 4 IRAC sections (H2 headings) + footer with full citation list + UPL disclaimer (`getReportDisclaimer()`).

**DOCX:**

- `docx` npm library (lightweight; no headless browser).
- Same structure as PDF.
- Bluebook citations rendered inline + as numbered footer list.

**Endpoint:** `/api/research/memos/[memoId]/export?format=pdf|docx` — Next App Router route handler. Synchronous (5s default timeout suffices for typical memo size). Response is the binary file with `Content-Disposition: attachment`.

## 8. Notifications

Two new types added to the `notifications` enum + handlers:

- `research_memo_ready` — fires on Inngest job success. In-app + email per user prefs.
- `research_memo_failed` — fires on terminal Inngest failure. In-app + email per user prefs.

Wired through existing notifications module. The `handle-notification.ts` default-case fallback already handles unknown types gracefully, but explicit entries give us proper email subject lines and `category='research'`.

## 9. Billing

- **Credits per generation:** 3 (matches contract-drafts full generation).
- **Section regeneration:** free (matches contract-drafts clause rewrite).
- **Manual edit:** free.
- **Plan caps** (smaller than Q&A buckets — memos are higher-cost work, ~6K output tokens per gen vs ~2K for a chat answer):
  - `trial` → 10 memos/month (Q&A is 50)
  - `solo` → 50 memos/month (Q&A is 500)
  - `business` → unlimited
- **Counter:** existing `research_usage.memo_count` column (added in 2.2.1 schema, unused until now).
- **Refund-on-failure:** atomic via `UsageGuard.refundMemo` (mirrors `refundQa`).

`UsageGuard` extension:

```ts
async checkAndIncrementMemo({ userId, plan }: { userId: string; plan: Plan }): Promise<void>
async refundMemo({ userId }: { userId: string }): Promise<void>
```

Plan → cap mapping (in `research.ts` router):

```ts
function mapUserPlanToMemoCap(plan: Plan): number | null {
  switch (plan) {
    case 'starter': return 10;
    case 'professional': return 50;
    case 'business': return null; // unlimited
  }
}
```

## 10. UPL compliance

- **Per-section UPL filter** (re-uses `applyUplFilter`).
- **Per-section citation validator** (re-uses `validateCitations` against `context_opinion_ids` + `context_statute_ids` snapshot).
- **PDF/DOCX always include `getReportDisclaimer()` footer** — not user-removable.
- **System prompt** explicitly instructs "memo for licensed-attorney audience; no first-person advice; no 'should/must/recommend'." (Inherits banned vocabulary from `legal-rag.ts`.)
- **Citation snapshot rule** prevents citation drift when cache changes — auditable trail of what the AI was actually shown.

## 11. Acceptance criteria (UAT)

1. **Generation:** Open existing session with ≥1 bookmark → "Generate memo" → modal → submit → redirect to memo page → see skeleton → within 60s status flips to ready, all 4 sections populated.
2. **Empty session block:** Open session with 0 bookmarks AND 0 chat exchanges → Generate button disabled, hint visible.
3. **Section regen:** Click "Regenerate section" on Application → enter "focus on damages" → Apply → only Application updates; Issue/Rule/Conclusion + their `ai_generated_at` timestamps unchanged; no credit charged.
4. **Manual edit persistence:** Edit Rule section text → blur → reload page → edit persists; section shows "Edited" indicator (`user_edited_at > ai_generated_at`).
5. **Failure refund:** Force Anthropic error (mock or invalid key) → memo status='failed' → credit count decrements then increments back (net zero); banner shows error.
6. **Citation snapshot:** After memo generates, force opinion cache eviction (delete row from `cached_opinions`) → regenerate section still uses snapshot from `context_opinion_ids` (not "opinion not found" error).
7. **Export PDF:** Click Export → PDF → file downloads with title, 4 IRAC sections, citations footer, UPL disclaimer.
8. **Export DOCX:** Same as #7 but `.docx`.
9. **Billing limits:** Trial user with 0 memos remaining → Generate → mutation throws `TOO_MANY_REQUESTS` → upsell modal appears (reuse from chat path).
10. **Notification:** Memo gen completes → in-app notification "Memo ready: {title}" appears; email per user prefs.
11. **Soft delete:** Delete memo → disappears from list; row exists in DB with `deleted_at` set.
12. **UPL audit:** Extend `scripts/upl-audit.ts` (or sibling `upl-memo-audit.ts`) to generate memos for the same 25 queries; mechanical pass criterion: 0 banned words across sections, 0 unverified citations, disclaimer present in PDF.

## 12. Test plan

| Layer | Coverage |
|---|---|
| Unit | `MemoGenerationService` prompt assembly + section parsing + context snapshot persistence |
| Unit | `UsageGuard.checkAndIncrementMemo` / `refundMemo` (atomic increment + refund commute under concurrency, mirroring existing Q&A guard tests) |
| Integration (mock DB) | `research.memo` router — generate / get / list / updateSection / regenerateSection / delete; ownership checks; status transitions; error surfacing |
| Integration | Inngest function `research-memo-generate` — INSERT sections, status flip, flag aggregation, refund-on-failure |
| Component (RTL) | Section editor (manual edit, undo, regenerate trigger) |
| Component (RTL) | Section nav + active-section URL sync |
| Component (RTL) | Generation modal validation (empty session blocks Generate) |
| E2E (Playwright) | Generate → ready flow, edit section, export PDF returns 200 (matches existing `e2e/research.spec.ts` convention) |

## 13. Migration

Hand-written `src/server/db/migrations/0010_research_memos.sql` (project convention; not drizzle-kit generated):

```sql
CREATE TYPE "public"."research_memo_status" AS ENUM ('generating','ready','failed');
CREATE TYPE "public"."research_memo_section_type" AS ENUM ('issue','rule','application','conclusion');

CREATE TABLE "research_memos" ( ... );
CREATE TABLE "research_memo_sections" ( ... );

CREATE INDEX "research_memos_user_updated_idx"
  ON "research_memos" USING btree ("user_id","deleted_at","updated_at" DESC NULLS LAST);
CREATE INDEX "research_memos_case_idx"
  ON "research_memos" USING btree ("case_id") WHERE "case_id" IS NOT NULL;
CREATE INDEX "research_memos_session_idx"
  ON "research_memos" USING btree ("session_id");

CREATE UNIQUE INDEX "research_memo_sections_memo_type_unique"
  ON "research_memo_sections" USING btree ("memo_id","section_type");
CREATE INDEX "research_memo_sections_memo_ord_idx"
  ON "research_memo_sections" USING btree ("memo_id","ord");

ALTER TABLE "research_memos"
  ADD CONSTRAINT "research_memos_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_memos_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_memos_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null;

ALTER TABLE "research_memo_sections"
  ADD CONSTRAINT "research_memo_sections_memo_id_fk" FOREIGN KEY ("memo_id") REFERENCES "public"."research_memos"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_memo_sections_ord_check" CHECK ("ord" BETWEEN 1 AND 4);
```

Applied via `psql $DATABASE_URL -f` (hand-written migration pattern). Drizzle schema files updated to match.

## 14. Open items for the planning step

- Confirm contract-generate's PDF library (`@react-pdf/renderer` vs Puppeteer) by inspecting `src/server/services/contract-generate.ts` — affects Task ordering for the export work.
- Confirm `tiptap` is the actual editor in contract-drafts (or which rich-text component) — affects component-reuse scope.
- Decide whether to add a separate `upl-memo-audit.ts` script or extend `upl-audit.ts` with a `--mode=memo` flag (the latter keeps the harness in one place; recommend during planning).

These are clarifications, not design changes — resolved during `/superpowers:writing-plans`.
