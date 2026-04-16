# 2.2.1 Case Law Search + AI Q&A — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a self-contained legal research workspace for US lawyers: CourtListener-powered case law search, on-demand opinion viewer, two AI Q&A modes (broad RAG + deep read) with UPL guardrails, auto-saved research sessions, opinion bookmarks, and optional case linkage.

**Architecture:** Thin API proxy over CourtListener with on-demand full-text caching in Postgres. Claude RAG assembles opinion context per request — no vector DB. Research sessions + chat + bookmarks as standard Drizzle tables. Billing: search free, AI Q&A tiered monthly (Starter 50 / Pro 500 / Business ∞). UPL pipeline reuses Phase 1 banned-words filter plus a new citation validator.

**Tech Stack:** Next.js 16, tRPC 11, Drizzle ORM, PostgreSQL (Supabase), AWS S3, Zod v4, Claude API (sonnet-4-6), Inngest v4, shadcn/ui + Tailwind, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-04-16-case-law-search-ai-qa-design.md`

---

## Chunk 1: Database schema & migration

### Task 1: Add research_sessions, research_queries, research_chat_messages schemas

**Files:**
- Create: `src/server/db/schema/research-sessions.ts`
- Create: `src/server/db/schema/research-queries.ts`
- Create: `src/server/db/schema/research-chat-messages.ts`

- [x] **Step 1: Create `src/server/db/schema/research-sessions.ts`**

```ts
import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { cases } from "./cases";

export const researchSessions = pgTable(
  "research_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    jurisdictionFilter: jsonb("jurisdiction_filter").$type<{
      jurisdictions?: string[];
      courtLevels?: string[];
      fromYear?: number;
      toYear?: number;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userUpdatedIdx: index("research_sessions_user_updated_idx").on(t.userId, t.deletedAt, t.updatedAt.desc()),
    caseIdx: index("research_sessions_case_idx").on(t.caseId),
  }),
);

export type ResearchSession = typeof researchSessions.$inferSelect;
export type NewResearchSession = typeof researchSessions.$inferInsert;
```

- [x] **Step 2: Create `src/server/db/schema/research-queries.ts`**

```ts
import { pgTable, uuid, text, jsonb, integer, timestamp, index } from "drizzle-orm/pg-core";
import { researchSessions } from "./research-sessions";

export const researchQueries = pgTable(
  "research_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => researchSessions.id, { onDelete: "cascade" }),
    queryText: text("query_text").notNull(),
    filters: jsonb("filters").$type<{
      jurisdictions?: string[];
      courtLevels?: string[];
      fromYear?: number;
      toYear?: number;
      courtName?: string;
    }>(),
    resultCount: integer("result_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sessionIdx: index("research_queries_session_idx").on(t.sessionId, t.createdAt.desc()),
  }),
);

export type ResearchQuery = typeof researchQueries.$inferSelect;
export type NewResearchQuery = typeof researchQueries.$inferInsert;
```

- [x] **Step 3: Create `src/server/db/schema/research-chat-messages.ts`**

```ts
import { pgTable, uuid, text, jsonb, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { researchSessions } from "./research-sessions";

export const researchChatRoleEnum = pgEnum("research_chat_role", ["user", "assistant"]);
export const researchChatModeEnum = pgEnum("research_chat_mode", ["broad", "deep"]);

export const researchChatMessages = pgTable(
  "research_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => researchSessions.id, { onDelete: "cascade" }),
    role: researchChatRoleEnum("role").notNull(),
    content: text("content").notNull(),
    mode: researchChatModeEnum("mode"),
    opinionId: uuid("opinion_id"),
    opinionContextIds: jsonb("opinion_context_ids").$type<string[]>().default([]).notNull(),
    tokensUsed: integer("tokens_used").default(0).notNull(),
    flags: jsonb("flags").$type<{
      unverifiedCitations?: string[];
      uplViolations?: string[];
    }>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sessionIdx: index("research_chat_session_idx").on(t.sessionId, t.createdAt.asc()),
  }),
);

export type ResearchChatMessage = typeof researchChatMessages.$inferSelect;
export type NewResearchChatMessage = typeof researchChatMessages.$inferInsert;
```

Note: `opinionContextIds` is a JSON array of `cached_opinions.id`. FK integrity enforced at service layer (Postgres array columns cannot enforce FK).

- [x] **Step 4: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/server/db/schema/research-sessions.ts src/server/db/schema/research-queries.ts src/server/db/schema/research-chat-messages.ts
git commit -m "feat: add research sessions/queries/chat schemas"
```

---

### Task 2: Add cached_opinions, opinion_bookmarks, research_usage schemas

**Files:**
- Create: `src/server/db/schema/cached-opinions.ts`
- Create: `src/server/db/schema/opinion-bookmarks.ts`
- Create: `src/server/db/schema/research-usage.ts`

- [ ] **Step 1: Create `src/server/db/schema/cached-opinions.ts`**

```ts
import { pgTable, uuid, text, bigint, jsonb, timestamp, date, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";

export const jurisdictionEnum = pgEnum("research_jurisdiction", ["federal", "ca", "ny", "tx", "fl", "il"]);
export const courtLevelEnum = pgEnum("research_court_level", [
  "scotus",
  "circuit",
  "district",
  "state_supreme",
  "state_appellate",
]);

export const cachedOpinions = pgTable(
  "cached_opinions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courtlistenerId: bigint("courtlistener_id", { mode: "number" }).notNull(),
    citationBluebook: text("citation_bluebook").notNull(),
    caseName: text("case_name").notNull(),
    court: text("court").notNull(),
    jurisdiction: jurisdictionEnum("jurisdiction").notNull(),
    courtLevel: courtLevelEnum("court_level").notNull(),
    decisionDate: date("decision_date").notNull(),
    fullText: text("full_text"),
    snippet: text("snippet"),
    metadata: jsonb("metadata").$type<{
      judges?: string[];
      syllabusUrl?: string;
      citedByCount?: number;
      citesTo?: string[];
      enrichmentStatus?: "pending" | "done" | "failed";
    }>().default({}).notNull(),
    firstCachedAt: timestamp("first_cached_at", { withTimezone: true }).defaultNow().notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    courtlistenerUnique: uniqueIndex("cached_opinions_courtlistener_unique").on(t.courtlistenerId),
    jurisdictionDateIdx: index("cached_opinions_juris_date_idx").on(t.jurisdiction, t.decisionDate.desc()),
  }),
);

export type CachedOpinion = typeof cachedOpinions.$inferSelect;
export type NewCachedOpinion = typeof cachedOpinions.$inferInsert;
```

- [ ] **Step 2: Create `src/server/db/schema/opinion-bookmarks.ts`**

```ts
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { cases } from "./cases";
import { cachedOpinions } from "./cached-opinions";

export const opinionBookmarks = pgTable(
  "opinion_bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    opinionId: uuid("opinion_id").notNull().references(() => cachedOpinions.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userOpinionUnique: uniqueIndex("opinion_bookmarks_user_opinion_unique").on(t.userId, t.opinionId),
    userCreatedIdx: index("opinion_bookmarks_user_created_idx").on(t.userId, t.createdAt.desc()),
    caseIdx: index("opinion_bookmarks_case_idx").on(t.caseId),
  }),
);

export type OpinionBookmark = typeof opinionBookmarks.$inferSelect;
export type NewOpinionBookmark = typeof opinionBookmarks.$inferInsert;
```

- [ ] **Step 3: Create `src/server/db/schema/research-usage.ts`**

```ts
import { pgTable, uuid, char, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

export const researchUsage = pgTable(
  "research_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    month: char("month", { length: 7 }).notNull(), // "YYYY-MM"
    qaCount: integer("qa_count").notNull().default(0),
    memoCount: integer("memo_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userMonthUnique: uniqueIndex("research_usage_user_month_unique").on(t.userId, t.month),
  }),
);

export type ResearchUsage = typeof researchUsage.$inferSelect;
export type NewResearchUsage = typeof researchUsage.$inferInsert;
```

- [ ] **Step 4: Export new schemas from barrel**

Modify `src/server/db/schema/index.ts` (or wherever the project re-exports schemas). Check the existing pattern first with:

```bash
cat src/server/db/schema/index.ts | head
```

Add exports:

```ts
export * from "./research-sessions";
export * from "./research-queries";
export * from "./research-chat-messages";
export * from "./cached-opinions";
export * from "./opinion-bookmarks";
export * from "./research-usage";
```

(If the project imports schemas directly without a barrel, skip this step.)

- [ ] **Step 5: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema/cached-opinions.ts src/server/db/schema/opinion-bookmarks.ts src/server/db/schema/research-usage.ts src/server/db/schema/index.ts
git commit -m "feat: add cached opinions, bookmarks, and usage schemas"
```

---

### Task 3: Generate and apply migration

**Files:**
- Create: `drizzle/XXXX_research_tables.sql` (auto-generated)

- [ ] **Step 1: Generate migration**

Run: `npx drizzle-kit generate`
Expected: creates new migration file in `drizzle/` directory.

- [ ] **Step 2: Inspect migration SQL**

Read the newly generated migration file. Verify:
- All 6 tables created
- Enums `research_chat_role`, `research_chat_mode`, `research_jurisdiction`, `research_court_level` created
- Unique indexes on `cached_opinions.courtlistener_id` and `opinion_bookmarks (user_id, opinion_id)` and `research_usage (user_id, month)`
- FK constraints correct (especially `cases.id` nullable cascades to SET NULL)

- [ ] **Step 3: Apply migration**

Run: `npx drizzle-kit push`
Expected: migration applied to Supabase Postgres.

- [ ] **Step 4: Commit**

```bash
git add drizzle/
git commit -m "chore: generate migration for research tables"
```

---

**End of Chunk 1.** Six new tables with indexes, enums, and migration applied. Next chunk: CourtListener client service.

---

## Chunk 2: CourtListener client & OpinionCacheService

### Task 4: Add COURTLISTENER_API_TOKEN env var

**Files:**
- Modify: `src/env.ts` (or wherever env schema lives — check existing pattern)
- Modify: `.env.example`

- [ ] **Step 1: Inspect env pattern**

Run: `grep -r "STRIPE_SECRET_KEY\|ANTHROPIC_API_KEY" src/env.ts src/config/ 2>/dev/null | head -5`

Identify the env schema file (likely `src/env.ts` or `src/env.mjs` using `@t3-oss/env-nextjs`).

- [ ] **Step 2: Add COURTLISTENER_API_TOKEN to server-side env schema**

Add to `server: { ... }` block:

```ts
COURTLISTENER_API_TOKEN: z.string().min(1),
```

- [ ] **Step 3: Add to `.env.example`**

```
COURTLISTENER_API_TOKEN=your_courtlistener_api_token_here
```

(User must register at https://www.courtlistener.com/help/api/rest/#authentication for a free token.)

- [ ] **Step 4: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/env.ts .env.example
git commit -m "feat: add COURTLISTENER_API_TOKEN env var"
```

---

### Task 5: CourtListener client — types and skeleton

**Files:**
- Create: `src/server/services/courtlistener/types.ts`
- Create: `src/server/services/courtlistener/client.ts`
- Create: `tests/unit/courtlistener-client.test.ts`

- [ ] **Step 1: Create `src/server/services/courtlistener/types.ts`**

```ts
export type Jurisdiction = "federal" | "ca" | "ny" | "tx" | "fl" | "il";
export type CourtLevel = "scotus" | "circuit" | "district" | "state_supreme" | "state_appellate";

export interface SearchFilters {
  jurisdictions?: Jurisdiction[];
  courtLevels?: CourtLevel[];
  fromYear?: number;
  toYear?: number;
  courtName?: string;
}

export interface SearchParams {
  query: string;
  filters?: SearchFilters;
  page?: number; // 1-indexed
  pageSize?: number; // default 20
}

export interface OpinionSearchHit {
  courtlistenerId: number;
  caseName: string;
  court: string; // court slug, e.g., "ca9"
  jurisdiction: Jurisdiction;
  courtLevel: CourtLevel;
  decisionDate: string; // ISO date
  citationBluebook: string;
  snippet: string;
}

export interface SearchResponse {
  hits: OpinionSearchHit[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface OpinionDetail {
  courtlistenerId: number;
  caseName: string;
  court: string;
  jurisdiction: Jurisdiction;
  courtLevel: CourtLevel;
  decisionDate: string;
  citationBluebook: string;
  fullText: string;
  judges?: string[];
  syllabusUrl?: string;
  citedByCount?: number;
}
```

- [ ] **Step 2: Write failing test `tests/unit/courtlistener-client.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CourtListenerClient } from "@/server/services/courtlistener/client";

describe("CourtListenerClient", () => {
  let client: CourtListenerClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    client = new CourtListenerClient({ apiToken: "test-token", fetchImpl: fetchMock });
  });

  it("builds search URL with query and jurisdiction filter", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ count: 0, results: [] }),
    });

    await client.search({
      query: "arbitration clause",
      filters: { jurisdictions: ["ca", "ny"] },
      page: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/rest/v4/search/");
    expect(url).toContain("type=o");
    expect(url).toContain("q=arbitration+clause");
    expect(url).toContain("court=cal%2Cny");
    expect(init.headers.Authorization).toBe("Token test-token");
  });

  it("normalizes search response to OpinionSearchHit[]", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        count: 1,
        results: [
          {
            id: 12345,
            caseName: "Smith v. Jones",
            court: "ca9",
            court_type: "F",
            dateFiled: "2020-03-15",
            citation: ["987 F.3d 456"],
            snippet: "This case addresses ...",
          },
        ],
      }),
    });

    const resp = await client.search({ query: "test" });
    expect(resp.hits).toHaveLength(1);
    expect(resp.hits[0].courtlistenerId).toBe(12345);
    expect(resp.hits[0].caseName).toBe("Smith v. Jones");
    expect(resp.hits[0].citationBluebook).toBe("987 F.3d 456");
    expect(resp.hits[0].jurisdiction).toBe("federal");
    expect(resp.hits[0].courtLevel).toBe("circuit");
  });

  it("retries on 5xx and succeeds on second attempt", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ count: 0, results: [] }) });

    const resp = await client.search({ query: "x" });
    expect(resp.hits).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws RateLimitError on 429", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(client.search({ query: "x" })).rejects.toThrow(/rate limit/i);
  });

  it("fetches opinion detail by courtlistener id", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 12345,
        caseName: "Smith v. Jones",
        court: "ca9",
        court_type: "F",
        dateFiled: "2020-03-15",
        citation: ["987 F.3d 456"],
        plain_text: "Full opinion text here...",
        judges: "Smith, Jones, Doe",
      }),
    });

    const op = await client.getOpinion(12345);
    expect(op.fullText).toBe("Full opinion text here...");
    expect(op.judges).toEqual(["Smith", "Jones", "Doe"]);
  });
});
```

- [ ] **Step 3: Run test, expect fail**

Run: `npx vitest run tests/unit/courtlistener-client.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/server/services/courtlistener/client.ts`**

```ts
import type {
  Jurisdiction,
  CourtLevel,
  SearchParams,
  SearchResponse,
  OpinionSearchHit,
  OpinionDetail,
} from "./types";

const BASE_URL = "https://www.courtlistener.com";

// Court slug → our jurisdiction/level mapping. Extend as CourtListener adds more.
const COURT_MAP: Record<string, { jurisdiction: Jurisdiction; level: CourtLevel; reporterPrefix?: string }> = {
  scotus: { jurisdiction: "federal", level: "scotus" },
  ca1: { jurisdiction: "federal", level: "circuit" },
  ca2: { jurisdiction: "federal", level: "circuit" },
  ca3: { jurisdiction: "federal", level: "circuit" },
  ca4: { jurisdiction: "federal", level: "circuit" },
  ca5: { jurisdiction: "federal", level: "circuit" },
  ca6: { jurisdiction: "federal", level: "circuit" },
  ca7: { jurisdiction: "federal", level: "circuit" },
  ca8: { jurisdiction: "federal", level: "circuit" },
  ca9: { jurisdiction: "federal", level: "circuit" },
  ca10: { jurisdiction: "federal", level: "circuit" },
  ca11: { jurisdiction: "federal", level: "circuit" },
  cadc: { jurisdiction: "federal", level: "circuit" },
  cafc: { jurisdiction: "federal", level: "circuit" },
  cal: { jurisdiction: "ca", level: "state_supreme" },
  calctapp: { jurisdiction: "ca", level: "state_appellate" },
  ny: { jurisdiction: "ny", level: "state_supreme" },
  nyappdiv: { jurisdiction: "ny", level: "state_appellate" },
  tex: { jurisdiction: "tx", level: "state_supreme" },
  texapp: { jurisdiction: "tx", level: "state_appellate" },
  fla: { jurisdiction: "fl", level: "state_supreme" },
  fladistctapp: { jurisdiction: "fl", level: "state_appellate" },
  ill: { jurisdiction: "il", level: "state_supreme" },
  illappct: { jurisdiction: "il", level: "state_appellate" },
};

// Courts that a jurisdiction filter should map to (for the `court=` query param).
const JURISDICTION_COURTS: Record<Jurisdiction, string[]> = {
  federal: ["scotus", "ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11", "cadc", "cafc"],
  ca: ["cal", "calctapp"],
  ny: ["ny", "nyappdiv"],
  tx: ["tex", "texapp"],
  fl: ["fla", "fladistctapp"],
  il: ["ill", "illappct"],
};

export class CourtListenerRateLimitError extends Error {
  constructor() {
    super("CourtListener rate limit exceeded");
    this.name = "CourtListenerRateLimitError";
  }
}

export class CourtListenerError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "CourtListenerError";
  }
}

export interface CourtListenerClientOptions {
  apiToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class CourtListenerClient {
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(opts: CourtListenerClientOptions) {
    this.apiToken = opts.apiToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const url = this.buildSearchUrl(params);
    const raw = await this.requestJson<any>(url);
    return {
      hits: (raw.results ?? []).map((r: any) => this.normalizeHit(r)).filter(Boolean) as OpinionSearchHit[],
      totalCount: raw.count ?? 0,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    };
  }

  async getOpinion(courtlistenerId: number): Promise<OpinionDetail> {
    const url = `${this.baseUrl}/api/rest/v4/opinions/${courtlistenerId}/`;
    const raw = await this.requestJson<any>(url);
    const normalized = this.normalizeHit(raw);
    if (!normalized) throw new CourtListenerError(`Unmappable opinion ${courtlistenerId}`);
    return {
      ...normalized,
      fullText: raw.plain_text ?? raw.html_with_citations ?? "",
      judges: raw.judges ? String(raw.judges).split(",").map((j: string) => j.trim()).filter(Boolean) : [],
      syllabusUrl: raw.syllabus_url,
      citedByCount: raw.citation_count,
    };
  }

  private buildSearchUrl(params: SearchParams): string {
    const sp = new URLSearchParams();
    sp.set("type", "o");
    sp.set("q", params.query);
    sp.set("page", String(params.page ?? 1));
    sp.set("page_size", String(params.pageSize ?? 20));

    if (params.filters?.jurisdictions?.length) {
      const courts = params.filters.jurisdictions
        .flatMap((j) => JURISDICTION_COURTS[j] ?? [])
        .join(",");
      if (courts) sp.set("court", courts);
    }
    if (params.filters?.fromYear) sp.set("filed_after", `${params.filters.fromYear}-01-01`);
    if (params.filters?.toYear) sp.set("filed_before", `${params.filters.toYear}-12-31`);

    return `${this.baseUrl}/api/rest/v4/search/?${sp.toString()}`;
  }

  private normalizeHit(r: any): OpinionSearchHit | null {
    const courtSlug: string = r.court ?? "";
    const mapping = COURT_MAP[courtSlug];
    if (!mapping) return null;
    const citation = Array.isArray(r.citation) ? r.citation[0] : r.citation;
    return {
      courtlistenerId: r.id,
      caseName: r.caseName ?? r.case_name ?? "Unknown case",
      court: courtSlug,
      jurisdiction: mapping.jurisdiction,
      courtLevel: mapping.level,
      decisionDate: r.dateFiled ?? r.date_filed,
      citationBluebook: citation ?? "",
      snippet: r.snippet ?? "",
    };
  }

  private async requestJson<T>(url: string, attempt = 0): Promise<T> {
    const resp = await this.fetchImpl(url, {
      headers: { Authorization: `Token ${this.apiToken}`, Accept: "application/json" },
    });
    if (resp.status === 429) throw new CourtListenerRateLimitError();
    if (resp.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      return this.requestJson<T>(url, attempt + 1);
    }
    if (!resp.ok) {
      throw new CourtListenerError(`CourtListener ${resp.status}`, resp.status);
    }
    return (await resp.json()) as T;
  }
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `npx vitest run tests/unit/courtlistener-client.test.ts`
Expected: PASS (5/5).

- [ ] **Step 6: Commit**

```bash
git add src/server/services/courtlistener/ tests/unit/courtlistener-client.test.ts
git commit -m "feat: add CourtListener client with normalization and retry"
```

---

### Task 6: OpinionCacheService

**Files:**
- Create: `src/server/services/research/opinion-cache.ts`
- Create: `tests/integration/opinion-cache.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/server/db";
import { cachedOpinions } from "@/server/db/schema";
import { OpinionCacheService } from "@/server/services/research/opinion-cache";
import { eq } from "drizzle-orm";

describe("OpinionCacheService", () => {
  let clClient: { getOpinion: ReturnType<typeof vi.fn> };
  let svc: OpinionCacheService;

  beforeEach(async () => {
    clClient = { getOpinion: vi.fn() };
    svc = new OpinionCacheService({ db, courtListener: clClient as any });
    await db.delete(cachedOpinions).where(eq(cachedOpinions.courtlistenerId, 999001));
  });

  it("upserts metadata row without full_text", async () => {
    await svc.upsertSearchHit({
      courtlistenerId: 999001,
      caseName: "Test v. Case",
      court: "ca9",
      jurisdiction: "federal",
      courtLevel: "circuit",
      decisionDate: "2021-01-01",
      citationBluebook: "123 F.3d 456",
      snippet: "snip",
    });
    const row = await db.query.cachedOpinions.findFirst({
      where: eq(cachedOpinions.courtlistenerId, 999001),
    });
    expect(row?.fullText).toBeNull();
    expect(row?.caseName).toBe("Test v. Case");
  });

  it("fetches full text on first getOrFetch, caches on subsequent", async () => {
    await svc.upsertSearchHit({
      courtlistenerId: 999001,
      caseName: "Test",
      court: "ca9",
      jurisdiction: "federal",
      courtLevel: "circuit",
      decisionDate: "2021-01-01",
      citationBluebook: "123 F.3d 456",
      snippet: "",
    });

    clClient.getOpinion.mockResolvedValueOnce({
      courtlistenerId: 999001,
      caseName: "Test",
      court: "ca9",
      jurisdiction: "federal",
      courtLevel: "circuit",
      decisionDate: "2021-01-01",
      citationBluebook: "123 F.3d 456",
      fullText: "Full text here",
      judges: [],
    });

    const first = await svc.getOrFetch(999001);
    expect(first.fullText).toBe("Full text here");
    expect(clClient.getOpinion).toHaveBeenCalledTimes(1);

    const second = await svc.getOrFetch(999001);
    expect(second.fullText).toBe("Full text here");
    expect(clClient.getOpinion).toHaveBeenCalledTimes(1); // not called again
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run tests/integration/opinion-cache.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/server/services/research/opinion-cache.ts`**

```ts
import { db as defaultDb } from "@/server/db";
import { cachedOpinions, type CachedOpinion } from "@/server/db/schema";
import type { CourtListenerClient } from "@/server/services/courtlistener/client";
import type { OpinionSearchHit } from "@/server/services/courtlistener/types";
import { eq, sql } from "drizzle-orm";

export interface OpinionCacheDeps {
  db?: typeof defaultDb;
  courtListener: CourtListenerClient;
}

export class OpinionCacheService {
  private readonly db: typeof defaultDb;
  private readonly cl: CourtListenerClient;

  constructor(deps: OpinionCacheDeps) {
    this.db = deps.db ?? defaultDb;
    this.cl = deps.courtListener;
  }

  async upsertSearchHit(hit: OpinionSearchHit): Promise<CachedOpinion> {
    const now = new Date();
    const [row] = await this.db
      .insert(cachedOpinions)
      .values({
        courtlistenerId: hit.courtlistenerId,
        caseName: hit.caseName,
        court: hit.court,
        jurisdiction: hit.jurisdiction,
        courtLevel: hit.courtLevel,
        decisionDate: hit.decisionDate,
        citationBluebook: hit.citationBluebook,
        snippet: hit.snippet,
      })
      .onConflictDoUpdate({
        target: cachedOpinions.courtlistenerId,
        set: {
          snippet: hit.snippet,
          lastAccessedAt: now,
        },
      })
      .returning();
    return row;
  }

  async getOrFetch(courtlistenerId: number): Promise<CachedOpinion> {
    const existing = await this.db.query.cachedOpinions.findFirst({
      where: eq(cachedOpinions.courtlistenerId, courtlistenerId),
    });
    if (existing?.fullText) {
      await this.db
        .update(cachedOpinions)
        .set({ lastAccessedAt: new Date() })
        .where(eq(cachedOpinions.id, existing.id));
      return existing;
    }

    const detail = await this.cl.getOpinion(courtlistenerId);
    const [row] = await this.db
      .insert(cachedOpinions)
      .values({
        courtlistenerId: detail.courtlistenerId,
        caseName: detail.caseName,
        court: detail.court,
        jurisdiction: detail.jurisdiction,
        courtLevel: detail.courtLevel,
        decisionDate: detail.decisionDate,
        citationBluebook: detail.citationBluebook,
        fullText: detail.fullText,
        snippet: existing?.snippet ?? "",
        metadata: {
          judges: detail.judges,
          syllabusUrl: detail.syllabusUrl,
          citedByCount: detail.citedByCount,
        },
      })
      .onConflictDoUpdate({
        target: cachedOpinions.courtlistenerId,
        set: {
          fullText: detail.fullText,
          metadata: sql`${cachedOpinions.metadata} || ${JSON.stringify({
            judges: detail.judges,
            syllabusUrl: detail.syllabusUrl,
            citedByCount: detail.citedByCount,
          })}::jsonb`,
          lastAccessedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async getByInternalIds(ids: string[]): Promise<CachedOpinion[]> {
    if (ids.length === 0) return [];
    return this.db.query.cachedOpinions.findMany({
      where: (t, { inArray }) => inArray(t.id, ids),
    });
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run tests/integration/opinion-cache.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/research/opinion-cache.ts tests/integration/opinion-cache.test.ts
git commit -m "feat: add OpinionCacheService with upsert and on-demand fetch"
```

---

**End of Chunk 2.** CourtListener client + opinion cache shipped with tests. Next: research router and services.

---

## Chunk 3: Research services & non-AI router

Scope: `ResearchSessionService`, `BookmarkService`, `researchRouter` with search, getOpinion, sessions CRUD, bookmarks CRUD. **No AI Q&A yet** (that's Chunk 4).

### Task 7: ResearchSessionService

**Files:**
- Create: `src/server/services/research/session-service.ts`
- Create: `tests/integration/research-session-service.test.ts`

- [ ] **Step 1: Write failing tests**

Test coverage:
- `createSession(userId, firstQuery, filters?, caseId?)` → row inserted, title auto-generated from query (truncated to 80 chars, suffixed with ISO date: `"arbitration clause enforceability — Apr 16"`)
- `appendQuery(sessionId, queryText, filters, resultCount)` → inserts into `research_queries`, bumps `research_sessions.updated_at`
- `listSessions(userId, caseId?)` → filters by soft-delete=null, orders by `updated_at desc`
- `rename(sessionId, userId, title)` → 403 if different user
- `softDelete(sessionId, userId)` → sets `deleted_at`
- `linkToCase(sessionId, userId, caseId | null)` → validates case ownership via `cases` join

- [ ] **Step 2: Run tests, expect fail** · **Step 3: Implement service** following the spec §6 Services table · **Step 4: Run tests, expect pass** · **Step 5: Commit**

```bash
git commit -m "feat: add ResearchSessionService"
```

---

### Task 8: BookmarkService

**Files:**
- Create: `src/server/services/research/bookmark-service.ts`
- Create: `tests/integration/bookmark-service.test.ts`

Test + implement:
- `create(userId, opinionId, notes?, caseId?)` — unique `(user_id, opinion_id)` constraint → on conflict update `notes`/`case_id` instead of insert
- `update(bookmarkId, userId, { notes?, caseId? })` — 403 if not owner; null `caseId` explicitly clears link
- `delete(bookmarkId, userId)` — hard delete
- `listByUser(userId, { caseId? })` — joins `cached_opinions`; if `caseId` provided, filter

Emit activity log + notification when `caseId` set (deferred wiring to Chunk 7, but service exposes a hook).

Commit: `feat: add BookmarkService with case linkage`

---

### Task 9: researchRouter — search, getOpinion, sessions, bookmarks

**Files:**
- Create: `src/server/trpc/routers/research.ts`
- Modify: `src/server/trpc/root.ts` (register router)
- Create: `tests/integration/research-router.test.ts`

Procedures (all `protectedProcedure`, Zod v4 schemas via `zod/v4`):

```
research.search({ query, filters, page, sessionId? })
  → lookup or auto-create session (first query)
  → CourtListenerClient.search() → upsert metadata into cached_opinions
  → append research_queries row
  → return { sessionId, hits: [{ internalId, ...hit }], totalCount, page }

research.getOpinion({ opinionInternalId | courtlistenerId })
  → OpinionCacheService.getOrFetch()
  → dispatch Inngest "research.enrichOpinion" (non-blocking)
  → return opinion with full_text + metadata

research.sessions.list({ caseId? })
research.sessions.get({ sessionId }) — includes queries + chat messages
research.sessions.rename({ sessionId, title })
research.sessions.delete({ sessionId })
research.sessions.linkToCase({ sessionId, caseId | null })

research.bookmarks.list({ caseId? })
research.bookmarks.create({ opinionId, notes?, caseId? })
research.bookmarks.update({ bookmarkId, notes?, caseId? })
research.bookmarks.delete({ bookmarkId })
```

Each procedure: Zod input validation → service call → return typed result.

Integration test coverage: happy path for each procedure, auth (different user 403), input validation.

Register in `root.ts`:
```ts
import { researchRouter } from "./routers/research";
// ...
research: researchRouter,
```

Commit: `feat: add research router with search, sessions, and bookmarks`

---

**End of Chunk 3.**

---

## Chunk 4: AI Q&A pipeline (Claude RAG + UPL + UsageGuard)

### Task 10: Citation validator

**Files:**
- Create: `src/server/services/research/citation-validator.ts`
- Create: `tests/unit/citation-validator.test.ts`

Enumerate reporter patterns (spec reviewer recommendation):

```ts
const REPORTER_PATTERNS = [
  /\b\d+\s+U\.S\.\s+\d+\b/g,          // 123 U.S. 456
  /\b\d+\s+S\.\s?Ct\.\s+\d+\b/g,      // 123 S.Ct. 456
  /\b\d+\s+F\.(?:2d|3d|4th)\s+\d+\b/g,// 123 F.3d 456
  /\b\d+\s+F\.\s?Supp\.\s?(?:2d|3d)?\s+\d+\b/g, // 123 F.Supp.2d 456
  /\b\d+\s+Cal\.(?:\s?\d+(?:th|nd|rd|st))?\s+\d+\b/g,
  /\b\d+\s+N\.Y\.(?:\s?\d+(?:d|nd|rd|st|th))?\s+\d+\b/g,
  /\b\d+\s+Tex\.\s+\d+\b/g,
  /\b\d+\s+So\.\s?(?:2d|3d)?\s+\d+\b/g,
  /\b\d+\s+Ill\.(?:\s?\d+(?:d|nd|rd|st|th))?\s+\d+\b/g,
];

export function extractCitations(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of REPORTER_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(match[0].trim());
  }
  return [...found];
}

export function validateCitations(
  text: string,
  contextCitations: string[],
): { verified: string[]; unverified: string[] } {
  const found = extractCitations(text);
  const contextNormalized = new Set(contextCitations.map((c) => c.toLowerCase().replace(/\s+/g, " ").trim()));
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const c of found) {
    const normalized = c.toLowerCase().replace(/\s+/g, " ").trim();
    (contextNormalized.has(normalized) ? verified : unverified).push(c);
  }
  return { verified, unverified };
}
```

Tests: each reporter pattern extracted, cross-check with context, case-insensitive match, whitespace tolerance.

Commit: `feat: add citation validator for legal research AI responses`

---

### Task 11: UPL filter (reuse + extend)

**Files:**
- Modify: `src/server/services/compliance.ts` (check existing Phase 1 file for banned-words map)
- Create: `src/server/services/research/upl-filter.ts` (wrapper specific to research)
- Create: `tests/unit/research-upl-filter.test.ts`

If Phase 1 already has a banned-words filter with the approved-alternatives map, wrap it. Else create:

```ts
const BANNED_MAP: Record<string, string> = {
  "should": "consider",
  "must": "may need to",
  "recommend": "note that",
  "advise": "indicate",
  "we suggest": "the provided opinions suggest",
  "best option": "one approach",
  "legal advice": "legal information",
  "your rights": "rights under the cited opinions",
  "you have a case": "the provided opinions may be relevant",
};

export function applyUplFilter(text: string): { filtered: string; violations: string[] } {
  let out = text;
  const violations: string[] = [];
  for (const [banned, replacement] of Object.entries(BANNED_MAP)) {
    const re = new RegExp(`\\b${banned}\\b`, "gi");
    if (re.test(out)) violations.push(banned);
    out = out.replace(re, replacement);
  }
  return { filtered: out, violations };
}
```

Tests: every banned word replaced, case-insensitive, word boundary respected, violation count.

Commit: `feat: add UPL output filter for research responses`

---

### Task 12: UsageGuard middleware

**Files:**
- Create: `src/server/services/research/usage-guard.ts`
- Create: `tests/integration/usage-guard.test.ts`

```ts
export class UsageLimitExceededError extends Error {
  constructor(public readonly used: number, public readonly limit: number) {
    super(`Research Q&A monthly limit reached (${used}/${limit})`);
    this.name = "UsageLimitExceededError";
  }
}

const TIER_LIMITS = { starter: 50, professional: 500, business: 5000 } as const;

export async function checkAndIncrementQa(userId: string, userPlan: string): Promise<{ used: number; limit: number }> {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const limit = TIER_LIMITS[userPlan as keyof typeof TIER_LIMITS] ?? 0;

  const [usage] = await db
    .insert(researchUsage)
    .values({ userId, month, qaCount: 1 })
    .onConflictDoUpdate({
      target: [researchUsage.userId, researchUsage.month],
      set: { qaCount: sql`${researchUsage.qaCount} + 1`, updatedAt: new Date() },
    })
    .returning();

  if (usage.qaCount > limit) {
    // rollback
    await db.update(researchUsage)
      .set({ qaCount: sql`${researchUsage.qaCount} - 1` })
      .where(and(eq(researchUsage.userId, userId), eq(researchUsage.month, month)));
    throw new UsageLimitExceededError(usage.qaCount - 1, limit);
  }
  return { used: usage.qaCount, limit };
}

export async function refundQa(userId: string): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  await db.update(researchUsage)
    .set({ qaCount: sql`greatest(${researchUsage.qaCount} - 1, 0)` })
    .where(and(eq(researchUsage.userId, userId), eq(researchUsage.month, month)));
}

export async function getCurrentUsage(userId: string, userPlan: string) {
  const month = new Date().toISOString().slice(0, 7);
  const row = await db.query.researchUsage.findFirst({
    where: and(eq(researchUsage.userId, userId), eq(researchUsage.month, month)),
  });
  return { used: row?.qaCount ?? 0, limit: TIER_LIMITS[userPlan as keyof typeof TIER_LIMITS] ?? 0 };
}
```

Tests: increment under limit passes, increment at limit throws, refund restores count, concurrent increments atomic via SQL, month boundary.

Commit: `feat: add research usage guard with atomic increment and refund`

---

### Task 13: LegalRagService

**Files:**
- Create: `src/server/services/research/legal-rag.ts`
- Create: `tests/integration/legal-rag.test.ts`

```ts
export interface AskBroadInput {
  sessionId: string;
  userId: string;
  question: string;
  topN?: number; // default 10
}

export interface AskDeepInput {
  sessionId: string;
  userId: string;
  opinionInternalId: string;
  question: string;
}

export interface StreamChunk {
  type: "token" | "done" | "error";
  content?: string;
  messageId?: string;
  flags?: { unverifiedCitations?: string[]; uplViolations?: string[] };
}
```

Responsibilities:
1. Load session + last 10 chat messages for history
2. **Broad:** fetch latest `research_queries` → top-N `cached_opinions` by search relevance → ensure full_text cached (parallel `OpinionCacheService.getOrFetch`, concurrency 5) → trim each to ≤10K tokens (syllabus + first 60%)
3. **Deep:** load single opinion → ensure full_text
4. Build Claude request: SYSTEM_PROMPT (§9 of spec) + opinions + history + question
5. Stream Claude response (Anthropic SDK `messages.stream`) → yield token chunks
6. On stream complete: `applyUplFilter` + `validateCitations(response, contextCitations)` → if ≥2 unverified, re-prompt once with correction instruction
7. Persist user message + assistant message to `research_chat_messages` with `opinion_context_ids`, `flags`, `tokens_used`
8. Return final message ID and flags

Test with stubbed Claude stream: token accumulation, citation validation flagging, re-prompt trigger, UPL filter application, DB persistence.

Commit: `feat: add LegalRagService with Claude streaming, citation validation, and UPL filter`

---

### Task 14: askBroad / askDeep tRPC subscriptions

**Files:**
- Modify: `src/server/trpc/routers/research.ts`
- Create: `tests/integration/research-ai.test.ts`

Add procedures using tRPC subscription pattern (SSE via `httpSubscriptionLink` in tRPC 11 — confirm with `node_modules/@trpc/server/dist/docs/` or latest tRPC docs).

```ts
askBroad: protectedProcedure
  .input(z.object({ sessionId: z.uuid(), question: z.string().min(1).max(2000), topN: z.number().int().min(1).max(20).optional() }))
  .subscription(async function* ({ input, ctx }) {
    const usage = await checkAndIncrementQa(ctx.userId, ctx.userPlan);
    try {
      const stream = legalRag.askBroad({ ...input, userId: ctx.userId });
      for await (const chunk of stream) yield chunk;
    } catch (err) {
      await refundQa(ctx.userId);
      throw err;
    }
  }),

askDeep: protectedProcedure
  .input(z.object({ sessionId: z.uuid(), opinionInternalId: z.uuid(), question: z.string().min(1).max(2000) }))
  .subscription(async function* ({ input, ctx }) {
    const usage = await checkAndIncrementQa(ctx.userId, ctx.userPlan);
    try {
      const stream = legalRag.askDeep({ ...input, userId: ctx.userId });
      for await (const chunk of stream) yield chunk;
    } catch (err) {
      await refundQa(ctx.userId);
      throw err;
    }
  }),

getUsage: protectedProcedure.query(async ({ ctx }) => getCurrentUsage(ctx.userId, ctx.userPlan)),
```

Integration tests: usage limit block, refund on Claude error, broad/deep success path with stubbed Claude.

Commit: `feat: add askBroad/askDeep AI Q&A procedures`

---

**End of Chunk 4.**

---

## Chunk 5: Frontend — research hub, search, opinion viewer

### Task 15: `/research` layout + navigation entry

**Files:**
- Create: `src/app/(app)/research/layout.tsx`
- Create: `src/app/(app)/research/page.tsx`
- Modify: top nav component (find with `grep -r "Cases" src/components/ src/app/\(app\)/layout.tsx | head`)

Layout: 3-pane (sessions sidebar | main content | AI chat panel). Shadcn `ResizablePanelGroup`.

Add "Research" nav item with scroll-text icon between "Cases" and "Contracts".

Commit: `feat: scaffold /research layout and nav entry`

---

### Task 16: SearchBar + FilterDrawer components

**Files:**
- Create: `src/components/research/search-bar.tsx`
- Create: `src/components/research/filter-drawer.tsx`
- Create: `src/components/research/filter-chips.tsx`

SearchBar: controlled input with debounced (300ms) — Enter triggers `research.search.useMutation`. FilterDrawer: collapsible left panel with jurisdiction multi-select (Federal + 5 states), court level multi-select, date-range inputs, preset buttons. FilterChips: inline display + remove.

Commit: `feat: add research search bar and filter drawer`

---

### Task 17: Results list

**Files:**
- Create: `src/components/research/results-list.tsx`
- Create: `src/components/research/result-card.tsx`

Result card: case name (click → opens viewer) | court + date | Bluebook cite | highlighted snippet | actions (Bookmark star, "Ask AI about results" in list header). Pagination: 20/page, server-side cursor in session state.

Commit: `feat: add research results list and cards`

---

### Task 18: Opinion viewer

**Files:**
- Create: `src/app/(app)/research/opinions/[opinionId]/page.tsx`
- Create: `src/components/research/opinion-viewer.tsx`
- Create: `src/components/research/opinion-header.tsx`

Full-page layout: header (case name, Bluebook cite with copy button, court/date/judges, Bookmark toggle, "Attach to case…" dropdown) | body (numbered paragraphs, search-term highlights, collapsible syllabus/dissent via regex detection) | right rail (deep-mode AI chat panel — Chunk 6) | footer UPL disclaimer.

Fetch via `research.getOpinion.useQuery({ opinionInternalId })`. Loading skeleton. 404 state.

Commit: `feat: add opinion viewer with Bluebook citation and UPL footer`

---

**End of Chunk 5.**

---

## Chunk 6: Frontend — AI chat (broad + deep), sessions, bookmarks, case tab

### Task 19: AI chat panel (broad + deep)

**Files:**
- Create: `src/components/research/chat-panel.tsx`
- Create: `src/components/research/citation-chip.tsx`
- Create: `src/hooks/use-research-stream.ts`

`use-research-stream.ts`: wraps tRPC subscription, accumulates tokens, returns `{ messages, streaming, send, error }`.

`chat-panel.tsx`: props `{ sessionId, mode: "broad" | "deep", opinionId? }`. Renders message list + input. User message + streaming assistant message (render tokens as they arrive). Assistant messages: parse citations → render `CitationChip` (clickable — opens opinion viewer; ⚠ icon if unverified, UPL footer below every assistant message).

Hook into results list header ("Ask AI") and opinion viewer right rail.

Commit: `feat: add AI chat panel with streaming and citation chips`

---

### Task 20: Sessions sidebar

**Files:**
- Create: `src/components/research/sessions-sidebar.tsx`
- Create: `src/components/research/session-item.tsx`

Left panel: "My Research" heading + "New research" CTA. List grouped by "Today / This week / Earlier" (JS date bucketing). Each item: title | query count badge | case chip (if linked) | timestamp. Click → navigate to `/research/sessions/[id]`. Context menu: Rename / Delete (confirm modal) / Link to case.

Commit: `feat: add research sessions sidebar`

---

### Task 21: Session detail page

**Files:**
- Create: `src/app/(app)/research/sessions/[sessionId]/page.tsx`

Loads `research.sessions.get({ sessionId })`. Shows session title (inline-editable), query history (clickable → re-runs search), chat messages, case chip if linked. "New query" resets to hub search bar pre-loaded with session filters.

Commit: `feat: add research session detail page`

---

### Task 22: Bookmarks page + Attach-to-case modal

**Files:**
- Create: `src/app/(app)/research/bookmarks/page.tsx`
- Create: `src/components/research/bookmarks-grid.tsx`
- Create: `src/components/research/attach-to-case-modal.tsx`

Bookmarks page: grid of bookmark cards (opinion citation + case name + user notes input + linked-case chip). Filter by jurisdiction and linked case. Note inline-editable (PATCH on blur).

`AttachToCaseModal`: combobox over user's cases (`cases.list.useQuery`), "Attach" button triggers `research.bookmarks.update({ bookmarkId, caseId })`. Used from opinion viewer and bookmark card.

Commit: `feat: add bookmarks page and attach-to-case modal`

---

### Task 23: Case detail → Research tab

**Files:**
- Modify: `src/app/(app)/cases/[caseId]/page.tsx` (or tabs component for case detail)
- Create: `src/components/cases/case-research-tab.tsx`

Find existing case-detail tab pattern (likely `case-tabs.tsx` or similar). Add "Research" tab after existing tabs. Tab content:
- Filter: `research.sessions.list({ caseId })` + `research.bookmarks.list({ caseId })`
- Two sub-sections: "Research sessions" list + "Bookmarked opinions" grid
- "New research for this case" CTA → `/research?caseId=X` pre-fills case link on first session

Commit: `feat: add Research tab to case detail page`

---

**End of Chunk 6.**

---

## Chunk 7: Integration — billing UI, notifications, activity log, Inngest, E2E

### Task 24: Usage progress bar + upsell modal

**Files:**
- Create: `src/components/research/usage-indicator.tsx`
- Create: `src/components/research/upsell-modal.tsx`

Indicator in research hub header: progress bar + "47 / 50 Q&A used this month" (Starter/Pro). Yellow at 80 %, red at 100 %. Uses `research.getUsage.useQuery`. Business tier shows counter only above 1000.

Upsell modal on `UsageLimitExceededError` catch: explains limit, CTA → Stripe customer portal `/settings/billing`.

Commit: `feat: add research usage indicator and upsell modal`

---

### Task 25: Notifications + activity log integration

**Files:**
- Modify: `src/server/services/research/bookmark-service.ts`
- Modify: `src/server/services/research/session-service.ts`

In `BookmarkService.create` / `update` when `caseId` is set:
- `ActivityLogService.append({ caseId, type: "research.bookmark_added", payload: { opinionId, citation } })`
- `NotificationService.createForCaseAssignees({ caseId, type: "research_bookmark_added", actorId: userId, payload: { citation } })`

In `ResearchSessionService.linkToCase`:
- `ActivityLogService.append({ caseId, type: "research.session_linked", payload: { sessionTitle } })`

Add new notification template in `src/server/services/email/templates.ts` (or existing notification copy file) for "research_bookmark_added".

Tests: verify activity log entry + notification row after bookmark with case link.

Commit: `feat: wire research events into activity log and notifications`

---

### Task 26: Inngest enrichOpinion job

**Files:**
- Create: `src/server/inngest/functions/research-enrich-opinion.ts`
- Modify: `src/server/inngest/index.ts` (register function)

Event: `research/opinion.enrich.requested` with `{ opinionInternalId }`. Steps:
1. Load opinion from DB
2. If `metadata.enrichmentStatus === "done"`, skip
3. Fetch citation network from `GET /api/rest/v4/citations/?citing_opinion=<courtlistenerId>`
4. Update `cached_opinions.metadata` with `citedByCount`, `citesTo[]`, `enrichmentStatus: "done"`
5. On error: `enrichmentStatus: "failed"`, log, no retry

Dispatch from `research.getOpinion` procedure after first fetch.

Commit: `feat: add Inngest job for background opinion enrichment`

---

### Task 27: E2E happy-path test

**Files:**
- Create: `tests/e2e/research.spec.ts`

Playwright scenario:
1. Sign in as Pro user
2. Navigate to `/research`
3. Search "arbitration clause"
4. Expect ≥1 result
5. Open first result
6. Ask "What's the holding?" via AI chat
7. Expect streaming response with at least one citation chip
8. Click bookmark star
9. Open "Attach to case" → select existing test case → confirm
10. Navigate to case → Research tab → verify bookmark visible

Commit: `test: add E2E research happy-path test`

---

### Task 28: UPL manual audit checklist + docs update

**Files:**
- Create: `docs/upl-audits/2.2.1-research-audit.md`
- Modify: `docs/upl-compliance.md` (append Research chapter)

Checklist: 20 representative queries (list in spec §14). For each — manually verify:
- No banned words in response
- Every citation matches provided opinions
- UPL footer present
- No predictive / advisory language

Commit: `docs: add 2.2.1 UPL audit checklist`

---

### Task 29: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run && npx playwright test`
Expected: all tests pass.

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds (watch for the Phase 1 Stripe webhook error — pre-existing, not introduced by 2.2.1).

- [ ] **Step 4: Manually run UAT checklist from spec §15**

Check all 13 criteria. Document failures.

- [ ] **Step 5: Create PR**

```bash
git push -u origin <branch>
gh pr create --title "feat: 2.2.1 Case Law Search + AI Q&A" --body "Implements Phase 2.2.1 per spec docs/superpowers/specs/2026-04-16-case-law-search-ai-qa-design.md. See plan docs/superpowers/plans/2026-04-16-case-law-search-ai-qa-plan.md."
```

---

**End of Chunk 7. End of plan.**

## Summary

29 tasks across 7 chunks:
1. **Chunk 1 (Tasks 1-3):** DB schema + migration
2. **Chunk 2 (Tasks 4-6):** CourtListener client + OpinionCacheService
3. **Chunk 3 (Tasks 7-9):** Research services + non-AI router
4. **Chunk 4 (Tasks 10-14):** AI Q&A pipeline (citation validator, UPL filter, usage guard, Claude RAG, subscriptions)
5. **Chunk 5 (Tasks 15-18):** Frontend — hub, search, opinion viewer
6. **Chunk 6 (Tasks 19-23):** Frontend — AI chat, sessions, bookmarks, case tab
7. **Chunk 7 (Tasks 24-29):** Billing UI, notifications, Inngest, E2E, UPL audit, verification

TDD cadence: write failing test → run → implement → run → commit. Reference spec for any detail not expanded here.

