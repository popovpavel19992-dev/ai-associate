# 2.2.1 Case Law Search + AI Q&A — Design Specification

**Phase:** 2.2.1 (first subphase of Phase 2.2 Legal Research)
**Date:** 2026-04-16
**Status:** Spec approved, ready for implementation plan

---

## Phase 2.2 Legal Research — Roadmap

Phase 2.2 delivers the Legal Research module as four thin vertical slices, each shipping end-to-end user value:

| Subphase | Scope |
|----------|-------|
| **2.2.1** | **Case law search + AI Q&A (this spec)** |
| 2.2.2 | Statutes & regulations lookup + per-statute bookmarks |
| 2.2.3 | Memo generation (IRAC-structured, Bluebook-cited) |
| 2.2.4 | Collections: folders, tags, team sharing, Bluebook bibliography export |

Each subphase has its own spec and plan.

---

## 1. Overview

Case Law Search + AI Q&A gives lawyers on ClearTerms a self-contained legal research workspace:

- Keyword search across US federal case law plus 5 key state jurisdictions (CA, NY, TX, FL, IL) sourced live from **CourtListener**
- On-demand full-text opinion viewer with Bluebook citation, highlighted search terms, and citation network
- Two AI Q&A modalities powered by Claude API:
  - **Broad RAG** over top-N search results ("what's the majority holding?")
  - **Deep read** over a single opinion ("what's the dissent's main argument?")
- Auto-saved **research sessions** (query history + chat thread), listed per user
- **Bookmarks** for individual opinions with optional notes, optionally attached to a case
- Optional case linkage at session and bookmark level (respects B-approach: standalone module with optional `case_id`)
- Hybrid billing: search free on all tiers, AI Q&A metered monthly per tier, memo generation (2.2.3) on credits

## 2. Goals

- Lawyer opens `/research`, runs a search, opens an opinion, asks AI a question, bookmarks the result, and optionally attaches it to a case — all in under 2 minutes
- AI responses are verifiable (every citation validated against opinions in current context; hallucinated citations flagged)
- Firm stays UPL-compliant: every AI output passes the banned-words filter and carries a disclaimer
- Bootstrapped-friendly: no proprietary legal data APIs (Westlaw/Lexis), no large corpus ingestion, no vector DB on MVP
- Ships in 2-3 weeks on existing stack (Next.js 16, tRPC 11, Drizzle, Supabase Postgres, Claude API, Inngest)

## 3. Out of Scope (explicit for 2.2.1)

- Statutes / regulations lookup → 2.2.2
- Memo generation → 2.2.3
- Folders, tags, team sharing of research, Bluebook bibliography export → 2.2.4
- Semantic search / pgvector / local corpus ingestion → Phase 3
- Westlaw / LexisNexis / Bloomberg Law integration → Phase 3+
- Non-US jurisdictions, other languages → Phase 3+
- Mobile app support → Phase 3+
- Cross-user bookmark sharing, co-editing chat → 2.2.4

## 4. User Jurisdiction & Data Source

| Dimension | Decision |
|-----------|----------|
| Jurisdiction coverage | US Federal (SCOTUS, Circuit, District) + CA, NY, TX, FL, IL state courts |
| Primary data source | **CourtListener REST API v4** (free tier, 5 000 requests/day) |
| Data strategy | **Hybrid**: live API for search; on-demand fetch + cache full opinion text in `cached_opinions` when user opens one; AI Q&A uses cached opinions as RAG context |
| Anti-hallucination | Citation extraction + cross-check against context; unverified citations flagged in UI; 2+ unverified triggers re-prompt |

Rationale for hybrid: zero-storage MVP, progressively warms cache through organic user traffic, clean migration path to semantic retrieval later (keep opinion text; add pgvector in a future phase).

## 5. Data Model

All tables live in the existing Supabase Postgres via Drizzle ORM.

### `research_sessions`
Auto-saved per user, created on first search, owns a chat thread.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| user_id | uuid fk → users.id | |
| case_id | uuid fk → cases.id, nullable | Optional link |
| title | text | Auto-generated from first query; editable |
| jurisdiction_filter | jsonb | Snapshot of filters at session start |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz, nullable | Soft delete |

Indexes: `(user_id, deleted_at, updated_at desc)` for sidebar listing; `(case_id)` for Case→Research tab.

### `research_queries`
Each search action inside a session.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| session_id | uuid fk → research_sessions.id | |
| query_text | text | |
| filters | jsonb | Applied filters (jurisdiction, court, date range) |
| result_count | int | From CourtListener response |
| created_at | timestamptz | |

### `research_chat_messages`
Q&A messages per session.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| session_id | uuid fk → research_sessions.id | |
| role | enum('user', 'assistant') | |
| content | text | |
| opinion_context_ids | uuid[] | Which `cached_opinions` were in Claude's context |
| mode | enum('broad', 'deep') | Broad RAG or Deep read |
| opinion_id | uuid, nullable | Present for deep mode |
| tokens_used | int | For cost tracking |
| flags | jsonb | `{ unverified_citations: ["..."], upl_violations: [] }` |
| created_at | timestamptz | |

### `cached_opinions`
Shared cross-user cache of CourtListener opinions.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| courtlistener_id | bigint, unique | Upstream identifier |
| citation_bluebook | text | Canonical Bluebook cite |
| case_name | text | |
| court | text | Court slug from CourtListener |
| jurisdiction | enum('federal', 'ca', 'ny', 'tx', 'fl', 'il') | |
| court_level | enum('scotus', 'circuit', 'district', 'state_supreme', 'state_appellate') | |
| decision_date | date | |
| full_text | text, nullable | Null until first `getOpinion` |
| snippet | text | Pulled from search response |
| metadata | jsonb | Judges, syllabus links, cited-by count, etc. |
| first_cached_at | timestamptz | |
| last_accessed_at | timestamptz | Touched on every open |

Indexes: unique on `courtlistener_id`; `(jurisdiction, decision_date desc)`; trigram on `case_name` for autocomplete (future).

Retention: no automatic purge (opinions are public record, storage cost negligible). Manual cleanup of stale un-accessed rows deferred.

### `opinion_bookmarks`
Per-user saved opinions, independent of sessions.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| user_id | uuid fk → users.id | |
| opinion_id | uuid fk → cached_opinions.id | |
| case_id | uuid fk → cases.id, nullable | Optional link |
| notes | text, nullable | User's reason; max 500 chars |
| created_at | timestamptz | |

Unique constraint: `(user_id, opinion_id)` — one bookmark per user per opinion. Note editing updates existing row.

### `research_usage`
Monthly aggregation for tier limit enforcement.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| user_id | uuid fk → users.id | |
| month | char(7) | `YYYY-MM` |
| qa_count | int, default 0 | Incremented per broad/deep Q&A |
| memo_count | int, default 0 | Reserved for 2.2.3 |
| updated_at | timestamptz | |

Unique constraint: `(user_id, month)`. Rows created lazily on first Q&A of the month.

### Existing tables touched

- `cases` — new derived views only (Case → Research tab queries `research_sessions` + `opinion_bookmarks` filtered by `case_id`)
- `activity_log` (2.1.1) — new event types: `research.session_linked`, `research.bookmark_added`
- `notifications` (2.1.7) — new trigger: when bookmark attached to case, notify case assignees
- `user_credits` — untouched in 2.2.1 (used in 2.2.3)

## 6. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Next.js 16 App                       │
│  /research (hub) · /research/sessions/[id] · /research/bookmarks │
│  Case detail → Research tab                                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ tRPC 11
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ researchRouter                                              │
│  · search, getOpinion, listSessions, createSession, ...     │
│  · askBroad, askDeep (with usage guard middleware)          │
│  · bookmarks CRUD, linkToCase                               │
└──────┬──────────────┬──────────────┬────────────────┬───────┘
       │              │              │                │
       ▼              ▼              ▼                ▼
┌─────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────────┐
│CourtList│  │ Supabase     │  │ Claude   │  │ Inngest       │
│ener API │  │ Postgres +   │  │ API      │  │ (async opin.  │
│         │  │ Drizzle      │  │ (sonnet) │  │  enrichment,  │
│         │  │              │  │          │  │  monthly reset)│
└─────────┘  └──────────────┘  └──────────┘  └───────────────┘
```

### Services

| Service | Responsibility |
|---------|----------------|
| `CourtListenerClient` | Thin wrapper over CourtListener REST v4. Handles auth token, pagination, filter mapping, response normalization. Retry with exponential backoff on 5xx. |
| `OpinionCacheService` | `getOrFetch(opinionId)` — checks `cached_opinions`, fetches full text on miss, stores, touches `last_accessed_at`. |
| `ResearchSessionService` | CRUD for sessions, queries, chat messages. Auto-title generation. |
| `BookmarkService` | CRUD for `opinion_bookmarks`. Handles case linkage and activity_log emissions. |
| `LegalRagService` | Assembles context (selected opinions + history + system prompt), calls Claude, runs citation validator + UPL filter, records `research_chat_messages` and increments `research_usage`. |
| `UsageGuard` | tRPC middleware. Reads user's tier + current month `research_usage`, throws `UsageLimitExceededError` if over. |

### Routes (tRPC)

```
research.search({ query, filters, page })
research.getOpinion({ opinionId })
research.sessions.list({ caseId? })
research.sessions.get({ sessionId })
research.sessions.rename({ sessionId, title })
research.sessions.delete({ sessionId })
research.sessions.linkToCase({ sessionId, caseId | null })
research.askBroad({ sessionId, question, topN = 10 })      // subscription for streaming
research.askDeep({ sessionId, opinionId, question })        // subscription for streaming
research.bookmarks.list({ caseId? })
research.bookmarks.create({ opinionId, notes?, caseId? })
research.bookmarks.update({ bookmarkId, notes?, caseId? })
research.bookmarks.delete({ bookmarkId })
```

## 7. Search Pipeline

1. UI calls `research.search({ query, filters, page })`.
2. `CourtListenerClient.search()` hits `GET /api/rest/v4/search/?type=o&q=...` with mapped filters.
3. Response normalized: each hit → `{ courtlistener_id, case_name, court, jurisdiction, court_level, decision_date, citation_bluebook, snippet }`.
4. Upsert metadata-only rows into `cached_opinions` (no full_text yet). If row exists, touch `last_accessed_at` and refresh snippet if changed.
5. Append row to `research_queries` (bound to current or auto-created session).
6. Return paginated normalized results to UI.

**Filters (all optional, combinable):**

- Jurisdiction: `federal`, `ca`, `ny`, `tx`, `fl`, `il` (multi-select)
- Court level: `scotus`, `circuit`, `district`, `state_supreme`, `state_appellate` (multi-select)
- Date range: `from_year`, `to_year`; presets: last 5 / last 10 / all time
- Court name autocomplete (secondary; pulls from CourtListener `/courts/` endpoint, cached daily)

**Pagination:** server-side, 20 results per page. CourtListener supports cursor-based; we expose simple page numbers and maintain cursor server-side per session.

**Rate limits:** CourtListener free tier = 5 000 requests/day per API key. Expected load: ~100 active users × ~30 searches/day = 3 000 requests/day. Headroom for `getOpinion` calls (~same volume). Bumping to paid tier is a config change when user count grows.

## 8. Opinion Viewer & On-Demand Fetch

1. User clicks an opinion in results → UI calls `research.getOpinion({ opinionId })`.
2. `OpinionCacheService.getOrFetch`:
   - If `cached_opinions.full_text` present → touch `last_accessed_at`, return.
   - Else → fetch from `GET /api/rest/v4/opinions/{courtlistener_id}/`, parse HTML/text, store in `full_text`, return.
3. After first fetch, dispatch Inngest job `research.enrichOpinion` (non-blocking): pulls citation network from `/api/rest/v4/citations/`, updates `metadata.cited_by_count` and `metadata.cites_to`.

**Viewer UI (full-page modal or right panel):**

- Header: case name, Bluebook citation (copy button), court / decision date / judges, "Bookmark" toggle, "Attach to case…" dropdown
- Body: numbered paragraphs; search-query terms highlighted; collapsible syllabus and dissent sections if detected
- Right rail: AI Q&A chat panel (deep mode, see §9)
- Footer: permanent UPL disclaimer banner

## 9. AI Q&A Pipeline

### Shared infrastructure

- Model: `claude-sonnet-4-6`
- Temperature: 0.2 (deterministic, citation-heavy work)
- Max context: ~150 K tokens for opinions; remaining budget for system prompt, chat history, and response
- Per-opinion trimming: if an opinion exceeds ~10 K tokens, keep syllabus + first 60 % of body + metadata summary

### Modality A — Broad RAG over search results

Trigger: "Ask AI about these results" button in results list header.

```
askBroad({ sessionId, question, topN = 10 })
  → select topN opinions from current results
  → for each: OpinionCacheService.getOrFetch (parallel, up to 5 at a time)
  → assemble context: SYSTEM_PROMPT + UPL_GUARDRAILS + concatenated opinions + recent chat history (last 10 msgs)
  → Claude stream
  → on each token: append to assistant message, stream to UI
  → on stop: run citation validator + UPL filter
  → persist research_chat_messages{ mode: 'broad', opinion_context_ids: [...], flags: {...} }
  → increment research_usage.qa_count
```

### Modality B — Deep read over single opinion

Trigger: chat panel inside opinion viewer.

```
askDeep({ sessionId, opinionId, question })
  → ensure opinion cached
  → context: SYSTEM_PROMPT + UPL_GUARDRAILS + full opinion text + session chat history scoped to this opinion
  → Claude stream (max_tokens 4096, higher for deep analysis)
  → same post-processing + persistence as broad
```

### System prompt (hard-coded guardrails)

```
You are a legal research assistant for a licensed-attorney audience. You analyze
provided U.S. case law and give factual, well-cited summaries.

You do NOT give legal advice, predict outcomes, recommend actions, or address
the reader's specific situation. Use only the opinions provided in this context.
If the provided opinions do not address the question, say so explicitly.

Never use these words or phrases: should, must, recommend, advise, your rights,
we suggest, best option, you have a case, legal advice. Prefer: "the court held",
"this opinion indicates", "consider that", "typically courts in this circuit",
"the provided opinions do not address".

Every factual claim must cite a provided opinion using its Bluebook citation.
Do not invent citations. If uncertain, say so.
```

### Citation validator (anti-hallucination)

- Regex extracts Bluebook-shaped citations from response: `\b\d+\s+[A-Z][a-zA-Z.\s]+\s+\d+\b` (and variants for U.S., F.3d, state reporters)
- Each extracted cite matched case-insensitively against `cached_opinions.citation_bluebook` filtered by `opinion_context_ids`
- Unmatched citations flagged in `research_chat_messages.flags.unverified_citations` and shown in UI with ⚠ tooltip
- If ≥ 2 unmatched → automatic re-prompt: "Your previous response cited X which was not in the provided materials. Regenerate using only the provided opinions."
- If ≥ 4 unmatched after re-prompt → full discard + generic error response to user: "The AI couldn't ground its answer in the provided opinions. Try narrowing the question or selecting specific opinions."

### UPL output filter

Reuses the banned-words list and replacement map from the original ClearTerms UPL system (spec `2026-04-02-clearterms-design.md` §UPL Compliance System). Applied to Claude response before streaming completes:

- Scan for banned words
- Auto-replace with approved alternatives
- If ≥ 3 violations → hold response, queue for human review, show user a neutral fallback: "Response pending quality review."

### Streaming UI

- SSE via tRPC subscription (or `fetch` with `ReadableStream` fallback)
- Citations rendered as clickable chips inline; clicking opens the cited opinion in the viewer panel
- ⚠ icon next to unverified citations with tooltip "This citation wasn't found in the searched opinions"

## 10. UPL Compliance Summary

| Layer | Applied |
|-------|---------|
| ToS / account-level disclaimer | Inherited from Phase 1 |
| Research hub banner | Persistent text: "ClearTerms Research provides case-law analysis, not legal advice." |
| Opinion viewer footer | Permanent disclaimer |
| AI system prompt guardrails | Hard-coded (§9) |
| Banned-words output filter | Applied to every Q&A response |
| Citation validator | Applied to every Q&A response |
| UPL footer on every Q&A message | Rendered in chat UI below each assistant message |
| Audit log | `research_chat_messages` stores inputs, outputs, and flags; raw Claude I/O in `ai_audit_log` (reused from Phase 1) |

## 11. Billing Integration (Hybrid)

| Action | Cost |
|--------|------|
| Search | Free on all tiers, no counter |
| Open opinion / bookmark / session CRUD | Free on all tiers |
| AI Q&A (broad or deep) | Counted in `research_usage.qa_count` |
| Memo generation | 3 credits (reserved for 2.2.3) |

**Tier limits (monthly):**

| Tier | Q&A per month |
|------|---------------|
| Starter ($29) | 50 |
| Professional ($79) | 500 |
| Business ($199) | Unlimited (soft cap 5 000 for abuse detection) |

**UI:**

- Progress bar in research hub header: "47 / 50 Q&A used this month"
- Yellow warning at 80 %
- Red banner + upsell CTA at 100 % (Starter/Pro)
- Business tier only shows counter above 1 000

**Reset:** no explicit reset needed — rows are scoped by `month` and created lazily on the first Q&A of each month via the unique `(user_id, month)` constraint (ON CONFLICT upsert). Old rows retained indefinitely for analytics.

**Concurrency:** usage increment happens inside the same transaction that persists the assistant message, preventing double-count on retries.

## 12. Integration with Existing Modules

- **Cases (Phase 2.1.1)** — new tab "Research" in case detail showing `research_sessions` + `opinion_bookmarks` filtered by `case_id`. New-session CTA pre-fills `case_id`.
- **Activity Log (2.1.1)** — emits `research.session_linked`, `research.bookmark_added` entries.
- **Notifications (2.1.7)** — when a bookmark is attached to a case, notify case assignees using existing `NotificationService`.
- **Client Portal (2.1.8)** — research is **not** exposed to clients (lawyer-only). No portal surface in 2.2.1.
- **Team Collaboration (2.1.4)** — respects roles: any firm member can create sessions/bookmarks; firm admins see aggregate `research_usage` (for billing), never contents.
- **Lawyer Profiles (2.1.9)** — no integration in 2.2.1. (Could surface "research interests" tag in 2.2.4.)
- **Global Search (future)** — sessions and bookmarks are structured for Cmd-K inclusion later, no work in 2.2.1.

## 13. Error Handling Matrix

| Scenario | Behavior |
|----------|----------|
| CourtListener API down (5xx / timeout) | UI shows "Search temporarily unavailable", manual retry; persistent outage status banner |
| CourtListener rate limit (429) | Inngest queue; UI "Processing…" state; exponential backoff |
| Opinion fetch fails | Mark cached_opinions row as "partial" (metadata only); bookmark allowed; AI Q&A disabled for that opinion with tooltip; retry on next access |
| Claude timeout / 5xx | One retry with backoff; on second failure show "Claude unavailable, try again"; **do not** increment `research_usage.qa_count` |
| Claude 429 | Queue via Inngest, show "Processing…" |
| Hallucinated citation (< 2) | Inline ⚠ icon + tooltip |
| Hallucinated citations (≥ 2) | Automatic re-prompt |
| Hallucinated citations (≥ 4 after re-prompt) | Discard response, show neutral error; do not increment usage |
| UPL violation (≥ 3 banned words after auto-replace) | Hold, queue for human review, neutral fallback to user |
| Usage limit exceeded | `UsageLimitExceededError` thrown by middleware; UI upsell modal with link to billing portal |
| Session load fails | Toast error + "Start new session" fallback |
| Bookmark to a deleted case | Nullify `opinion_bookmarks.case_id`, keep bookmark |

## 14. Testing Strategy

### Unit (Vitest)

- `CourtListenerClient`: mocked responses, filter mapping, pagination, normalization, error paths
- Claude prompt builder: snapshot tests for system prompt and context assembly
- Citation validator: happy path, unverified detection, edge regex cases (spaces, abbreviations)
- UPL banned-words filter: scan + replacement correctness, flagging threshold
- `UsageGuard`: under-limit pass, over-limit throw, concurrent increments, month boundary
- `OpinionCacheService`: cache hit, cache miss, partial-cache handling

### Integration

- End-to-end research flow: search → open opinion → ask broad → ask deep → bookmark → attach to case (stubbed Claude)
- Session persistence: create, refresh session state, restore
- Case linkage: attach bookmark/session to case, verify Case→Research tab view
- Usage increment + billing error: reach limit as Starter, verify block

### E2E (Playwright)

- Happy path: "arbitration clause" search → open first opinion → ask "what's the holding?" → bookmark → attach to case → see in Case→Research tab
- Empty state: zero-result search shows helpful suggestion
- Usage limit: Starter account hits 50 Q&A, verify upsell modal blocks 51st
- Error path: simulate Claude 500, verify no Q&A counted

### Manual UPL audit

Before launch: 20 representative queries against real user scenarios. Verify every response:
- Contains no banned words
- All citations resolve to provided opinions
- Includes UPL footer
- Does not address reader's specific situation

## 15. Success Criteria (UAT)

| # | Criterion |
|---|-----------|
| 1 | Lawyer runs a search with jurisdiction filter; results appear within 3 s |
| 2 | Opinion viewer loads full text on demand within 3 s (first access) / < 500 ms (cached) |
| 3 | Broad Q&A over 10 opinions returns cited answer within 20 s (streaming) |
| 4 | Deep Q&A over a single opinion returns cited answer within 15 s (streaming) |
| 5 | Every assistant message cites at least one opinion; 0 hallucinated citations in 20-query manual audit |
| 6 | Session auto-saves; page refresh restores full state |
| 7 | Bookmark star toggles; bookmark list page shows added opinion with user note |
| 8 | Attaching a bookmark to a case creates activity-log entry and notification to assignees |
| 9 | Starter account hits 50 Q&A in a month; 51st request is blocked with upsell |
| 10 | Every AI response includes UPL footer |
| 11 | Banned-words filter rewrites "you should" → "consider" in at least one test scenario |
| 12 | CourtListener down → UI shows friendly error and retry |
| 13 | All 6 jurisdictions (federal + CA, NY, TX, FL, IL) return results for a common query |

## 16. Open Questions / Decisions Log

| # | Decision | Rationale |
|---|----------|-----------|
| Q1 | 2.2 = Legal Research | Per roadmap in `project_clearterms.md` |
| Q2 | Jurisdiction = US | Confirmed by user |
| Q3 | Primary scenarios = all four integrated (case law, Q&A, memo, statutes) | User chose "all together"; split across 2.2.1–2.2.4 |
| Q4 | Case-linked = standalone + optional link (Approach B) | Matches real lawyer workflow; research sometimes pre-case |
| Q5 | Decomposition = thin vertical slices | Each subphase ships end-to-end value |
| Q6 | Coverage = federal + CA, NY, TX, FL, IL | Top US litigation volume; balanced MVP |
| Q7 | Data strategy = hybrid (Approach C) | Zero-storage MVP, clean migration to semantic |
| Q8 | AI Q&A scope = broad RAG + deep read (Approach C) | Two distinct lawyer workflows |
| Q9 | Billing = hybrid (Approach D) | Search free, Q&A tiered, memo on credits |
| Q10 | MVP scope = sessions + bookmarks + case linkage (Approach B) | Folders/team sharing/Bluebook export deferred to 2.2.4 |
| Architecture | Approach 1 (thin API proxy + Claude RAG) | Fastest MVP, clean migration path |

## 17. Migration Path (Post-2.2.1)

- **2.2.2** adds `cached_statutes` and `statute_bookmarks` tables; reuses search + viewer UI shells
- **2.2.3** introduces `memos` table, consumes `opinion_bookmarks` and `research_chat_messages` as inputs
- **2.2.4** adds `research_folders`, `research_tags`, team visibility flags on sessions/bookmarks, Bluebook export service
- **Phase 3 semantic upgrade:** add pgvector extension, embed all `cached_opinions.full_text` asynchronously, layer semantic re-rank on top of CourtListener keyword; no schema break

---

**End of spec.**
