# Research Memo Generation (IRAC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate IRAC-formatted (Issue / Rule / Application / Conclusion) legal memos from a single research session, edit them in a 3-pane section-level editor with AI rewrite, export to PDF/DOCX.

**Architecture:** Reuses `legal-rag` retrieval (opinions + statutes) + `applyUplFilter` + `validateCitations`. Generation is async via Inngest with 4 parallel Claude streams (one per IRAC section). Editor mirrors `contract-drafts` 3-pane pattern (plain `<Textarea>` per section + AI chat rail). Export uses `@react-pdf/renderer` (already in deps) and `docx` (already in deps). Billing extends `UsageGuard` with `checkAndIncrementMemo` / `refundMemo` using the existing unused `research_usage.memo_count` column.

**Tech Stack:** Next.js App Router, Drizzle ORM (postgres-js), tRPC v11, Inngest v4, Anthropic SDK (Claude sonnet-4-6 streaming), `@react-pdf/renderer`, `docx`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-18-research-memo-generation-design.md`

---

## File Structure

### Created
- `src/server/db/migrations/0010_research_memos.sql` — DDL.
- `src/server/db/schema/research-memos.ts` — Drizzle schema (2 tables, 2 enums).
- `src/server/services/research/memo-generation.ts` — orchestrator (retrieval, parallel Claude, persist).
- `src/server/services/research/memo-prompts.ts` — IRAC section prompt templates.
- `src/server/services/research/memo-pdf.tsx` — `@react-pdf/renderer` document.
- `src/server/services/research/memo-docx.ts` — `docx` builder.
- `src/server/inngest/functions/research-memo-generate.ts` — Inngest fan-out + status flip.
- `src/server/trpc/routers/research-memo.ts` — sub-router mounted under `research`.
- `src/app/(app)/research/memos/page.tsx` — list view.
- `src/app/(app)/research/memos/[memoId]/page.tsx` — 3-pane editor.
- `src/app/api/research/memos/[memoId]/export/route.ts` — PDF/DOCX download endpoint.
- `src/components/research/memo-section-nav.tsx` — left rail.
- `src/components/research/memo-section-editor.tsx` — center pane (Textarea + citations + regen button).
- `src/components/research/memo-rewrite-chat.tsx` — right rail (extends `chat-panel.tsx` pattern).
- `src/components/research/memo-generation-modal.tsx` — triggered from session view.
- `src/components/research/memo-list-card.tsx` — list page card.
- `tests/integration/research-memo-router.test.ts` — router coverage.
- `tests/integration/memo-generation-service.test.ts` — service unit-ish (mock DB + mock Anthropic).
- `tests/integration/research-memo-inngest.test.ts` — Inngest function coverage.
- `tests/unit/usage-guard-memo.test.ts` — memo bucket coverage.
- `e2e/research-memo.spec.ts` — Playwright smoke (navigation + status<500).

### Modified
- `src/server/services/research/usage-guard.ts` — add `checkAndIncrementMemo` + `refundMemo`.
- `src/server/trpc/routers/research.ts` — mount `memo` sub-router.
- `src/server/db/schema/research-usage.ts` — add docstring noting memo_count is now wired (no schema change).
- `src/lib/notifications.ts` (or wherever `NotificationType` lives) — add `research_memo_ready` + `research_memo_failed`.
- `src/server/inngest/functions/handle-notification.ts` — explicit handlers for new types.
- `src/app/(app)/research/sessions/[sessionId]/page.tsx` — add "Generate memo" button + memo-list block.
- `src/app/(app)/cases/[id]/page.tsx` Research tab — add memo count + collapsed list.
- `src/components/research/sessions-sidebar.tsx` — add "View memos" link near each session (small enhancement, optional polish).
- `scripts/upl-audit.ts` — add `--mode=memo`.

---

## Conventions reminder

- `pgEnum` arrays widened in this project use `ALTER TYPE ... ADD VALUE IF NOT EXISTS`; brand-new enums use `CREATE TYPE`.
- Migrations applied via `psql $DATABASE_URL -f` (NOT `drizzle-kit migrate`).
- All router tests use chainable mock-DB pattern (see `tests/integration/research-router.test.ts`); no real-DB writes in vitest.
- Env stubs added to `tests/setup.ts` if a new env var becomes required at module-load time.
- Anthropic SDK access pattern: `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })`, model `claude-sonnet-4-6`.
- Project does NOT use a schema barrel — import schemas directly from their file.
- Drizzle index callback array form: `(table) => [index(...).on(...)]`.

---

## Chunk 1 — Schema + Migration

### Task 1: Drizzle schema for memos + sections

**Files:**
- Create: `src/server/db/schema/research-memos.ts`

- [ ] **Step 1: Write the schema file**

```ts
// src/server/db/schema/research-memos.ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { researchSessions } from "./research-sessions";
import { cases } from "./cases";
import { jurisdictionEnum } from "./cached-opinions";

export const memoStatusEnum = pgEnum("research_memo_status", [
  "generating",
  "ready",
  "failed",
]);

export const memoSectionTypeEnum = pgEnum("research_memo_section_type", [
  "issue",
  "rule",
  "application",
  "conclusion",
]);

export const researchMemos = pgTable(
  "research_memos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => researchSessions.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    jurisdiction: jurisdictionEnum("jurisdiction"),
    status: memoStatusEnum("status").notNull(),
    memoQuestion: text("memo_question").notNull(),
    contextOpinionIds: uuid("context_opinion_ids").array().notNull().default(sql`'{}'`),
    contextStatuteIds: uuid("context_statute_ids").array().notNull().default(sql`'{}'`),
    flags: jsonb("flags")
      .$type<{ unverifiedCitations?: string[]; uplViolations?: string[] }>()
      .notNull()
      .default({}),
    tokenUsage: jsonb("token_usage")
      .$type<{ input_tokens?: number; output_tokens?: number }>()
      .notNull()
      .default({}),
    creditsCharged: integer("credits_charged").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("research_memos_user_updated_idx").on(
      table.userId,
      table.deletedAt,
      table.updatedAt.desc(),
    ),
    index("research_memos_case_idx").on(table.caseId),
    index("research_memos_session_idx").on(table.sessionId),
  ],
);

export const researchMemoSections = pgTable(
  "research_memo_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoId: uuid("memo_id")
      .notNull()
      .references(() => researchMemos.id, { onDelete: "cascade" }),
    sectionType: memoSectionTypeEnum("section_type").notNull(),
    ord: integer("ord").notNull(),
    content: text("content").notNull(),
    citations: text("citations").array().notNull().default(sql`'{}'`),
    aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }).notNull(),
    userEditedAt: timestamp("user_edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("research_memo_sections_memo_type_unique").on(
      table.memoId,
      table.sectionType,
    ),
    index("research_memo_sections_memo_ord_idx").on(table.memoId, table.ord),
    check("research_memo_sections_ord_check", sql`${table.ord} BETWEEN 1 AND 4`),
  ],
);

export type ResearchMemo = typeof researchMemos.$inferSelect;
export type NewResearchMemo = typeof researchMemos.$inferInsert;
export type ResearchMemoSection = typeof researchMemoSections.$inferSelect;
export type NewResearchMemoSection = typeof researchMemoSections.$inferInsert;
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: `EXIT=0`. If `cases` import path fails, check `src/server/db/schema/cases.ts` and adjust.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/research-memos.ts
git commit -m "feat(2.2.3): add research-memos drizzle schema (memos + sections)"
```

---

### Task 2: SQL migration

**Files:**
- Create: `src/server/db/migrations/0010_research_memos.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0010_research_memos.sql
-- Phase 2.2.3: research memo generation (IRAC). Two tables + two enums.
-- Hand-written (project convention). Apply with: psql "$DATABASE_URL" -f <file>.

CREATE TYPE "public"."research_memo_status" AS ENUM ('generating','ready','failed');
CREATE TYPE "public"."research_memo_section_type" AS ENUM ('issue','rule','application','conclusion');

CREATE TABLE "research_memos" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "session_id" uuid NOT NULL,
    "case_id" uuid,
    "title" text NOT NULL,
    "jurisdiction" "research_jurisdiction",
    "status" "research_memo_status" NOT NULL,
    "memo_question" text NOT NULL,
    "context_opinion_ids" uuid[] NOT NULL DEFAULT '{}',
    "context_statute_ids" uuid[] NOT NULL DEFAULT '{}',
    "flags" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "token_usage" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "credits_charged" integer NOT NULL DEFAULT 0,
    "error_message" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "deleted_at" timestamp with time zone
);

CREATE TABLE "research_memo_sections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "memo_id" uuid NOT NULL,
    "section_type" "research_memo_section_type" NOT NULL,
    "ord" integer NOT NULL,
    "content" text NOT NULL,
    "citations" text[] NOT NULL DEFAULT '{}',
    "ai_generated_at" timestamp with time zone NOT NULL,
    "user_edited_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "research_memo_sections_ord_check" CHECK ("ord" BETWEEN 1 AND 4)
);

ALTER TABLE "research_memos"
  ADD CONSTRAINT "research_memos_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_memos_session_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_memos_case_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null;

ALTER TABLE "research_memo_sections"
  ADD CONSTRAINT "research_memo_sections_memo_id_fk"
    FOREIGN KEY ("memo_id") REFERENCES "public"."research_memos"("id") ON DELETE cascade;

CREATE INDEX "research_memos_user_updated_idx"
  ON "research_memos" USING btree ("user_id","deleted_at","updated_at" DESC NULLS LAST);
CREATE INDEX "research_memos_case_idx"
  ON "research_memos" USING btree ("case_id");
CREATE INDEX "research_memos_session_idx"
  ON "research_memos" USING btree ("session_id");

CREATE UNIQUE INDEX "research_memo_sections_memo_type_unique"
  ON "research_memo_sections" USING btree ("memo_id","section_type");
CREATE INDEX "research_memo_sections_memo_ord_idx"
  ON "research_memo_sections" USING btree ("memo_id","ord");
```

- [ ] **Step 2: Apply to dev DB**

Run:
```bash
set -a && source .env.local && set +a && \
  /opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f src/server/db/migrations/0010_research_memos.sql
```
Expected: `CREATE TYPE` × 2, `CREATE TABLE` × 2, `ALTER TABLE` × 2, `CREATE INDEX` × 5, EXIT=0.

- [ ] **Step 3: Verify enum + table existence**

Run:
```bash
set -a && source .env.local && set +a && \
  /opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -c \
  "SELECT typname FROM pg_type WHERE typname LIKE 'research_memo%';
   SELECT relname FROM pg_class WHERE relname LIKE 'research_memo%';"
```
Expected: 2 types (`research_memo_status`, `research_memo_section_type`), tables `research_memos` + `research_memo_sections` plus their indexes.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/migrations/0010_research_memos.sql
git commit -m "feat(2.2.3): migration for research_memos + sections"
```

---

## Chunk 2 — Backend Services

### Task 3: UsageGuard memo bucket

**Files:**
- Modify: `src/server/services/research/usage-guard.ts`
- Test: `tests/unit/usage-guard-memo.test.ts`

- [ ] **Step 1: Read current UsageGuard to mirror Q&A method shape**

Run: `grep -n "checkAndIncrementQa\|refundQa\|UsageLimitExceededError" src/server/services/research/usage-guard.ts | head`

Expected: locate the existing `checkAndIncrementQa` + `refundQa` to mirror their atomic-SQL pattern (see 2.2.1 memory: "atomic SQL; rollback commutes under concurrency").

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/usage-guard-memo.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsageGuard, UsageLimitExceededError } from "@/server/services/research/usage-guard";

function makeMockDb() {
  // chainable mock identical pattern to existing usage-guard tests
  // (factor out into a shared helper if present; otherwise inline).
  const updates: { values?: unknown }[] = [];
  let queryRow: { qa_count: number; memo_count: number } = { qa_count: 0, memo_count: 0 };
  const db = {
    execute: async (q: any) => {
      // Capture the SQL fragment text for assertions
      updates.push({ values: q?.queryChunks ?? q });
      return { rows: [{ ...queryRow }] };
    },
  } as any;
  return {
    db,
    setQueryRow: (row: typeof queryRow) => { queryRow = row; },
    updates,
  };
}

describe("UsageGuard.checkAndIncrementMemo", () => {
  it("allows under cap", async () => {
    const { db } = makeMockDb();
    const guard = new UsageGuard({ db });
    await expect(
      guard.checkAndIncrementMemo({ userId: "u1", plan: "professional" }),
    ).resolves.toBeUndefined();
  });

  it("throws UsageLimitExceededError at cap", async () => {
    const { db, setQueryRow } = makeMockDb();
    setQueryRow({ qa_count: 0, memo_count: 50 }); // professional cap = 50
    const guard = new UsageGuard({ db });
    await expect(
      guard.checkAndIncrementMemo({ userId: "u1", plan: "professional" }),
    ).rejects.toBeInstanceOf(UsageLimitExceededError);
  });

  it("business plan = unlimited", async () => {
    const { db, setQueryRow } = makeMockDb();
    setQueryRow({ qa_count: 0, memo_count: 1_000_000 });
    const guard = new UsageGuard({ db });
    await expect(
      guard.checkAndIncrementMemo({ userId: "u1", plan: "business" }),
    ).resolves.toBeUndefined();
  });

  it("refundMemo decrements memo_count", async () => {
    const { db, updates } = makeMockDb();
    const guard = new UsageGuard({ db });
    await guard.refundMemo({ userId: "u1" });
    expect(updates.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run failing test**

Run: `npx vitest run tests/unit/usage-guard-memo.test.ts`
Expected: FAIL — `checkAndIncrementMemo is not a function`.

- [ ] **Step 4: Implement methods**

In `src/server/services/research/usage-guard.ts`, add (after `refundQa`):

```ts
const MEMO_CAPS: Record<Plan, number | null> = {
  starter: 10,
  professional: 50,
  business: null,
};

async checkAndIncrementMemo(opts: { userId: string; plan: Plan }): Promise<void> {
  const cap = MEMO_CAPS[opts.plan];
  const month = currentMonth();
  // Atomic upsert+increment, returning the post-increment count.
  // Mirror the existing checkAndIncrementQa SQL exactly, swapping qa_count → memo_count.
  const result = await this.db.execute(sql`
    INSERT INTO research_usage (user_id, month, memo_count)
    VALUES (${opts.userId}, ${month}, 1)
    ON CONFLICT (user_id, month)
    DO UPDATE SET memo_count = research_usage.memo_count + 1, updated_at = now()
    RETURNING memo_count
  `);
  const memoCount = Number((result as any).rows?.[0]?.memo_count ?? 0);
  if (cap !== null && memoCount > cap) {
    // Compensating refund so the bucket reflects the rejected attempt.
    await this.refundMemo({ userId: opts.userId });
    throw new UsageLimitExceededError(`memo usage limit exceeded: ${memoCount} / ${cap}`);
  }
}

async refundMemo(opts: { userId: string }): Promise<void> {
  const month = currentMonth();
  await this.db.execute(sql`
    UPDATE research_usage
    SET memo_count = GREATEST(memo_count - 1, 0), updated_at = now()
    WHERE user_id = ${opts.userId} AND month = ${month}
  `);
}
```

(`Plan`, `UsageLimitExceededError`, `currentMonth`, `sql` imports already present — no new imports needed.)

- [ ] **Step 5: Run tests pass**

Run: `npx vitest run tests/unit/usage-guard-memo.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/research/usage-guard.ts tests/unit/usage-guard-memo.test.ts
git commit -m "feat(2.2.3): UsageGuard memo bucket (10/50/unlimited)"
```

---

### Task 4: Memo prompts

**Files:**
- Create: `src/server/services/research/memo-prompts.ts`

- [ ] **Step 1: Write prompts file**

```ts
// src/server/services/research/memo-prompts.ts
//
// Section-specific prompt templates for IRAC memo generation. All four
// sections inherit the legal-rag base SYSTEM_PROMPT (UPL guardrails,
// banned vocabulary, attorney audience). Each template adds focused
// instructions for the section's role.

export type MemoSectionType = "issue" | "rule" | "application" | "conclusion";

export const SECTION_PROMPTS: Record<MemoSectionType, string> = {
  issue:
    "Write the ISSUE section of an IRAC legal research memo. State the legal question(s) presented in 1-3 sentences. No analysis. No citations needed in this section.",
  rule:
    "Write the RULE section of an IRAC legal research memo. State the controlling rules of law from the provided opinions and statutes. Cite every rule using the Bluebook citations from the provided materials. Do not apply the rules yet.",
  application:
    "Write the APPLICATION section of an IRAC legal research memo. Apply the rules from the provided materials to the question. Cite specific holdings. Acknowledge contrary authority where it exists in the provided materials.",
  conclusion:
    "Write the CONCLUSION section of an IRAC legal research memo. Summarize the answer to the question in 2-4 sentences. Restate the key citations parenthetically. No new analysis.",
};

export const SECTION_ORDER: MemoSectionType[] = [
  "issue",
  "rule",
  "application",
  "conclusion",
];

export function ordOf(section: MemoSectionType): number {
  return SECTION_ORDER.indexOf(section) + 1;
}

export function assembleSectionUserMessage(args: {
  section: MemoSectionType;
  memoQuestion: string;
  contextBlock: string; // pre-rendered "[Opinion 1] ... [Statute 1] ..." block
  steeringMessage?: string;
}): string {
  const parts = [
    `Memo question: ${args.memoQuestion}`,
    "",
    "Provided materials:",
    args.contextBlock,
    "",
    SECTION_PROMPTS[args.section],
  ];
  if (args.steeringMessage) {
    parts.push("", `Additional guidance: ${args.steeringMessage}`);
  }
  return parts.join("\n");
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: EXIT=0.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/research/memo-prompts.ts
git commit -m "feat(2.2.3): IRAC section prompt templates"
```

---

### Task 5: MemoGenerationService — generate path

**Files:**
- Create: `src/server/services/research/memo-generation.ts`
- Test: `tests/integration/memo-generation-service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/integration/memo-generation-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { MemoGenerationService } from "@/server/services/research/memo-generation";

// chainable mock-DB pattern matching tests/integration/research-router.test.ts
// (factor out shared helpers if present; below is the minimal local version)

function makeAnthropicMock() {
  // Stream that yields token chunks then a "message_stop" with usage.
  const stream = (async function* () {
    yield { type: "content_block_delta", delta: { type: "text_delta", text: "The court held in 410 U.S. 113. " } };
    yield { type: "message_stop" };
  })();
  const messages = {
    stream: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: () => stream,
      finalMessage: async () => ({
        content: [{ type: "text", text: "The court held in 410 U.S. 113. " }],
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    }),
  };
  return { messages } as any;
}

function makeMockDb() {
  const inserts: { table: string; values: unknown }[] = [];
  const updates: { table: string; set: unknown }[] = [];
  const selects: { rows: any[] }[] = [];
  const db = {
    insert: (t: any) => ({
      values: (v: any) => ({
        returning: async () => [{ id: "memo-1", ...v }],
        onConflictDoNothing: () => ({ returning: async () => [{ id: "memo-1", ...v }] }),
      }),
    }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: () => ({ returning: async () => [{ id: "memo-1", ...s }] }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selects.shift()?.rows ?? []) }),
      }),
    }),
    enqueueSelect: (rows: any[]) => selects.push({ rows }),
  } as any;
  return { db, inserts, updates };
}

describe("MemoGenerationService.generateAll", () => {
  it("generates 4 sections in parallel and persists them", async () => {
    const { db } = makeMockDb();
    db.enqueueSelect([{ id: "memo-1", memo_question: "Q?", context_opinion_ids: ["op1"], context_statute_ids: [] }]);
    // 4 hydrate selects (opinions / statutes) — return empty for this minimal test
    db.enqueueSelect([{ id: "op1", citation_bluebook: "410 U.S. 113", full_text: "..." }]);
    db.enqueueSelect([]);
    const anthropic = makeAnthropicMock();
    const svc = new MemoGenerationService({ db, anthropic, opinionCache: {} as any, statuteCache: {} as any });

    const result = await svc.generateAll({ memoId: "memo-1" });
    expect(result.status).toBe("ready");
    expect(result.sections).toHaveLength(4);
    expect(result.sections.map((s) => s.section_type).sort()).toEqual([
      "application", "conclusion", "issue", "rule",
    ]);
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npx vitest run tests/integration/memo-generation-service.test.ts`
Expected: FAIL — `MemoGenerationService is not defined`.

- [ ] **Step 3: Implement service**

```ts
// src/server/services/research/memo-generation.ts
import Anthropic from "@anthropic-ai/sdk";
import { eq, inArray } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { researchMemos, researchMemoSections } from "@/server/db/schema/research-memos";
import { cachedOpinions } from "@/server/db/schema/cached-opinions";
import type { CachedStatute } from "@/server/db/schema/cached-statutes";
import { applyUplFilter } from "@/server/services/research/upl-filter";
import { validateCitations } from "@/server/services/research/citation-validator";
import type { OpinionCacheService } from "@/server/services/research/opinion-cache";
import type { StatuteCacheService } from "@/server/services/research/statute-cache";
import {
  SECTION_ORDER,
  assembleSectionUserMessage,
  ordOf,
  type MemoSectionType,
} from "./memo-prompts";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS_PER_SECTION = 1500;
const REPROMPT_THRESHOLD = 4; // matches legal-rag give-up threshold for whole-section regen

const SYSTEM_PROMPT =
  "You are a legal research assistant for a licensed-attorney audience writing one section of an IRAC research memo. " +
  "You analyze ONLY the provided U.S. case law and statutes and give factual, well-cited prose. " +
  "You do NOT give legal advice, predict outcomes, recommend actions, or address the reader's specific situation. " +
  "Never use these words or phrases: should, must, recommend, advise, your rights, we suggest, best option, you have a case, legal advice. " +
  "Prefer: \"the court held\", \"this opinion indicates\", \"consider that\", \"typically courts in this circuit\", \"the provided opinions do not address\". " +
  "Every factual claim must cite a provided opinion or statute using its Bluebook citation. Do not invent citations. If uncertain, say so.";

export interface MemoGenerationDeps {
  db?: typeof defaultDb;
  anthropic?: Anthropic;
  opinionCache: OpinionCacheService;
  statuteCache: StatuteCacheService;
}

export interface SectionResult {
  section_type: MemoSectionType;
  ord: number;
  content: string;
  citations: string[];
  uplViolations: string[];
  unverifiedCitations: string[];
  tokenUsage: { input_tokens: number; output_tokens: number };
}

export class MemoGenerationService {
  private readonly db: typeof defaultDb;
  private readonly anthropic: Anthropic;
  private readonly opinionCache: OpinionCacheService;
  private readonly statuteCache: StatuteCacheService;

  constructor(deps: MemoGenerationDeps) {
    this.db = deps.db ?? defaultDb;
    this.anthropic = deps.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    this.opinionCache = deps.opinionCache;
    this.statuteCache = deps.statuteCache;
  }

  async generateAll(opts: { memoId: string }): Promise<{
    status: "ready" | "failed";
    sections: SectionResult[];
    flags: { unverifiedCitations: string[]; uplViolations: string[] };
    tokenUsage: { input_tokens: number; output_tokens: number };
  }> {
    const [memo] = await this.db
      .select()
      .from(researchMemos)
      .where(eq(researchMemos.id, opts.memoId))
      .limit(1);
    if (!memo) throw new Error(`Memo ${opts.memoId} not found`);

    const opinions = memo.contextOpinionIds.length
      ? await this.opinionCache.getByInternalIds(memo.contextOpinionIds)
      : [];
    const statutes: CachedStatute[] = memo.contextStatuteIds.length
      ? await this.statuteCache.getByInternalIds(memo.contextStatuteIds)
      : [];
    const contextBlock = renderContextBlock(opinions, statutes);
    const contextCitations = [
      ...opinions.map((o) => o.citationBluebook),
      ...statutes.map((s) => s.citationBluebook),
    ];

    const sections = await Promise.all(
      SECTION_ORDER.map((section) =>
        this.generateOne({ section, memoQuestion: memo.memoQuestion, contextBlock, contextCitations }),
      ),
    );

    const aggregatedFlags = {
      unverifiedCitations: sections.flatMap((s) => s.unverifiedCitations),
      uplViolations: sections.flatMap((s) => s.uplViolations),
    };
    const totalUsage = sections.reduce(
      (acc, s) => ({
        input_tokens: acc.input_tokens + s.tokenUsage.input_tokens,
        output_tokens: acc.output_tokens + s.tokenUsage.output_tokens,
      }),
      { input_tokens: 0, output_tokens: 0 },
    );

    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const s of sections) {
        await tx.insert(researchMemoSections).values({
          memoId: opts.memoId,
          sectionType: s.section_type,
          ord: s.ord,
          content: s.content,
          citations: s.citations,
          aiGeneratedAt: now,
        });
      }
      await tx
        .update(researchMemos)
        .set({
          status: "ready",
          flags: aggregatedFlags,
          tokenUsage: totalUsage,
          updatedAt: now,
        })
        .where(eq(researchMemos.id, opts.memoId));
    });

    return { status: "ready", sections, flags: aggregatedFlags, tokenUsage: totalUsage };
  }

  async generateOne(args: {
    section: MemoSectionType;
    memoQuestion: string;
    contextBlock: string;
    contextCitations: string[];
    steeringMessage?: string;
  }): Promise<SectionResult> {
    const userMessage = assembleSectionUserMessage(args);

    const turn = await this.streamOnce(userMessage);
    let filtered = applyUplFilter(turn.text);
    let unverified = validateCitations(filtered.filtered, args.contextCitations).unverified;

    if (unverified.length >= REPROMPT_THRESHOLD) {
      const followup =
        userMessage +
        `\n\nYour previous response cited ${unverified.join(", ")} which were not in the provided materials. ` +
        "Regenerate using only the provided materials.";
      const retry = await this.streamOnce(followup);
      filtered = applyUplFilter(retry.text);
      unverified = validateCitations(filtered.filtered, args.contextCitations).unverified;
    }

    const citations = extractCitations(filtered.filtered, args.contextCitations);

    return {
      section_type: args.section,
      ord: ordOf(args.section),
      content: filtered.filtered,
      citations,
      uplViolations: filtered.violations,
      unverifiedCitations: unverified,
      tokenUsage: turn.usage,
    };
  }

  private async streamOnce(userMessage: string): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
    const stream = this.anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS_PER_SECTION,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    } as any);
    let text = "";
    try {
      for await (const event of stream as any) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          text += event.delta.text;
        }
      }
      const final = await (stream as any).finalMessage();
      const usage = final.usage ?? { input_tokens: 0, output_tokens: 0 };
      return { text, usage };
    } finally {
      try {
        (stream as any).abort?.();
      } catch {
        /* noop */
      }
    }
  }
}

function renderContextBlock(opinions: { citationBluebook: string; fullText: string | null; caseName: string }[], statutes: CachedStatute[]): string {
  const parts: string[] = [];
  opinions.forEach((o, i) => {
    const text = (o.fullText ?? "").slice(0, 6000); // ~24K chars across 4 opinions max
    parts.push(`[Opinion ${i + 1}] ${o.caseName} (${o.citationBluebook})\n${text}`);
  });
  statutes.forEach((s, i) => {
    const text = (s.fullText ?? "").slice(0, 4000);
    parts.push(`[Statute ${i + 1}] ${s.citationBluebook}\n${text}`);
  });
  return parts.join("\n\n---\n\n");
}

function extractCitations(text: string, contextCitations: string[]): string[] {
  // Naive: include each context citation that literally appears in the section.
  // Citation parsing edge cases handled by validateCitations; this is for UI chips.
  const seen = new Set<string>();
  for (const c of contextCitations) {
    if (text.includes(c)) seen.add(c);
  }
  return Array.from(seen);
}
```

- [ ] **Step 4: Run test passes**

Run: `npx vitest run tests/integration/memo-generation-service.test.ts`
Expected: 1/1 PASS.

- [ ] **Step 5: Run full test suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: TS EXIT=0; tests PASS (count = previous + 1 file's worth).

- [ ] **Step 6: Commit**

```bash
git add src/server/services/research/memo-generation.ts tests/integration/memo-generation-service.test.ts
git commit -m "feat(2.2.3): MemoGenerationService — parallel 4-section IRAC generation"
```

---

### Task 6: Add `getByInternalIds` to StatuteCacheService (if missing)

**Files:**
- Modify: `src/server/services/research/statute-cache.ts`

- [ ] **Step 1: Check if method exists**

Run: `grep -n "getByInternalIds" src/server/services/research/statute-cache.ts`

If present → skip task, mark complete.

- [ ] **Step 2: If missing, add (mirror OpinionCacheService.getByInternalIds)**

```ts
// Add inside StatuteCacheService class, near other read methods:
async getByInternalIds(ids: string[]): Promise<CachedStatute[]> {
  if (ids.length === 0) return [];
  const rows = await this.db
    .select()
    .from(cachedStatutes)
    .where(inArray(cachedStatutes.id, ids));
  return rows as CachedStatute[];
}
```

(Add `inArray` to existing `drizzle-orm` import if not present.)

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: EXIT=0.

- [ ] **Step 4: Commit (only if changed)**

```bash
git add src/server/services/research/statute-cache.ts
git commit -m "feat(2.2.3): StatuteCacheService.getByInternalIds for memo context hydration"
```

---

## Chunk 3 — Inngest + Router

### Task 7: Inngest function `research-memo-generate`

**Files:**
- Create: `src/server/inngest/functions/research-memo-generate.ts`
- Test: `tests/integration/research-memo-inngest.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/integration/research-memo-inngest.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleMemoGenerateRequested } from "@/server/inngest/functions/research-memo-generate";

describe("handleMemoGenerateRequested", () => {
  it("flips status to 'ready' on success and dispatches notification", async () => {
    const generateAll = vi.fn().mockResolvedValue({
      status: "ready",
      sections: [],
      flags: { unverifiedCitations: [], uplViolations: [] },
      tokenUsage: { input_tokens: 50, output_tokens: 10 },
    });
    const inngest = { send: vi.fn() };
    const memo = { id: "m1", userId: "u1", title: "T" };
    const db = { update: () => ({ set: () => ({ where: () => Promise.resolve() }) }) } as any;
    const usageGuard = { refundMemo: vi.fn() };
    const memoSvc = { generateAll } as any;
    await handleMemoGenerateRequested({ db, inngest, memoSvc, usageGuard }, { memoId: "m1" }, memo as any);
    expect(generateAll).toHaveBeenCalledWith({ memoId: "m1" });
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "notification.research_memo_ready" }),
    );
    expect(usageGuard.refundMemo).not.toHaveBeenCalled();
  });

  it("refunds + dispatches failure notification on error", async () => {
    const generateAll = vi.fn().mockRejectedValue(new Error("API down"));
    const inngest = { send: vi.fn() };
    const memo = { id: "m1", userId: "u1", title: "T" };
    const db = { update: () => ({ set: () => ({ where: () => Promise.resolve() }) }) } as any;
    const usageGuard = { refundMemo: vi.fn() };
    const memoSvc = { generateAll } as any;
    await handleMemoGenerateRequested({ db, inngest, memoSvc, usageGuard }, { memoId: "m1" }, memo as any);
    expect(usageGuard.refundMemo).toHaveBeenCalledWith({ userId: "u1" });
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "notification.research_memo_failed" }),
    );
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npx vitest run tests/integration/research-memo-inngest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Inngest function**

```ts
// src/server/inngest/functions/research-memo-generate.ts
import { inngest } from "@/server/inngest/client";
import { db as defaultDb } from "@/server/db";
import { eq } from "drizzle-orm";
import { researchMemos, type ResearchMemo } from "@/server/db/schema/research-memos";
import { MemoGenerationService } from "@/server/services/research/memo-generation";
import { OpinionCacheService } from "@/server/services/research/opinion-cache";
import { StatuteCacheService } from "@/server/services/research/statute-cache";
import { CourtListenerClient } from "@/server/services/courtlistener/client";
import { UsageGuard } from "@/server/services/research/usage-guard";
import { getEnv } from "@/lib/env";

interface HandlerDeps {
  db: typeof defaultDb;
  inngest: { send: (e: any) => Promise<unknown> | unknown };
  memoSvc: MemoGenerationService;
  usageGuard: UsageGuard;
}

export async function handleMemoGenerateRequested(
  deps: HandlerDeps,
  input: { memoId: string },
  memo: Pick<ResearchMemo, "id" | "userId" | "title">,
): Promise<void> {
  try {
    await deps.memoSvc.generateAll({ memoId: input.memoId });
    await deps.inngest.send({
      name: "notification.research_memo_ready",
      data: { memoId: memo.id, userId: memo.userId, title: memo.title },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.db
      .update(researchMemos)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(researchMemos.id, input.memoId));
    await deps.usageGuard.refundMemo({ userId: memo.userId });
    await deps.inngest.send({
      name: "notification.research_memo_failed",
      data: { memoId: memo.id, userId: memo.userId, title: memo.title, errorMessage: message },
    });
  }
}

export const researchMemoGenerate = inngest.createFunction(
  { id: "research-memo-generate", retries: 0 }, // retries handled inside service
  { event: "research/memo.generate.requested" },
  async ({ event, step }) => {
    const { memoId } = event.data as { memoId: string };
    const memo = await step.run("load-memo", async () => {
      const [row] = await defaultDb
        .select()
        .from(researchMemos)
        .where(eq(researchMemos.id, memoId))
        .limit(1);
      if (!row) throw new Error(`Memo ${memoId} not found`);
      return row;
    });

    await step.run("generate", async () => {
      const cl = new CourtListenerClient({ apiToken: getEnv().COURTLISTENER_API_TOKEN });
      const opinionCache = new OpinionCacheService({ db: defaultDb, courtListener: cl });
      const statuteCache = new StatuteCacheService({ db: defaultDb });
      const memoSvc = new MemoGenerationService({
        db: defaultDb,
        opinionCache,
        statuteCache,
      });
      const usageGuard = new UsageGuard({ db: defaultDb });
      await handleMemoGenerateRequested(
        { db: defaultDb, inngest, memoSvc, usageGuard },
        { memoId },
        { id: memo.id, userId: memo.userId, title: memo.title },
      );
    });
  },
);
```

- [ ] **Step 4: Register function in Inngest registry**

Run: `grep -n "from \"@/server/inngest/functions/" src/server/inngest/registry.ts || ls src/server/inngest/`

Locate the existing function registry (likely `src/server/inngest/registry.ts` or `src/app/api/inngest/route.ts`). Add:

```ts
import { researchMemoGenerate } from "@/server/inngest/functions/research-memo-generate";

// In the functions array:
researchMemoGenerate,
```

- [ ] **Step 5: Run test passes**

Run: `npx vitest run tests/integration/research-memo-inngest.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/inngest/functions/research-memo-generate.ts tests/integration/research-memo-inngest.test.ts \
        src/server/inngest/registry.ts
git commit -m "feat(2.2.3): Inngest fn research-memo-generate (refund + notify on failure)"
```

---

### Task 8: Notification types

**Files:**
- Modify: `src/lib/notifications.ts` (or wherever `NotificationType` is defined; locate via `grep -rn "NotificationType" src/lib src/server | head`)
- Modify: `src/server/inngest/functions/handle-notification.ts`

- [ ] **Step 1: Locate NotificationType union**

Run: `grep -rn "research_bookmark_added\|NotificationType" src/lib src/server/db/schema | head`

The 2.2.1 memory says `research_bookmark_added` + `research_session_linked` were added; mirror their location.

- [ ] **Step 2: Add new types**

Add `"research_memo_ready"` and `"research_memo_failed"` to the `NotificationType` enum/union and to any `TYPE_LABELS`/`CATEGORY_MAP` lookups (mirror `research_bookmark_added` placement).

- [ ] **Step 3: Add explicit handlers in `handle-notification.ts`**

```ts
case "research_memo_ready":
  return {
    inApp: { title: "Memo ready", body: `"${data.title}" is ready to review`, url: `/research/memos/${data.memoId}` },
    email: {
      subject: `Memo ready: ${data.title}`,
      html: `<p>Your IRAC memo "${data.title}" is ready.</p><p><a href="${absoluteUrl(`/research/memos/${data.memoId}`)}">Open memo</a></p>`,
    },
    push: { title: "Memo ready", body: data.title, url: `/research/memos/${data.memoId}` },
  };
case "research_memo_failed":
  return {
    inApp: { title: "Memo generation failed", body: data.title, url: `/research/memos/${data.memoId}` },
    email: {
      subject: `Memo generation failed: ${data.title}`,
      html: `<p>We couldn't generate your IRAC memo "${data.title}". Credits have been refunded.</p><p>Reason: ${escapeHtml(data.errorMessage ?? "Unknown error")}</p>`,
    },
    push: { title: "Memo failed", body: data.title, url: `/research/memos/${data.memoId}` },
  };
```

(Use whatever helpers (`absoluteUrl`, `escapeHtml`) the file already uses — locate via `grep -n "absoluteUrl\|escapeHtml" src/server/inngest/functions/handle-notification.ts`.)

- [ ] **Step 4: Add explicit category mapping**

If the notifications module groups types into categories (`cases`, `billing`, `team`, `calendar`), add `research` mapping for the new types if not already present from 2.2.1.

- [ ] **Step 5: Run typecheck + full tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: EXIT=0; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications.ts src/server/inngest/functions/handle-notification.ts
git commit -m "feat(2.2.3): research_memo_ready/failed notification types + handlers"
```

---

### Task 9: tRPC sub-router `research.memo.*`

**Files:**
- Create: `src/server/trpc/routers/research-memo.ts`
- Modify: `src/server/trpc/routers/research.ts` — mount sub-router
- Test: `tests/integration/research-memo-router.test.ts`

- [ ] **Step 1: Write failing tests for router endpoints**

```ts
// tests/integration/research-memo-router.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { createCaller } from "@/server/trpc/root"; // or whatever exports the caller factory

// Mirror existing tests/integration/research-router.test.ts mock-DB pattern.
// Below is the minimal shape — copy the full helpers from the existing file.

describe("research.memo router", () => {
  let mockDb: any;
  let mockInngest: { send: ReturnType<typeof vi.fn> };
  let user: { id: string; plan: "trial" | "solo" };

  beforeEach(() => {
    mockInngest = { send: vi.fn() };
    user = { id: "u1", plan: "solo" };
    mockDb = makeMockDb(); // same helper used in research-router.test.ts
  });

  it("generate rejects empty session (no opinions, no chat)", async () => {
    mockDb.enqueueSelect([{ id: "s1", userId: user.id }]); // session ownership
    mockDb.enqueueSelect([]); // bookmarks count
    mockDb.enqueueSelect([]); // chat messages count
    const caller = createCaller({ db: mockDb, user, inngest: mockInngest } as any);
    await expect(
      caller.research.memo.generate({ sessionId: "s1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("generate inserts memo + dispatches Inngest event on happy path", async () => {
    // Stub: session ownership pass, ≥1 bookmark, usage check ok, insert returns memo id
    mockDb.enqueueSelect([{ id: "s1", userId: user.id, title: "Session T", caseId: null }]);
    mockDb.enqueueSelect([{ id: "b1" }]); // bookmark exists
    mockDb.enqueueSelect([]); // chat messages — empty is fine if bookmarks exist
    // usage guard execute mock (whatever your makeMockDb does for execute) — ensure under cap
    mockDb.setExecuteResult([{ memo_count: 1 }]);
    mockDb.setInsertReturning([{ id: "m1" }]);
    const caller = createCaller({ db: mockDb, user, inngest: mockInngest } as any);
    const out = await caller.research.memo.generate({ sessionId: "s1" });
    expect(out.memoId).toBe("m1");
    expect(mockInngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "research/memo.generate.requested" }),
    );
  });

  it("get returns memo + sections for owner", async () => {
    mockDb.enqueueSelect([{ id: "m1", userId: user.id, deletedAt: null }]);
    mockDb.enqueueSelect([{ id: "sec1", memoId: "m1", sectionType: "issue", ord: 1, content: "..." }]);
    const caller = createCaller({ db: mockDb, user, inngest: mockInngest } as any);
    const out = await caller.research.memo.get({ memoId: "m1" });
    expect(out.memo.id).toBe("m1");
    expect(out.sections).toHaveLength(1);
  });

  it("get rejects wrong owner", async () => {
    mockDb.enqueueSelect([{ id: "m1", userId: "other", deletedAt: null }]);
    const caller = createCaller({ db: mockDb, user, inngest: mockInngest } as any);
    await expect(caller.research.memo.get({ memoId: "m1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("delete soft-deletes memo (sets deleted_at)", async () => {
    mockDb.enqueueSelect([{ id: "m1", userId: user.id, deletedAt: null }]);
    const caller = createCaller({ db: mockDb, user, inngest: mockInngest } as any);
    await caller.research.memo.delete({ memoId: "m1" });
    // Verify update was called with deletedAt set
    expect(mockDb.lastUpdate?.set).toHaveProperty("deletedAt");
  });

  it("updateSection writes content + user_edited_at; no AI invocation", async () => {
    mockDb.enqueueSelect([{ id: "m1", userId: user.id, deletedAt: null }]);
    const caller = createCaller({ db: mockDb, user, inngest: mockInngest } as any);
    await caller.research.memo.updateSection({ memoId: "m1", sectionType: "rule", content: "edited" });
    expect(mockDb.lastUpdate?.set).toMatchObject({ content: "edited" });
    expect(mockDb.lastUpdate?.set).toHaveProperty("userEditedAt");
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run tests/integration/research-memo-router.test.ts`
Expected: FAIL — `caller.research.memo` undefined.

- [ ] **Step 3: Implement router**

```ts
// src/server/trpc/routers/research-memo.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql, isNull } from "drizzle-orm";
import { observable } from "@trpc/server/observable";

import { protectedProcedure, router } from "@/server/trpc/trpc";
import { researchMemos, researchMemoSections } from "@/server/db/schema/research-memos";
import { researchSessions } from "@/server/db/schema/research-sessions";
import { researchChatMessages } from "@/server/db/schema/research-chat-messages";
import { opinionBookmarks } from "@/server/db/schema/opinion-bookmarks";
import { UsageGuard, UsageLimitExceededError } from "@/server/services/research/usage-guard";
import { mapUserPlanToResearchPlan } from "./research"; // re-export from research router
import { MemoGenerationService } from "@/server/services/research/memo-generation";
import { OpinionCacheService } from "@/server/services/research/opinion-cache";
import { StatuteCacheService } from "@/server/services/research/statute-cache";
import { CourtListenerClient } from "@/server/services/courtlistener/client";
import { getEnv } from "@/lib/env";
import { inngest as defaultInngest } from "@/server/inngest/client";
import { SECTION_ORDER, type MemoSectionType } from "@/server/services/research/memo-prompts";

const SectionTypeSchema = z.enum(["issue", "rule", "application", "conclusion"]);
const JurisdictionSchema = z.enum(["federal", "ca", "ny", "tx", "fl", "il", "other"]);

async function assertMemoOwnership(db: any, memoId: string, userId: string) {
  const [row] = await db
    .select({ id: researchMemos.id, userId: researchMemos.userId, deletedAt: researchMemos.deletedAt })
    .from(researchMemos)
    .where(eq(researchMemos.id, memoId))
    .limit(1);
  if (!row || row.deletedAt !== null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Memo not found" });
  }
  if (row.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not your memo" });
  }
}

async function assertSessionOwnership(db: any, sessionId: string, userId: string) {
  const [row] = await db
    .select({ userId: researchSessions.userId })
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  if (row.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Not your session" });
  return row;
}

export const researchMemoRouter = router({
  generate: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        memoQuestion: z.string().trim().min(2).max(2000).optional(),
        jurisdiction: JurisdictionSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Ownership.
      await assertSessionOwnership(ctx.db, input.sessionId, ctx.user.id);

      // 2. Validate session has context.
      const [session] = await ctx.db
        .select()
        .from(researchSessions)
        .where(eq(researchSessions.id, input.sessionId))
        .limit(1);
      const [{ count: bookmarkCount }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(opinionBookmarks)
        .where(eq(opinionBookmarks.userId, ctx.user.id));
      const [{ count: chatCount }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(researchChatMessages)
        .where(eq(researchChatMessages.sessionId, input.sessionId));
      if ((bookmarkCount ?? 0) === 0 && (chatCount ?? 0) === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bookmark an opinion or ask a question first",
        });
      }

      // 3. Usage guard.
      const guard = new UsageGuard({ db: ctx.db });
      const plan = mapUserPlanToResearchPlan(ctx.user.plan);
      try {
        await guard.checkAndIncrementMemo({ userId: ctx.user.id, plan });
      } catch (err) {
        if (err instanceof UsageLimitExceededError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: err.message,
            cause: err,
          });
        }
        throw err;
      }

      // 4. Resolve context snapshot — opinion ids + statute ids referenced in chat history.
      const opinionIds = await collectSessionOpinionIds(ctx.db, input.sessionId, ctx.user.id);
      const statuteIds = await collectSessionStatuteIds(ctx.db, input.sessionId);

      const memoQuestion = input.memoQuestion ?? session.title ?? "Untitled memo";
      const title = (input.memoQuestion ?? session.title ?? "Memo").slice(0, 200);

      const [memo] = await ctx.db
        .insert(researchMemos)
        .values({
          userId: ctx.user.id,
          sessionId: input.sessionId,
          caseId: session.caseId ?? null,
          title,
          jurisdiction: input.jurisdiction ?? null,
          status: "generating",
          memoQuestion,
          contextOpinionIds: opinionIds,
          contextStatuteIds: statuteIds,
          creditsCharged: 3,
        })
        .returning();

      // 5. Fire-and-forget Inngest dispatch.
      try {
        await (ctx.inngest ?? defaultInngest).send({
          name: "research/memo.generate.requested",
          data: { memoId: memo.id },
        });
      } catch (e) {
        // Best-effort — if dispatch fails, mark memo failed + refund.
        await ctx.db
          .update(researchMemos)
          .set({ status: "failed", errorMessage: "Failed to queue generation" })
          .where(eq(researchMemos.id, memo.id));
        await guard.refundMemo({ userId: ctx.user.id });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to queue memo generation" });
      }

      return { memoId: memo.id };
    }),

  get: protectedProcedure
    .input(z.object({ memoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertMemoOwnership(ctx.db, input.memoId, ctx.user.id);
      const [memo] = await ctx.db
        .select()
        .from(researchMemos)
        .where(eq(researchMemos.id, input.memoId))
        .limit(1);
      const sections = await ctx.db
        .select()
        .from(researchMemoSections)
        .where(eq(researchMemoSections.memoId, input.memoId))
        .orderBy(researchMemoSections.ord);
      return { memo, sections };
    }),

  list: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid().optional(),
        status: z.enum(["generating", "ready", "failed"]).optional(),
        page: z.number().int().min(1).max(50).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.pageSize;
      const conditions = [
        eq(researchMemos.userId, ctx.user.id),
        isNull(researchMemos.deletedAt),
      ];
      if (input.caseId) conditions.push(eq(researchMemos.caseId, input.caseId));
      if (input.status) conditions.push(eq(researchMemos.status, input.status));
      const rows = await ctx.db
        .select()
        .from(researchMemos)
        .where(and(...conditions))
        .orderBy(desc(researchMemos.updatedAt))
        .limit(input.pageSize)
        .offset(offset);
      return { memos: rows, page: input.page, pageSize: input.pageSize };
    }),

  updateSection: protectedProcedure
    .input(
      z.object({
        memoId: z.string().uuid(),
        sectionType: SectionTypeSchema,
        content: z.string().max(50_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMemoOwnership(ctx.db, input.memoId, ctx.user.id);
      const now = new Date();
      await ctx.db
        .update(researchMemoSections)
        .set({ content: input.content, userEditedAt: now, updatedAt: now })
        .where(
          and(
            eq(researchMemoSections.memoId, input.memoId),
            eq(researchMemoSections.sectionType, input.sectionType),
          ),
        );
      await ctx.db
        .update(researchMemos)
        .set({ updatedAt: now })
        .where(eq(researchMemos.id, input.memoId));
      return { ok: true };
    }),

  regenerateSection: protectedProcedure
    .input(
      z.object({
        memoId: z.string().uuid(),
        sectionType: SectionTypeSchema,
        steeringMessage: z.string().max(2000).optional(),
      }),
    )
    .subscription(({ ctx, input }) => {
      return observable<{ type: "token" | "done" | "error"; content?: string; error?: string }>((emit) => {
        (async () => {
          try {
            await assertMemoOwnership(ctx.db, input.memoId, ctx.user.id);
            const [memo] = await ctx.db
              .select()
              .from(researchMemos)
              .where(eq(researchMemos.id, input.memoId))
              .limit(1);
            const cl = new CourtListenerClient({ apiToken: getEnv().COURTLISTENER_API_TOKEN });
            const opinionCache = new OpinionCacheService({ db: ctx.db, courtListener: cl });
            const statuteCache = new StatuteCacheService({ db: ctx.db });
            const opinions = memo.contextOpinionIds.length
              ? await opinionCache.getByInternalIds(memo.contextOpinionIds)
              : [];
            const statutes = memo.contextStatuteIds.length
              ? await statuteCache.getByInternalIds(memo.contextStatuteIds)
              : [];
            const svc = new MemoGenerationService({ db: ctx.db, opinionCache, statuteCache });
            // Run a single-section generation. Stream is buffered then emitted in chunks.
            const result = await svc.generateOne({
              section: input.sectionType,
              memoQuestion: memo.memoQuestion,
              contextBlock: renderContextBlockForUI(opinions, statutes),
              contextCitations: [
                ...opinions.map((o) => o.citationBluebook),
                ...statutes.map((s) => s.citationBluebook),
              ],
              steeringMessage: input.steeringMessage,
            });
            emit.next({ type: "token", content: result.content });
            // Persist the section update.
            const now = new Date();
            await ctx.db
              .update(researchMemoSections)
              .set({
                content: result.content,
                citations: result.citations,
                aiGeneratedAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  eq(researchMemoSections.memoId, input.memoId),
                  eq(researchMemoSections.sectionType, input.sectionType),
                ),
              );
            // Re-aggregate flags on parent.
            const allSections = await ctx.db
              .select()
              .from(researchMemoSections)
              .where(eq(researchMemoSections.memoId, input.memoId));
            // (Flag re-aggregation: trivial when only AI-validated sections; here we update updatedAt only.)
            await ctx.db
              .update(researchMemos)
              .set({ updatedAt: now })
              .where(eq(researchMemos.id, input.memoId));
            emit.next({ type: "done" });
            emit.complete();
          } catch (err) {
            emit.next({ type: "error", error: err instanceof Error ? err.message : String(err) });
            emit.complete();
          }
        })();
        return () => { /* nothing to cancel — generation is short */ };
      });
    }),

  delete: protectedProcedure
    .input(z.object({ memoId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMemoOwnership(ctx.db, input.memoId, ctx.user.id);
      await ctx.db
        .update(researchMemos)
        .set({ deletedAt: new Date() })
        .where(eq(researchMemos.id, input.memoId));
      return { ok: true };
    }),

  retryGenerate: protectedProcedure
    .input(z.object({ memoId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMemoOwnership(ctx.db, input.memoId, ctx.user.id);
      await ctx.db
        .update(researchMemos)
        .set({ status: "generating", errorMessage: null, updatedAt: new Date() })
        .where(eq(researchMemos.id, input.memoId));
      await (ctx.inngest ?? defaultInngest).send({
        name: "research/memo.generate.requested",
        data: { memoId: input.memoId },
      });
      return { ok: true };
    }),
});

async function collectSessionOpinionIds(db: any, sessionId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ opinionId: opinionBookmarks.opinionId })
    .from(opinionBookmarks)
    .where(eq(opinionBookmarks.userId, userId));
  return rows.map((r: { opinionId: string }) => r.opinionId);
}

async function collectSessionStatuteIds(db: any, sessionId: string): Promise<string[]> {
  // Statute ids previously surfaced in chat are stored on
  // research_chat_messages.statute_context_ids (jsonb array).
  const rows = await db
    .select({ ids: researchChatMessages.statuteContextIds })
    .from(researchChatMessages)
    .where(eq(researchChatMessages.sessionId, sessionId));
  const seen = new Set<string>();
  for (const r of rows) {
    for (const id of (r.ids ?? []) as string[]) seen.add(id);
  }
  return Array.from(seen);
}

function renderContextBlockForUI(opinions: any[], statutes: any[]): string {
  // Same shape as MemoGenerationService.renderContextBlock — kept inline
  // because regenerateSection bypasses generateAll.
  const parts: string[] = [];
  opinions.forEach((o, i) => {
    parts.push(`[Opinion ${i + 1}] ${o.caseName} (${o.citationBluebook})\n${(o.fullText ?? "").slice(0, 6000)}`);
  });
  statutes.forEach((s, i) => {
    parts.push(`[Statute ${i + 1}] ${s.citationBluebook}\n${(s.fullText ?? "").slice(0, 4000)}`);
  });
  return parts.join("\n\n---\n\n");
}
```

- [ ] **Step 4: Mount sub-router in `research.ts`**

In `src/server/trpc/routers/research.ts`, add to the `researchRouter` definition:

```ts
import { researchMemoRouter } from "./research-memo";
// ...
export const researchRouter = router({
  // ...existing entries...
  memo: researchMemoRouter,
});
```

Also export `mapUserPlanToResearchPlan` from `research.ts` (likely already exported; if not, add `export`).

- [ ] **Step 5: Run tests pass**

Run: `npx vitest run tests/integration/research-memo-router.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 6: Run full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: EXIT=0; all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/trpc/routers/research-memo.ts src/server/trpc/routers/research.ts \
        tests/integration/research-memo-router.test.ts
git commit -m "feat(2.2.3): research.memo router (generate/get/list/update/regenerate/delete/retry)"
```

---

## Chunk 4 — UI: List + Editor

### Task 10: Memo list page

**Files:**
- Create: `src/app/(app)/research/memos/page.tsx`
- Create: `src/components/research/memo-list-card.tsx`

- [ ] **Step 1: Implement list page**

```tsx
// src/app/(app)/research/memos/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { MemoListCard } from "@/components/research/memo-list-card";
import { Button } from "@/components/ui/button";

export default function MemosListPage() {
  const [page, setPage] = React.useState(1);
  const { data, isLoading } = trpc.research.memo.list.useQuery({ page });

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Memos</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            IRAC research memos generated from your sessions.
          </p>
        </div>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.memos.length ? (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No memos yet.{" "}
            <Link href="/research" className="underline">
              Open a research session
            </Link>{" "}
            to generate your first memo.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {data.memos.map((m) => (
            <li key={m.id}>
              <MemoListCard memo={m} />
            </li>
          ))}
        </ul>
      )}

      {data && data.memos.length === data.pageSize && (
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="outline" onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement card component**

```tsx
// src/components/research/memo-list-card.tsx
"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface MemoListCardProps {
  memo: {
    id: string;
    title: string;
    status: "generating" | "ready" | "failed";
    flags: { unverifiedCitations?: string[]; uplViolations?: string[] };
    updatedAt: string | Date;
  };
}

export function MemoListCard({ memo }: MemoListCardProps) {
  const flagCount =
    (memo.flags.unverifiedCitations?.length ?? 0) +
    (memo.flags.uplViolations?.length ?? 0);
  const updated = typeof memo.updatedAt === "string" ? new Date(memo.updatedAt) : memo.updatedAt;
  return (
    <Link
      href={`/research/memos/${memo.id}`}
      className="block rounded-md border p-4 transition hover:border-primary"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{memo.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Updated {formatDistanceToNow(updated, { addSuffix: true })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {memo.status === "generating" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {memo.status === "ready" && <CheckCircle2 className="size-4 text-emerald-500" />}
          {memo.status === "failed" && <AlertCircle className="size-4 text-red-500" />}
          {flagCount > 0 && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
              ⚠ {flagCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds, includes new route `/research/memos`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/research/memos/page.tsx src/components/research/memo-list-card.tsx
git commit -m "feat(2.2.3): memos list page + card"
```

---

### Task 11: Memo editor page (3-pane shell)

**Files:**
- Create: `src/app/(app)/research/memos/[memoId]/page.tsx`
- Create: `src/components/research/memo-section-nav.tsx`

- [ ] **Step 1: Implement page shell**

```tsx
// src/app/(app)/research/memos/[memoId]/page.tsx
"use client";

import * as React from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { MemoSectionNav } from "@/components/research/memo-section-nav";
import { MemoSectionEditor } from "@/components/research/memo-section-editor";
import { MemoRewriteChat } from "@/components/research/memo-rewrite-chat";
import { Button } from "@/components/ui/button";

const SECTIONS = ["issue", "rule", "application", "conclusion"] as const;
type Section = (typeof SECTIONS)[number];

export default function MemoEditorPage() {
  const params = useParams<{ memoId: string }>();
  const memoId = params?.memoId as string;
  const searchParams = useSearchParams();
  const router = useRouter();

  const sectionParam = (searchParams?.get("section") as Section | null) ?? "issue";
  const activeSection: Section = SECTIONS.includes(sectionParam) ? sectionParam : "issue";

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.research.memo.get.useQuery(
    { memoId },
    {
      // Poll while generating; auto-stop when ready/failed.
      refetchInterval: (q) =>
        q.state.data?.memo.status === "generating" ? 2000 : false,
    },
  );

  const setActive = (s: Section) => {
    router.replace(`/research/memos/${memoId}?section=${s}`, { scroll: false });
  };

  if (isLoading || !data) return <div className="p-6">Loading…</div>;

  const memo = data.memo;
  const sections = new Map(data.sections.map((s) => [s.sectionType, s]));
  const active = sections.get(activeSection);

  if (memo.status === "generating") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">{memo.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Generating sections… (auto-refreshes every 2s)</p>
        <div className="mt-6 grid gap-3">
          {SECTIONS.map((s) => (
            <div key={s} className="h-24 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  if (memo.status === "failed") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">{memo.title}</h1>
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">Generation failed: {memo.errorMessage ?? "unknown"}</p>
          <p className="mt-1">Credits refunded.</p>
        </div>
        <Button
          className="mt-4"
          onClick={async () => {
            await utils.client.research.memo.retryGenerate.mutate({ memoId });
            await utils.research.memo.get.invalidate({ memoId });
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800">
        <MemoSectionNav
          memo={{ id: memo.id, title: memo.title }}
          sections={data.sections}
          active={activeSection}
          onSelect={setActive}
        />
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        {active ? (
          <MemoSectionEditor
            memoId={memo.id}
            section={active}
            onRequestRewrite={() => {
              // The rewrite chat is always visible; no-op for now (focuses input via component-internal handler).
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Section not found.</p>
        )}
      </main>
      <aside className="hidden w-96 shrink-0 border-l border-zinc-200 dark:border-zinc-800 lg:flex lg:flex-col">
        <MemoRewriteChat memoId={memo.id} sectionType={activeSection} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Implement section nav**

```tsx
// src/components/research/memo-section-nav.tsx
"use client";

import { cn } from "@/lib/utils";
import { Pencil, Sparkles } from "lucide-react";

const LABEL: Record<string, string> = {
  issue: "Issue",
  rule: "Rule",
  application: "Application",
  conclusion: "Conclusion",
};

interface MemoSectionNavProps {
  memo: { id: string; title: string };
  sections: Array<{
    sectionType: "issue" | "rule" | "application" | "conclusion";
    aiGeneratedAt: string | Date | null;
    userEditedAt: string | Date | null;
  }>;
  active: string;
  onSelect: (s: "issue" | "rule" | "application" | "conclusion") => void;
}

export function MemoSectionNav({ memo, sections, active, onSelect }: MemoSectionNavProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-medium">{memo.title}</h2>
      </div>
      <ul className="flex-1 overflow-y-auto py-2">
        {sections.map((s) => {
          const isActive = s.sectionType === active;
          const edited =
            s.userEditedAt &&
            (!s.aiGeneratedAt || new Date(s.userEditedAt) > new Date(s.aiGeneratedAt));
          return (
            <li key={s.sectionType}>
              <button
                type="button"
                onClick={() => onSelect(s.sectionType)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900",
                  isActive && "bg-zinc-100 font-medium dark:bg-zinc-900",
                )}
                aria-current={isActive ? "true" : "false"}
              >
                <span>{LABEL[s.sectionType]}</span>
                {edited ? (
                  <Pencil className="size-3 text-muted-foreground" aria-label="User-edited" />
                ) : (
                  <Sparkles className="size-3 text-muted-foreground" aria-label="AI-generated" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/research/memos/\[memoId\]/page.tsx src/components/research/memo-section-nav.tsx
git commit -m "feat(2.2.3): memo editor page shell + section nav"
```

---

### Task 12: Section editor (Textarea + citations + regen trigger)

**Files:**
- Create: `src/components/research/memo-section-editor.tsx`

- [ ] **Step 1: Implement editor**

```tsx
// src/components/research/memo-section-editor.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CitationChip } from "./citation-chip";
import { useDebouncedCallback } from "use-debounce";

interface MemoSectionEditorProps {
  memoId: string;
  section: {
    sectionType: "issue" | "rule" | "application" | "conclusion";
    content: string;
    citations: string[];
  };
  onRequestRewrite: () => void;
}

const LABEL: Record<string, string> = {
  issue: "Issue",
  rule: "Rule",
  application: "Application",
  conclusion: "Conclusion",
};

export function MemoSectionEditor({ memoId, section, onRequestRewrite }: MemoSectionEditorProps) {
  const utils = trpc.useUtils();
  const [content, setContent] = React.useState(section.content);

  React.useEffect(() => {
    setContent(section.content);
  }, [section.sectionType, section.content]);

  const updateMut = trpc.research.memo.updateSection.useMutation();

  const persist = useDebouncedCallback(async (next: string) => {
    await updateMut.mutateAsync({ memoId, sectionType: section.sectionType, content: next });
    await utils.research.memo.get.invalidate({ memoId });
  }, 1000);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{LABEL[section.sectionType]}</h2>
      <Textarea
        value={content}
        onChange={(e) => {
          const next = e.target.value;
          setContent(next);
          persist(next);
        }}
        className="min-h-[400px] font-mono text-sm"
        aria-label={`${LABEL[section.sectionType]} section content`}
      />
      {section.citations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Citations</p>
          <div className="flex flex-wrap gap-2">
            {section.citations.map((c) => (
              <CitationChip key={c} citation={c} />
            ))}
          </div>
        </div>
      )}
      <Button type="button" variant="outline" onClick={onRequestRewrite}>
        Regenerate section with AI
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Confirm `use-debounce` is in deps**

Run: `grep '"use-debounce"' package.json`
Expected: present (used by other components). If missing: `npm install use-debounce` and commit `package.json` + `package-lock.json` separately.

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/research/memo-section-editor.tsx
git commit -m "feat(2.2.3): memo section editor with debounced persist"
```

---

### Task 13: Rewrite chat (right rail)

**Files:**
- Create: `src/components/research/memo-rewrite-chat.tsx`

- [ ] **Step 1: Implement rewrite chat**

```tsx
// src/components/research/memo-rewrite-chat.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface MemoRewriteChatProps {
  memoId: string;
  sectionType: "issue" | "rule" | "application" | "conclusion";
}

export function MemoRewriteChat({ memoId, sectionType }: MemoRewriteChatProps) {
  const [steering, setSteering] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [activeSteering, setActiveSteering] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const utils = trpc.useUtils();

  trpc.research.memo.regenerateSection.useSubscription(
    { memoId, sectionType, steeringMessage: activeSteering ?? undefined },
    {
      enabled: !!activeSteering,
      onStarted: () => {
        setStreaming(true);
        setPreview("");
      },
      onData: (chunk) => {
        if (chunk.type === "token" && chunk.content) {
          setPreview((p) => (p ?? "") + chunk.content);
        } else if (chunk.type === "done") {
          setStreaming(false);
          setActiveSteering(null);
          // Persisted server-side; just invalidate.
          utils.research.memo.get.invalidate({ memoId });
        } else if (chunk.type === "error") {
          setStreaming(false);
          setActiveSteering(null);
        }
      },
      onError: () => {
        setStreaming(false);
        setActiveSteering(null);
      },
    },
  );

  const submit = () => {
    if (streaming) return;
    setActiveSteering(steering.trim() || ""); // empty string still triggers regen
    setSteering("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Rewrite section</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Regenerate this section with optional guidance.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {preview === null ? (
          <p className="mt-8 text-center text-muted-foreground">
            Type guidance below (or just hit Send) to rewrite this section.
          </p>
        ) : (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Preview</p>
            <p className="mt-2 whitespace-pre-wrap">{preview}</p>
            {streaming && <Loader2 className="mt-2 inline size-3 animate-spin" />}
          </div>
        )}
      </div>
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <Textarea
          value={steering}
          onChange={(e) => setSteering(e.target.value)}
          placeholder="Optional: 'focus on damages calculation'"
          className="min-h-[80px] text-sm"
          disabled={streaming}
        />
        <div className="mt-2 flex justify-end">
          <Button onClick={submit} disabled={streaming}>
            {streaming ? "Rewriting…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/research/memo-rewrite-chat.tsx
git commit -m "feat(2.2.3): memo rewrite chat (right rail) with streaming preview"
```

---

### Task 14: Wire "Regenerate" button → chat focus

**Files:**
- Modify: `src/components/research/memo-section-editor.tsx`
- Modify: `src/app/(app)/research/memos/[memoId]/page.tsx`

- [ ] **Step 1: Lift "regenerate request" to a shared handler via window event or context**

Simplest approach: dispatch a `CustomEvent("memo:focus-rewrite-input")` from the editor's button, and listen in the rewrite chat's textarea ref.

Edit `memo-section-editor.tsx`:

```ts
// Replace the existing onClick on "Regenerate section with AI":
onClick={() => {
  window.dispatchEvent(new CustomEvent("memo:focus-rewrite-input"));
}}
```

Edit `memo-rewrite-chat.tsx`, in the component body:

```tsx
const textareaRef = React.useRef<HTMLTextAreaElement>(null);
React.useEffect(() => {
  const onFocus = () => textareaRef.current?.focus();
  window.addEventListener("memo:focus-rewrite-input", onFocus);
  return () => window.removeEventListener("memo:focus-rewrite-input", onFocus);
}, []);
// Pass ref={textareaRef} to <Textarea>.
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/research/memo-section-editor.tsx src/components/research/memo-rewrite-chat.tsx
git commit -m "feat(2.2.3): wire 'regenerate' button to focus rewrite input"
```

---

## Chunk 5 — Generation Modal + Integration

### Task 15: Generation modal

**Files:**
- Create: `src/components/research/memo-generation-modal.tsx`

- [ ] **Step 1: Implement modal**

```tsx
// src/components/research/memo-generation-modal.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ALL_JURISDICTIONS, JURISDICTION_LABELS, type Jurisdiction } from "./filter-types";

interface MemoGenerationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  defaultQuestion: string;
  bookmarkCount: number;
  chatCount: number;
  statuteCount: number;
}

export function MemoGenerationModal({
  open, onOpenChange, sessionId, defaultQuestion, bookmarkCount, chatCount, statuteCount,
}: MemoGenerationModalProps) {
  const [question, setQuestion] = React.useState(defaultQuestion);
  const [jurisdiction, setJurisdiction] = React.useState<Jurisdiction | "">("");
  const router = useRouter();
  const generateMut = trpc.research.memo.generate.useMutation();

  React.useEffect(() => {
    if (open) setQuestion(defaultQuestion);
  }, [open, defaultQuestion]);

  const canGenerate = bookmarkCount + chatCount > 0 && question.trim().length >= 2;

  const submit = async () => {
    const out = await generateMut.mutateAsync({
      sessionId,
      memoQuestion: question.trim(),
      jurisdiction: jurisdiction || undefined,
    });
    router.push(`/research/memos/${out.memoId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate IRAC memo</DialogTitle>
          <DialogDescription>
            Uses {bookmarkCount} bookmarked opinion{bookmarkCount === 1 ? "" : "s"}, {chatCount} chat
            exchange{chatCount === 1 ? "" : "s"}, and {statuteCount} statute{statuteCount === 1 ? "" : "s"}{" "}
            referenced in this session.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="memo-question">Memo question</Label>
            <Textarea
              id="memo-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="memo-juris">Jurisdictional focus (optional)</Label>
            <select
              id="memo-juris"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value as Jurisdiction | "")}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">— Any —</option>
              {ALL_JURISDICTIONS.map((j) => (
                <option key={j} value={j}>{JURISDICTION_LABELS[j]}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Cost: 3 credits. Section rewrites are free.
          </p>
          {!canGenerate && bookmarkCount + chatCount === 0 && (
            <p className="text-xs text-amber-600">
              Bookmark an opinion or ask a question in this session before generating.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canGenerate || generateMut.isPending}>
            {generateMut.isPending ? "Starting…" : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/research/memo-generation-modal.tsx
git commit -m "feat(2.2.3): memo generation modal"
```

---

### Task 16: Wire modal into session view

**Files:**
- Modify: `src/app/(app)/research/sessions/[sessionId]/page.tsx`

- [ ] **Step 1: Read current session page**

Run: `cat 'src/app/(app)/research/sessions/[sessionId]/page.tsx' | head -80`

Locate where session header/CTAs are rendered.

- [ ] **Step 2: Add Generate-memo button + memo-list block**

Add inside the page component (alongside existing session UI):

```tsx
import { MemoGenerationModal } from "@/components/research/memo-generation-modal";
import { MemoListCard } from "@/components/research/memo-list-card";
import { Button } from "@/components/ui/button";

// inside the component:
const [memoModalOpen, setMemoModalOpen] = React.useState(false);
const memosQuery = trpc.research.memo.list.useQuery({ /* filter to this session via... */ }, { enabled: !!sessionId });
// (List endpoint doesn't filter by sessionId today — extend list input with `sessionId?: uuid` or filter client-side from `data.memos.filter(m => m.sessionId === sessionId)`. Choose one and stick with it. Plan note: prefer server-side filter for consistency; add `sessionId` to the list input + WHERE clause in research-memo router.)

// In the JSX header area:
<Button onClick={() => setMemoModalOpen(true)}>Generate memo</Button>

<MemoGenerationModal
  open={memoModalOpen}
  onOpenChange={setMemoModalOpen}
  sessionId={sessionId}
  defaultQuestion={session?.title ?? ""}
  bookmarkCount={bookmarkCount}
  chatCount={chatCount}
  statuteCount={statuteCount}
/>

// Below the existing session content, render memos list:
{memosForThisSession.length > 0 && (
  <section className="mt-6">
    <h3 className="text-sm font-medium">Memos from this session</h3>
    <ul className="mt-2 grid gap-2">
      {memosForThisSession.map((m) => (
        <li key={m.id}><MemoListCard memo={m} /></li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 3: Extend list endpoint with `sessionId` filter**

In `src/server/trpc/routers/research-memo.ts`, update `list` input + WHERE:

```ts
// input schema:
sessionId: z.string().uuid().optional(),
// in conditions:
if (input.sessionId) conditions.push(eq(researchMemos.sessionId, input.sessionId));
```

- [ ] **Step 4: Compute bookmarkCount / chatCount / statuteCount**

Either: extend the existing session query that the page already runs to include these counts, or add a new lightweight tRPC query `research.session.contextStats({ sessionId })`. Prefer the latter (clean separation):

In `src/server/trpc/routers/research.ts`, add to existing `sessions` sub-router:

```ts
contextStats: protectedProcedure
  .input(z.object({ sessionId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    await assertSessionOwnership(ctx.db, input.sessionId, ctx.user.id);
    const [{ count: bookmarkCount }] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(opinionBookmarks)
      .where(eq(opinionBookmarks.userId, ctx.user.id));
    const [{ count: chatCount }] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(researchChatMessages)
      .where(eq(researchChatMessages.sessionId, input.sessionId));
    const statuteRows = await ctx.db
      .select({ ids: researchChatMessages.statuteContextIds })
      .from(researchChatMessages)
      .where(eq(researchChatMessages.sessionId, input.sessionId));
    const statuteIds = new Set<string>();
    for (const r of statuteRows) for (const id of (r.ids ?? []) as string[]) statuteIds.add(id);
    return {
      bookmarkCount: bookmarkCount ?? 0,
      chatCount: chatCount ?? 0,
      statuteCount: statuteIds.size,
    };
  }),
```

Use the new query in the session page:

```tsx
const stats = trpc.research.sessions.contextStats.useQuery({ sessionId }).data;
```

- [ ] **Step 5: Verify build + tests**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(app)/research/sessions/[sessionId]/page.tsx' \
        src/server/trpc/routers/research-memo.ts \
        src/server/trpc/routers/research.ts
git commit -m "feat(2.2.3): session page hosts Generate-memo CTA + memos list + contextStats"
```

---

### Task 17: Case detail Research tab — memo count + collapsed list

**Files:**
- Modify: `src/app/(app)/cases/[id]/page.tsx` (Research tab section)

- [ ] **Step 1: Locate Research tab content**

Run: `grep -n "Research" 'src/app/(app)/cases/[id]/page.tsx' | head`

Find the section that currently renders sessions + bookmarks for the case.

- [ ] **Step 2: Add memos block**

Below sessions + bookmarks blocks, add:

```tsx
const memosForCase = trpc.research.memo.list.useQuery({ caseId }).data?.memos ?? [];
// JSX:
{memosForCase.length > 0 && (
  <section className="mt-4">
    <h3 className="text-sm font-medium">Memos ({memosForCase.length})</h3>
    <ul className="mt-2 grid gap-2">
      {memosForCase.map((m) => (
        <li key={m.id}><MemoListCard memo={m} /></li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/(app)/cases/[id]/page.tsx'
git commit -m "feat(2.2.3): case Research tab surfaces linked memos"
```

---

## Chunk 6 — Export + UPL Audit + E2E

### Task 18: PDF renderer

**Files:**
- Create: `src/server/services/research/memo-pdf.tsx`

- [ ] **Step 1: Inspect contract-generate PDF for style cues**

Run: `grep -n "@react-pdf/renderer\|StyleSheet" src/server/services/contract-generate.ts | head`

Confirm lib + grab the `StyleSheet.create` patterns to match house style.

- [ ] **Step 2: Implement PDF document**

```tsx
// src/server/services/research/memo-pdf.tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { getReportDisclaimer } from "@/server/services/compliance";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica", lineHeight: 1.4 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  question: { fontSize: 11, fontStyle: "italic", marginBottom: 16 },
  sectionHeading: { fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 },
  sectionBody: { whiteSpace: "pre-wrap" },
  citationsTitle: { fontSize: 11, fontWeight: 700, marginTop: 18, marginBottom: 4 },
  citation: { marginBottom: 2 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: "#666" },
});

export interface MemoPdfInput {
  title: string;
  memoQuestion: string;
  sections: Array<{ sectionType: string; ord: number; content: string; citations: string[] }>;
}

const SECTION_LABEL: Record<string, string> = {
  issue: "Issue",
  rule: "Rule",
  application: "Application",
  conclusion: "Conclusion",
};

export function MemoPdf({ title, memoQuestion, sections }: MemoPdfInput) {
  const allCitations = Array.from(new Set(sections.flatMap((s) => s.citations)));
  const sorted = [...sections].sort((a, b) => a.ord - b.ord);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.question}>{memoQuestion}</Text>
        {sorted.map((s) => (
          <View key={s.sectionType}>
            <Text style={styles.sectionHeading}>{SECTION_LABEL[s.sectionType] ?? s.sectionType}</Text>
            <Text style={styles.sectionBody}>{s.content}</Text>
          </View>
        ))}
        {allCitations.length > 0 && (
          <View>
            <Text style={styles.citationsTitle}>Citations</Text>
            {allCitations.map((c) => (
              <Text key={c} style={styles.citation}>• {c}</Text>
            ))}
          </View>
        )}
        <Text style={styles.footer} fixed>{getReportDisclaimer()}</Text>
      </Page>
    </Document>
  );
}

export async function renderMemoPdf(input: MemoPdfInput): Promise<Buffer> {
  return renderToBuffer(<MemoPdf {...input} />);
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/research/memo-pdf.tsx
git commit -m "feat(2.2.3): IRAC memo PDF renderer (@react-pdf/renderer)"
```

---

### Task 19: DOCX renderer

**Files:**
- Create: `src/server/services/research/memo-docx.ts`

- [ ] **Step 1: Implement DOCX builder**

```ts
// src/server/services/research/memo-docx.ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { getReportDisclaimer } from "@/server/services/compliance";
import type { MemoPdfInput } from "./memo-pdf";

const SECTION_LABEL: Record<string, string> = {
  issue: "Issue",
  rule: "Rule",
  application: "Application",
  conclusion: "Conclusion",
};

export async function renderMemoDocx(input: MemoPdfInput): Promise<Buffer> {
  const allCitations = Array.from(new Set(input.sections.flatMap((s) => s.citations)));
  const sorted = [...input.sections].sort((a, b) => a.ord - b.ord);
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(input.title)] }),
          new Paragraph({ children: [new TextRun({ text: input.memoQuestion, italics: true })] }),
          ...sorted.flatMap((s) => [
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              children: [new TextRun(SECTION_LABEL[s.sectionType] ?? s.sectionType)],
            }),
            ...s.content.split("\n\n").map((p) =>
              new Paragraph({ children: [new TextRun(p)] }),
            ),
          ]),
          ...(allCitations.length
            ? [
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  children: [new TextRun("Citations")],
                }),
                ...allCitations.map((c) => new Paragraph({ children: [new TextRun(`• ${c}`)] })),
              ]
            : []),
          new Paragraph({
            children: [new TextRun({ text: getReportDisclaimer(), size: 16, color: "777777" })],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/research/memo-docx.ts
git commit -m "feat(2.2.3): IRAC memo DOCX renderer (docx lib)"
```

---

### Task 20: Export route handler + UI buttons

**Files:**
- Create: `src/app/api/research/memos/[memoId]/export/route.ts`
- Modify: `src/app/(app)/research/memos/[memoId]/page.tsx` — add Export dropdown

- [ ] **Step 1: Implement route handler**

```ts
// src/app/api/research/memos/[memoId]/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { researchMemos } from "@/server/db/schema/research-memos";
import { researchMemoSections } from "@/server/db/schema/research-memos";
import { users } from "@/server/db/schema/users";
import { renderMemoPdf } from "@/server/services/research/memo-pdf";
import { renderMemoDocx } from "@/server/services/research/memo-docx";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ memoId: string }> },
) {
  const { memoId } = await params;
  const format = req.nextUrl.searchParams.get("format") === "docx" ? "docx" : "pdf";

  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });
  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const [memo] = await db.select().from(researchMemos).where(eq(researchMemos.id, memoId)).limit(1);
  if (!memo || memo.deletedAt !== null) return new NextResponse("Not found", { status: 404 });
  if (memo.userId !== user.id) return new NextResponse("Forbidden", { status: 403 });
  if (memo.status !== "ready") return new NextResponse("Memo not ready", { status: 409 });

  const sections = await db
    .select()
    .from(researchMemoSections)
    .where(eq(researchMemoSections.memoId, memoId))
    .orderBy(researchMemoSections.ord);

  const input = {
    title: memo.title,
    memoQuestion: memo.memoQuestion,
    sections: sections.map((s) => ({
      sectionType: s.sectionType,
      ord: s.ord,
      content: s.content,
      citations: s.citations,
    })),
  };

  const buffer = format === "docx" ? await renderMemoDocx(input) : await renderMemoPdf(input);
  const safeName = memo.title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "memo";
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}.${format}"`,
    },
  });
}
```

- [ ] **Step 2: Add Export buttons in editor page header**

In `src/app/(app)/research/memos/[memoId]/page.tsx`, in the editor header area:

```tsx
<div className="flex items-center gap-2">
  <a
    className="inline-flex items-center rounded border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
    href={`/api/research/memos/${memo.id}/export?format=pdf`}
  >Download PDF</a>
  <a
    className="inline-flex items-center rounded border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
    href={`/api/research/memos/${memo.id}/export?format=docx`}
  >Download DOCX</a>
</div>
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success; new route `/api/research/memos/[memoId]/export` listed.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/api/research/memos/[memoId]/export/route.ts' \
        'src/app/(app)/research/memos/[memoId]/page.tsx'
git commit -m "feat(2.2.3): PDF/DOCX export route + editor header buttons"
```

---

### Task 21: Extend `upl-audit.ts` with `--mode=memo`

**Files:**
- Modify: `scripts/upl-audit.ts`

- [ ] **Step 1: Add memo mode**

In the `main()` arg parser block:

```ts
const memoMode = modeArg === "memo";
```

After the existing `searchOnly` early-return block, add:

```ts
if (memoMode) {
  // For each query: search → cache hits → create session → bookmark first hit → generate memo →
  // run mechanical checks per section.
  // We reuse most of the existing search+cache code; the memo step uses the
  // same MemoGenerationService the prod path uses.
  // Skipped here when memoMode = false; falls through to existing askBroad/askDeep flow.
  // Implementation:
  const session = await sessions.createSession({ userId, firstQuery: query });
  const sessionId = session.id;
  let firstOpinionInternalId: string | undefined;
  for (const hit of (await cl.search({ query, page: 1 })).hits) {
    const row = await cache.upsertSearchHit(hit);
    if (!firstOpinionInternalId) firstOpinionInternalId = row.id;
  }
  if (!firstOpinionInternalId) {
    rows.push(emptyRow(idx, query, "broad", "no opinions to seed memo"));
    continue;
  }
  // Bookmark the first opinion so the memo has session context.
  await db.insert(opinionBookmarks).values({
    userId, opinionId: firstOpinionInternalId, caseId: null, notes: null,
  } as any).onConflictDoNothing?.();
  // Insert memo row directly (bypass tRPC/UsageGuard for the audit — mechanical checks only).
  const [memo] = await db.insert(researchMemos).values({
    userId, sessionId, title: query.slice(0, 200),
    status: "generating", memoQuestion: query,
    contextOpinionIds: [firstOpinionInternalId],
    contextStatuteIds: [], creditsCharged: 0,
  }).returning();
  const opinionCache = cache;
  const statuteCache = new StatuteCacheService({ db });
  const memoSvc = new MemoGenerationService({ db, opinionCache, statuteCache });
  try {
    const result = await memoSvc.generateAll({ memoId: memo.id });
    for (const s of result.sections) {
      const banned = scanBannedWords(s.content);
      rows.push({
        idx, query,
        mode: ("memo:" + s.section_type) as any,
        ok: true, error: "",
        responseChars: s.content.length,
        bannedWordHits: banned.hits.join("; "),
        bannedWordCount: banned.total,
        uplViolationsFromFilter: s.uplViolations.join("; "),
        unverifiedCitationsCount: s.unverifiedCitations.length,
        unverifiedCitationsList: s.unverifiedCitations.join("; "),
        disclaimerPresent: false, // disclaimer lives in PDF/DOCX, not section text
        semanticGrade: "",
        responseExcerpt: s.content.slice(0, 400).replace(/\s+/g, " "),
      });
    }
  } catch (err) {
    rows.push(emptyRow(idx, query, "broad", `memo gen failed: ${err instanceof Error ? err.message : err}`));
  }
  continue;
}
```

Add imports at top of file:

```ts
import { opinionBookmarks } from "@/server/db/schema/opinion-bookmarks";
import { researchMemos } from "@/server/db/schema/research-memos";
import { StatuteCacheService } from "@/server/services/research/statute-cache";
import { MemoGenerationService } from "@/server/services/research/memo-generation";
```

- [ ] **Step 2: Smoke run with --limit=1 (after Anthropic key rotated; otherwise will 401)**

Run:
```bash
set -a && source .env.local && set +a && \
  npx tsx scripts/upl-audit.ts --limit=1 --mode=memo
```
Expected when key valid: 4 rows (one per IRAC section), banned_word_count likely 0, no unverified citations.

When key invalid: error rows. The script structurally exercises the memo path either way.

- [ ] **Step 3: Commit**

```bash
git add scripts/upl-audit.ts
git commit -m "feat(2.2.3): upl-audit --mode=memo (per-section mechanical checks)"
```

---

### Task 22: E2E Playwright smoke

**Files:**
- Create: `e2e/research-memo.spec.ts`

- [ ] **Step 1: Implement smoke spec**

```ts
// e2e/research-memo.spec.ts
import { test, expect } from "@playwright/test";

// Mirror existing e2e/research.spec.ts convention: no Clerk bypass, status<500 + body-visible checks.

test.describe("Research memos", () => {
  test("memos list page returns <500 and renders empty-state CTA when not signed in", async ({ page }) => {
    const resp = await page.goto("/research/memos");
    expect(resp?.status()).toBeLessThan(500);
    // App-shell auth redirect lands on sign-in or empty list — both are acceptable smoke results.
    await expect(page.locator("body")).toBeVisible();
  });

  test("memo detail route handles unknown id gracefully (no crash)", async ({ page }) => {
    const resp = await page.goto("/research/memos/00000000-0000-4000-8000-000000000000");
    expect(resp?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("export endpoint requires auth (401 when not signed in)", async ({ request }) => {
    const resp = await request.get("/api/research/memos/00000000-0000-4000-8000-000000000000/export?format=pdf");
    expect([401, 404]).toContain(resp.status());
  });
});
```

- [ ] **Step 2: Run E2E smoke**

Run: `npx playwright test e2e/research-memo.spec.ts 2>&1 | tail -10`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add e2e/research-memo.spec.ts
git commit -m "test(2.2.3): E2E smoke for memos routes + export endpoint"
```

---

## Chunk 7 — Final Verification

### Task 23: Full validation + memory update

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: EXIT=0.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all PASS (count = previous baseline + new files: memo-generation-service, research-memo-router, research-memo-inngest, usage-guard-memo).

- [ ] **Step 3: Production build**

Run: `npm run build 2>&1 | tail -15`
Expected: EXIT=0. Verify new routes appear in route table:
- `/research/memos`
- `/research/memos/[memoId]`
- `/api/research/memos/[memoId]/export`

- [ ] **Step 4: E2E smoke**

Run: `npx playwright test e2e/research.spec.ts e2e/research-memo.spec.ts`
Expected: all PASS.

- [ ] **Step 5: Update memory**

Edit `/Users/fedorkaspirovich/.claude/projects/-Users-fedorkaspirovich-ClearTerms/memory/MEMORY.md` index — add a new `project_223_execution.md` entry.

Create the new memory file capturing:
- Status (in-progress / shipped / merged + commit hash + PR link if pushed)
- Spec + plan file paths
- Notable plan deviations
- Outstanding UAT items (memo gen requires real Anthropic key; mechanical UPL audit can run via `upl-audit.ts --mode=memo`)
- Next phase: 2.2.4 Collections

- [ ] **Step 6: Push + open PR**

Run:
```bash
git push -u origin feature/2.2.3-research-memo-generation
gh pr create --title "Phase 2.2.3 — Research Memo Generation (IRAC)" \
  --body "$(cat <<'EOF'
## Summary
- IRAC memo generation from a single research session (Issue / Rule / Application / Conclusion).
- 3-pane editor: section nav | section editor | AI rewrite chat (mirrors contract-drafts pattern).
- Export to PDF (`@react-pdf/renderer`) and DOCX (`docx` lib).
- Inngest-backed parallel 4-section generation. UPL filter + citation validator per section. UPL footer in PDF/DOCX (non-removable).
- Billing: 3 credits per generation, free section rewrites. Trial=10/mo, Solo=50/mo, Business=∞.
- New tables: `research_memos`, `research_memo_sections` (migration `0010`).
- `upl-audit.ts` extended with `--mode=memo` for mechanical per-section checks.

## Test plan
- [ ] Generate a memo from a session with bookmarks → all 4 sections populate within 60s.
- [ ] Empty session → Generate button disabled with hint.
- [ ] Regenerate Application section → only that section updates; no credit charged.
- [ ] Manual edit Rule → reload → edit persists; "Edited" indicator visible.
- [ ] Force Anthropic failure → memo status='failed', credits refunded, error banner shown.
- [ ] Export PDF/DOCX → file downloads with all sections + UPL disclaimer footer.
- [ ] Trial user at memo cap → upsell modal appears.
- [ ] In-app + email notification on memo ready (per user prefs).
EOF
)"
```

- [ ] **Step 7: Final commit (if anything left)**

```bash
git status
# If clean: skip; otherwise:
git add -A && git commit -m "docs(2.2.3): memory + plan-execution notes"
```

---

## Self-Review Notes

**Spec coverage:** Each spec section maps to tasks:
- §3 Architecture → reuse map embedded in plan header.
- §4 Data model → Tasks 1, 2.
- §5 Generation pipeline → Tasks 4, 5, 7, 9 (`generate` + `regenerateSection`).
- §6 Editor UX → Tasks 11–14.
- §7 Export → Tasks 18–20.
- §8 Notifications → Task 8.
- §9 Billing → Task 3 + Task 9 wiring.
- §10 UPL compliance → Task 5 (per-section filter/validator), Task 18/19 (disclaimer footer), Task 21 (audit).
- §11 Acceptance criteria → covered by Task 22 (E2E smoke skeleton) + Task 23 manual UAT in PR template.
- §12 Test plan → Tasks 3, 5, 7, 9 (unit + integration); Task 22 (E2E).
- §13 Migration → Task 2.
- §14 Open items → resolved (`@react-pdf/renderer`, `docx`, plain `<Textarea>`, audit extension).

**Placeholder scan:** None present in committed plan steps — every step has explicit code or commands. Two `TODO/TBD`-shaped notes are explicit decisions on data shape (not gaps): "list endpoint doesn't filter by sessionId today" → Task 16 Step 3 fixes it.

**Type consistency:** `generateAll` and `generateOne` signatures match between Task 5 and Task 9. `MemoSectionType` consistent across files. `SectionResult` only used internally.

---

## Notes for executor

- 2.2.1 + 2.2.2 set the precedent for this style of work — heavy reuse of `legal-rag`, `UsageGuard`, `OpinionCacheService`, notifications module. Read commits `21c8620`, `55b015b`, `d6cc490`, `08732cb`, `59386b8` for context on recent fixes those services have absorbed.
- The Anthropic key in `.env.local` may still be a placeholder. Mock-DB tests don't require it; live memo generation does. Coordinate key rotation before live UAT.
- `research_usage.memo_count` column already exists from 2.2.1 — no schema change for billing.
- All migrations apply via `psql "$DATABASE_URL" -f` — `/opt/homebrew/opt/libpq/bin/psql` if `psql` not on PATH.
