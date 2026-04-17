# Phase 2.2.2 — Statutes & Regulations Lookup

**Status:** Design approved 2026-04-17. Branch: TBD (`feature/2.2.2-statutes-regulations` expected).
**Spec author:** Claude (via brainstorming skill), with user review 2026-04-17.
**Parent:** Phase 2.2 Legal Research. Builds on shipped 2.2.1 (PR #6).
**Estimated scope:** ~18 tasks across 6 chunks. Backend-heavy; ~55% of 2.2.1's effort.

---

## 1. Summary

Add federal U.S. Code (USC) and Code of Federal Regulations (CFR) retrieval to the research hub. Discovery is **AI-first** — user asks `askBroad` / `askDeep` in the same chat panel built for 2.2.1; Claude decides when a question needs statutory retrieval and pulls sections live via two new API clients. Hub search bar remains case-law-only in MVP; explicit statute search UI deferred.

## 2. Scope

**In scope (2.2.2 MVP):**
- Federal USC + federal CFR
- `CongressGovClient` (USC) + `EcfrClient` (CFR)
- `cached_statutes` table with on-demand population (mirrors `cached_opinions`)
- Citation parser (USC + CFR) and validator extensions
- `LegalRagService` retrieval extension: parallel opinion + statute retrieval; unified context assembly
- Statute viewer route `/research/statutes/[citationSlug]`
- `CitationChip` extended to detect and link USC/CFR citations
- Extended E2E smoke test + UPL audit (5 statute queries added)

**Out of scope (deferred):**
- State statutes (any state)
- Explicit statute search bar in the hub UI
- Statute bookmarks (will be first-class in 2.2.3 Memo Generation)
- Historical/versioned statute text (current only)
- Bulk USC/CFR corpus ingest

## 3. Key decisions locked

| Decision | Choice | Rationale |
|---|---|---|
| Corpus scope | Federal only | Covers ~70% real-world queries; state adds 3× data-source complexity |
| Data sources | eCFR (CFR) + Congress.gov (USC) — dual client | Official, free, section-level JSON; no scraping |
| Discovery model | AI-first (option D) | Reuses 2.2.1 chat UI; Claude chooses retrieval path |
| UX integration | Unified `/research` hub (option A) | Users often don't know if answer is statute vs case; one chat is natural |
| Hub search | Case-law only in MVP | Keeps scope tight; statutes reach users via AI |
| Data model | Separate `cached_statutes` table | Clearer than a discriminator on `cached_opinions`; schema asymmetries |
| Bookmarks | Opinions only in MVP | Statute bookmarks deferred to 2.2.3 |

## 4. Architecture

```
LegalRagService.askBroad(question)
 ├─ parseCitations(question) → explicit USC/CFR citations
 ├─ parallel retrieval:
 │    ├─ CourtListenerClient.search(question)          # existing (cases)
 │    ├─ CongressGovClient.lookupUscSection / search   # NEW
 │    └─ EcfrClient.lookupCfrSection / searchCfr       # NEW
 ├─ hydrateStatutes (concurrency 5, on-demand fetch of bodyText)
 ├─ assembleContext → opinions + statutes + question
 ├─ Claude stream (same model/effort/cache_control as 2.2.1)
 ├─ applyUplFilter + validateCitations(text, [...caseCitations, ...statuteCitations])
 ├─ re-prompt once on ≥2 unverified (unchanged logic)
 └─ persist assistant message with both opinionContextIds + statuteContextIds
```

## 5. Data model

### New table `cached_statutes`

```ts
pgEnum("statute_source", ["usc", "cfr"])

pgTable("cached_statutes", {
  id: uuid().primaryKey().defaultRandom(),
  source: statuteSourceEnum.notNull(),
  citationBluebook: text().notNull(),     // "42 U.S.C. § 1983"
  title: text().notNull(),                // "42" (USC title) or "28" (CFR title)
  chapter: text(),                        // optional
  section: text().notNull(),              // "1983" or "35.104"
  heading: text(),
  bodyText: text(),                       // null until first getOrFetch
  effectiveDate: date(),
  metadata: jsonb<{
    url?: string;
    parentTitleHeading?: string;
    crossRefs?: string[];
    enrichmentStatus?: "pending" | "done" | "failed";
  }>().default({}).notNull(),
  firstCachedAt, lastAccessedAt: timestamptz.defaultNow().notNull(),
}, (t) => [
  uniqueIndex("cached_statutes_source_citation_unique").on(t.source, t.citationBluebook),
  index("cached_statutes_source_section_idx").on(t.source, t.title, t.section),
])
```

### Migration to `research_chat_messages`

Add non-null `jsonb` column `statute_context_ids` typed as `string[]` in Drizzle (`.$type<string[]>()`) with default `[]` — mirrors the exact shape of existing `opinion_context_ids`. Backwards compat preserved.

### Env vars

- `CONGRESS_GOV_API_KEY` — required; instant free signup at api.congress.gov. 5000 req/hour. Auth via `?api_key=` query param (project convention; `X-Api-Key` header also supported but query param is simpler for the `fetch` wrapper).
- eCFR needs no key.

## 6. API clients

### `CongressGovClient` — `src/server/services/uscode/client.ts`

```ts
class CongressGovClient {
  constructor(deps: { apiKey: string; fetchImpl?: typeof fetch });
  async lookupUscSection(title: number, section: string): Promise<UscSectionResult | null>;
  async searchUsc(query: string, limit?: number): Promise<UscSectionResult[]>;
}
```

Retry: 3x exponential backoff on 5xx/429 (reuse CourtListener client pattern). On retry exhaustion, throw `CongressGovError` (named class); callers decide fallback. `StatuteCacheService.getOrFetch` catches the error and returns the metadata row with `enrichmentStatus: "failed"` so the RAG context can skip the section gracefully. Normalize successful responses to `UscSectionResult` matching `cached_statutes` row-insert.

### `EcfrClient` — `src/server/services/ecfr/client.ts`

```ts
class EcfrClient {
  constructor(deps?: { fetchImpl?: typeof fetch });
  async lookupCfrSection(title: number, section: string): Promise<CfrSectionResult | null>;
  async searchCfr(query: string, limit?: number): Promise<CfrSectionResult[]>;
}
```

eCFR API base: `https://www.ecfr.gov/api`. Endpoint paths below are **provisional and must be WebFetch-verified against the current eCFR API docs in the implementation plan's Task 4** before coding — the eCFR API has moved under `/search/v1/` and `/versioner/v1/` namespaces with XML/JSON variants:

- Full-text search: `/search/v1/results?query=...` (JSON)
- Section lookup (by title+section, current date): `/versioner/v1/structure/{date}/title-{n}.json` for the TOC + node lookup, OR `/versioner/v1/full/{date}/title-{n}.xml` for the full title XML (parse to extract section). Prefer structure+node fetch when available; fall back to full-title XML parse only if the API no longer exposes node-level JSON.

On retry exhaustion: throw `EcfrError` (parallel to `CongressGovError`). Cache service catches it and marks `enrichmentStatus: "failed"`. Same graceful-degradation contract.

### `StatuteCacheService` — `src/server/services/research/statute-cache.ts`

Mirrors `OpinionCacheService`. Methods:
- `upsertSearchHit(source, hit)` — metadata-only upsert
- `getOrFetch(internalId)` — return row; if `bodyText` null, fetch via appropriate client, upsert body
- `getByInternalIds(ids: string[])` — batch

Dependency-inject `db` + `congressGov` + `ecfr` clients.

## 7. Citation parser

`src/server/services/research/citation-parser.ts`

```ts
export type ParsedCitation =
  | { source: "case"; citation: string }
  | { source: "usc"; title: number; section: string; citation: string }
  | { source: "cfr"; title: number; section: string; citation: string };

export function parseCitations(text: string): ParsedCitation[];
```

Regex pool:
- USC (single section only — ranges explicitly **not** supported in MVP): `\b(\d+)\s+U\.S\.C\.\s+§§?\s*(\d+[a-z]?)\b` — captures forms like `42 U.S.C. § 1983`, `42 U.S.C. § 1983a`. Ranges like `42 U.S.C. §§ 1981-1988` are detected as citations (via `§§`) but their section string is truncated to the first number; the parser emits ONE `ParsedCitation` for the first section only. Range-handling is deferred (2.2.2b).
- CFR (includes common subpart forms): `\b(\d+)\s+C\.?F\.?R\.?\s+§§?\s*(\d+\.\d+[a-z]?(?:\([a-z0-9]+\))*)\b` — captures `28 C.F.R. § 35.104`, `28 CFR § 35.130a`, `28 C.F.R. § 35.104(a)(2)`. Subpart designators are preserved in the `section` string for downstream lookup.
- Case reporters: reuse existing `REPORTER_PATTERNS` from `citation-validator.ts`.

Tolerate minor whitespace/punctuation variance. Do NOT auto-recognize citation-free forms:
- `§ 1983` alone (no title prefix)
- Bare numeric sections without `U.S.C.`/`CFR`
- USC section ranges (documented above)

All three are known limitations; `citation-parser.test.ts` asserts they return empty/first-only.

### Citation validator extension

`extractCitations(text)` adds USC/CFR patterns to the existing pool. `validateCitations` accepts mixed opinion+statute `contextCitations` — same normalization (lowercase + whitespace-collapse + period-strip) works across all three.

## 8. LegalRagService extension

### `askBroad` changes

1. `const cited = parseCitations(question);`
2. `Promise.all([retrieveOpinions(q, topN), retrieveStatutes(q, cited)])`.
3. `retrieveStatutes` strategy:
   - For each explicit `cited` USC/CFR → `statuteCache.upsertFromLookup` (fires client lookup, upserts)
   - If none cited AND question is statute-oriented — triggers only when ANY of:
     - `§` character present, OR
     - literal `"statute"` / `"regulation"` (case-insensitive) present, OR
     - `\d+\s+(U\.S\.C\.|C\.F\.R\.|USC|CFR)` pattern matches
     - (`"section"` alone is explicitly NOT a trigger — too many false positives in non-statutory legal questions)
     - Then: `EcfrClient.searchCfr(q, 3)` + `CongressGovClient.searchUsc(q, 3)`; take top 5 by relevance
   - Else return `[]` (pure case-law questions skip — cheap guard)
4. `hydrateStatutes(hits)` — parallel body fetch, concurrency 5.
5. Assemble context:
   ```
   <opinions>...</opinions>
   <statutes>
     <usc>## 42 U.S.C. § 1983\n{body}</usc>
     <cfr>## 28 C.F.R. § 35.104\n{body}</cfr>
   </statutes>
   {question}
   ```
6. Stream Claude (same knobs).
7. Post-stream: `validateCitations(text, [...caseCitations, ...statuteCitations])`; re-prompt on ≥2 unverified.
8. Persist assistant msg with both `opinionContextIds` + `statuteContextIds`.

### `askDeep` changes

Input union accepts either `opinionInternalId` OR `statuteInternalId`. Context is single source. System prompt unchanged.

### SYSTEM_PROMPT append

> The provided materials may include case opinions AND statutory/regulatory sections (U.S.C. and C.F.R.). Cite U.S.C. sections as `42 U.S.C. § 1983` and C.F.R. sections as `28 C.F.R. § 35.104`. Cases remain cited via Bluebook reporter format. Every factual claim about law must cite one of the provided materials.

## 9. Router + frontend

### `research` router additions

- `research.statutes.get({ citationSlug | internalId | {source, title, section} })` — query; resolves to row; on miss, fetch; dispatch Inngest `research/statute.enrich.requested` (no-op body placeholder for 2.2.3).
- `research.statutes.lookup({ citation: string })` — mutation; parse + upsert; returns `internalId`.
- `askDeep` input union extended (`opinionInternalId` | `statuteInternalId`).
- `askBroad` input unchanged externally; internal retrieval changes.

### Frontend (minimal)

- **New route** `/research/statutes/[citationSlug]/page.tsx`
- **New components** `statute-viewer.tsx`, `statute-header.tsx` (mirror opinion-viewer/header)
- **Extend** `citation-chip.tsx`: detect USC/CFR → link to statute viewer
- **Utility** `src/components/research/citation-to-url.ts`: `citationToUrl(citation: string): string | null` — returns slug path (e.g. `/research/statutes/42-usc-1983`) or null for unrecognized formats. Used by `citation-chip.tsx` and any other component needing statute navigation.
- **Layout** hide right-rail on `/research/statutes/*` (parallel to opinions)
- **No changes** to ResultsList, ResultCard, hub page, sessions sidebar, bookmarks page

### Bookmarks — no changes

Statutes are not bookmarkable in 2.2.2 MVP. Opinion bookmarks behavior unchanged.

## 10. Inngest

Register a stub `research-enrich-statute` function (matches `research-enrich-opinion` pattern from 2.2.1 Task 26). Body is a no-op in 2.2.2 — reserved for 2.2.3 citator/cross-ref enrichment.

## 11. Testing

| Scope | File | Cases |
|---|---|---|
| Citation parser | `tests/unit/citation-parser.test.ts` | 10–12 (each USC/CFR variant + mixed + no-citation + false positives) |
| Validator extension | extend `tests/unit/citation-validator.test.ts` | +4 USC/CFR cases |
| Congress.gov client | `tests/unit/uscode-client.test.ts` | lookup ok, not-found, search, retry on 5xx, rate-limit 429, retry-exhaustion throws `CongressGovError` |
| eCFR client | `tests/unit/ecfr-client.test.ts` | same shape; retry-exhaustion throws `EcfrError` |
| StatuteCacheService | `tests/integration/statute-cache.test.ts` | mirrors opinion-cache (upsert, getOrFetch, getByInternalIds) |
| LegalRag extensions | extend `tests/integration/legal-rag.test.ts` | +3–4 (explicit citation → lookup, mixed context, statute-only askDeep, unverified USC flagged) |
| Router extensions | extend `research-router.test.ts` | `statutes.get` hit/miss, `statutes.lookup`, `askDeep` statute variant |
| E2E smoke | extend `e2e/research.spec.ts` | `/research/statutes/<slug>` status<500 |

UI components: no unit tests (project convention).

## 12. UPL audit additions

Append 5 statute-oriented queries to `docs/upl-audits/2.2.1-research-audit.md` or create a separate 2.2.2 audit file. Queries should cover:
- Direct USC lookup (e.g. "interpret 42 U.S.C. § 1983")
- Direct CFR lookup (e.g. "explain 28 CFR § 35.104")
- Mixed question (e.g. "what cases apply § 1983?")
- Regulation+case cross-reference
- Question where statute doesn't exist (verify "not addressed" language)

Same 5-point review rubric: banned words, verified citations, UPL footer, no predictive language, grounding.

## 13. Implementation chunking

6 chunks, ~18 tasks.

**Chunk 1 — Schema + clients (4 tasks):**
1. Env var + template + test stub.
2. `cached_statutes` schema + migration + `statute_context_ids` column.
3. `CongressGovClient` + unit tests.
4. `EcfrClient` + unit tests.

**Chunk 2 — Caching + parser (3 tasks):**
5. `citation-parser.ts` + tests.
6. Validator extension + new tests.
7. `StatuteCacheService` + tests.

**Chunk 3 — RAG retrieval layer (2 tasks):**
8. `askBroad` mixed retrieval + tests.
9. `askDeep` statute variant + tests.

**Chunk 4 — Router + dispatch (2 tasks):**
10. `research.statutes.get` + `research.statutes.lookup` + router tests.
11. Inngest `research-enrich-statute` stub registration.

**Chunk 5 — Frontend (3 tasks):**
12. `statute-viewer.tsx` + `statute-header.tsx`.
13. `/research/statutes/[citationSlug]/page.tsx` + slug parser.
14. `citation-chip.tsx` extension + layout right-rail suppression.

**Chunk 6 — Integration + ship (3 tasks):**
15. Extend E2E smoke tests.
16. UPL audit additions.
17. Final verification (tsc + vitest + build + push + PR).

## 14. Risks + known limitations

| Risk | Mitigation |
|---|---|
| Congress.gov USC search is TOC-oriented, not full-text | Accept; document known limitation; UI suggests explicit citations when AI can't find relevant statutes |
| eCFR full-text ranking is opaque | Top-5 retrieval is good enough for RAG context; if quality issues surface in UPL audit, add re-ranking |
| Citation parser false positives on ambiguous forms (`§ 1983` alone) | Tight regex; require full `42 U.S.C. § 1983` form; document in tests |
| 5000 req/hour Congress.gov limit on free tier | Expected load is low (most queries cite 0–2 statutes); monitor; bump to paid tier if ever needed |
| LegalRagService file growth | Accept — extensions are additive; keep retrieval helpers as private methods |

## 15. Success criteria

- [ ] `/research/statutes/42-usc-1983` renders section text within 3s (cold fetch, measured from request arrival to first paint of body)
- [ ] `askBroad` end-to-end latency for mixed-retrieval questions (first token) ≤ 6s P95 (vs ~4s P95 for pure case-law in 2.2.1); measured against a 10-question benchmark
- [ ] `askBroad` with question containing "42 U.S.C. § 1983" includes that section in context and cites it in response
- [ ] `askBroad` with statute-oriented question but no explicit citation retrieves at least one USC or CFR section (when relevant)
- [ ] Citation validator correctly partitions USC/CFR/case citations as verified/unverified
- [ ] All existing 2.2.1 tests remain green
- [ ] New tests pass (10+ new test files, ~60+ new test cases expected)
- [ ] Typecheck clean, build succeeds, smoke E2E passes
- [ ] UPL audit passes ≥4/5 statute queries
- [ ] Client retry exhaustion path produces `enrichmentStatus: "failed"` metadata on the cached_statutes row and the RAG flow continues without crashing

## 16. Open questions (resolved during brainstorm)

All brainstorm questions resolved. No open items requiring user input before implementation.

---

**Next step:** invoke `superpowers:writing-plans` skill after user approves this spec.
