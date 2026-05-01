# 4.5 Discovery Response Drafter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Incoming" sub-tab to `/cases/[id]?tab=discovery` where lawyers paste or upload opposing counsel's interrogatories / RFPs / RFAs, parse them with Claude into structured questions, batch-generate structured responses with RAG, edit inline, retry weak rows with richer context, and export DOCX.

**Architecture:** New `discovery-response/` service (parse + respond + respond-rich + docx + orchestrator). New tRPC router with 7 endpoints. Two new tables (`incoming_discovery_requests`, `our_discovery_response_drafts`) added in migration 0058. New UI components mounted in existing `DiscoveryTab` via toggle. Reuses 4.2 Voyage RAG, 4.4 cite-check pricing pattern, Phase 3.1 `ResponseType` enum, existing `documents` upload pipeline.

**Tech Stack:** TypeScript / Next.js 16 / Drizzle / postgres / Anthropic SDK / Voyage AI / tRPC v11 / docx / vitest / Playwright.

**Active deviations from spec:** none.

---

## Phase A — Schema + migration

### Task A1: Create branch + Drizzle schemas

**Files:**
- Create: `src/server/db/schema/incoming-discovery-requests.ts`
- Create: `src/server/db/schema/our-discovery-response-drafts.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git pull --rebase origin main
git checkout -b feat/discovery-response-drafter
```

- [ ] **Step 2: `incoming_discovery_requests` schema**

Create `src/server/db/schema/incoming-discovery-requests.ts`:

```ts
import { pgTable, uuid, text, jsonb, integer, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";
import { documents } from "./documents";

export type ParsedQuestion = {
  number: number;
  text: string;
  subparts?: string[];
};

export const incomingDiscoveryRequests = pgTable(
  "incoming_discovery_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    requestType: text("request_type").notNull(),
    setNumber: integer("set_number").notNull(),
    servingParty: text("serving_party").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("parsed"),
    sourceText: text("source_text"),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "set null" }),
    questions: jsonb("questions").$type<ParsedQuestion[]>().notNull().default(sql`'[]'::jsonb`),
    servedAt: timestamp("served_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("incoming_discovery_requests_case_idx").on(t.caseId, t.requestType, t.setNumber),
    uniqueIndex("incoming_discovery_requests_set_unique").on(t.caseId, t.requestType, t.setNumber),
    check(
      "incoming_discovery_requests_request_type_check",
      sql`${t.requestType} IN ('interrogatories','rfp','rfa')`,
    ),
    check(
      "incoming_discovery_requests_status_check",
      sql`${t.status} IN ('parsed','responding','served')`,
    ),
    check(
      "incoming_discovery_requests_set_number_check",
      sql`${t.setNumber} BETWEEN 1 AND 99`,
    ),
  ],
);

export type IncomingDiscoveryRequest = typeof incomingDiscoveryRequests.$inferSelect;
export type NewIncomingDiscoveryRequest = typeof incomingDiscoveryRequests.$inferInsert;
```

- [ ] **Step 3: `our_discovery_response_drafts` schema**

Create `src/server/db/schema/our-discovery-response-drafts.ts`:

```ts
import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { incomingDiscoveryRequests } from "./incoming-discovery-requests";

export type OurResponseType =
  | "admit"
  | "deny"
  | "object"
  | "lack_of_knowledge"
  | "written_response"
  | "produced_documents";

export const ourDiscoveryResponseDrafts = pgTable(
  "our_discovery_response_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").references(() => incomingDiscoveryRequests.id, { onDelete: "cascade" }).notNull(),
    questionIndex: integer("question_index").notNull(),
    responseType: text("response_type").$type<OurResponseType>().notNull(),
    responseText: text("response_text"),
    objectionBasis: text("objection_basis"),
    aiGenerated: boolean("ai_generated").notNull().default(true),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("our_discovery_response_drafts_request_idx").on(t.requestId, t.questionIndex),
    uniqueIndex("our_discovery_response_drafts_unique").on(t.requestId, t.questionIndex),
    check(
      "our_discovery_response_drafts_response_type_check",
      sql`${t.responseType} IN ('admit','deny','object','lack_of_knowledge','written_response','produced_documents')`,
    ),
    check(
      "our_discovery_response_drafts_question_index_check",
      sql`${t.questionIndex} >= 0`,
    ),
  ],
);

export type OurDiscoveryResponseDraft = typeof ourDiscoveryResponseDrafts.$inferSelect;
export type NewOurDiscoveryResponseDraft = typeof ourDiscoveryResponseDrafts.$inferInsert;
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/incoming-discovery-requests.ts \
        src/server/db/schema/our-discovery-response-drafts.ts
git commit -m "feat(discovery-response): Drizzle schemas for incoming requests + our drafts"
```

---

### Task A2: Migration 0058 + apply

**Files:**
- Create: `src/server/db/migrations/0058_discovery_response_drafter.sql`

- [ ] **Step 1: Write migration**

Create `src/server/db/migrations/0058_discovery_response_drafter.sql`:

```sql
CREATE TABLE incoming_discovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('interrogatories','rfp','rfa')),
  set_number integer NOT NULL CHECK (set_number BETWEEN 1 AND 99),
  serving_party text NOT NULL,
  received_at timestamptz DEFAULT now() NOT NULL,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'parsed' CHECK (status IN ('parsed','responding','served')),
  source_text text,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  questions jsonb NOT NULL DEFAULT '[]',
  served_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX incoming_discovery_requests_case_idx ON incoming_discovery_requests (case_id, request_type, set_number);
CREATE UNIQUE INDEX incoming_discovery_requests_set_unique ON incoming_discovery_requests (case_id, request_type, set_number);

CREATE TABLE our_discovery_response_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES incoming_discovery_requests(id) ON DELETE CASCADE,
  question_index integer NOT NULL CHECK (question_index >= 0),
  response_type text NOT NULL CHECK (response_type IN ('admit','deny','object','lack_of_knowledge','written_response','produced_documents')),
  response_text text,
  objection_basis text,
  ai_generated boolean NOT NULL DEFAULT true,
  generated_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX our_discovery_response_drafts_request_idx ON our_discovery_response_drafts (request_id, question_index);
CREATE UNIQUE INDEX our_discovery_response_drafts_unique ON our_discovery_response_drafts (request_id, question_index);
```

- [ ] **Step 2: Apply via batch script**

Run: `pnpm tsx -r dotenv/config scripts/apply-migrations-batch.ts 0058 0058`
Expected: ends with `All 1 migrations applied.`

- [ ] **Step 3: Commit**

```bash
git add src/server/db/migrations/0058_discovery_response_drafter.sql
git commit -m "feat(discovery-response): migration 0058 — incoming + drafts tables"
```

---

## Phase B — Backend services (TDD)

### Task B1: Shared types

**Files:**
- Create: `src/server/services/discovery-response/types.ts`

- [ ] **Step 1: Write types**

Create `src/server/services/discovery-response/types.ts`:

```ts
import type { OurResponseType } from "@/server/db/schema/our-discovery-response-drafts";
import type { ParsedQuestion } from "@/server/db/schema/incoming-discovery-requests";

export type { OurResponseType, ParsedQuestion };

export interface ResponseDraft {
  responseType: OurResponseType;
  responseText: string | null;
  objectionBasis: string | null;
  aiGenerated: boolean;
}

export interface BatchResult {
  successCount: number;
  failedCount: number;
  creditsCharged: number;
}

export interface CaseCaption {
  plaintiff: string;
  defendant: string;
  caseNumber: string;
  court: string;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"
git add src/server/services/discovery-response/types.ts
git commit -m "feat(discovery-response): shared types"
```

Expected: no errors.

---

### Task B2: `parse.ts` — Claude question extractor (TDD)

**Files:**
- Create: `src/server/services/discovery-response/parse.ts`
- Test: `tests/unit/discovery-response-parse.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/discovery-response-parse.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { parseQuestions } from "@/server/services/discovery-response/parse";

beforeEach(() => messagesCreateMock.mockReset());

describe("parseQuestions", () => {
  it("returns parsed questions on happy path", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        questions: [
          { number: 1, text: "State your full name." },
          { number: 2, text: "Identify all witnesses to the incident.", subparts: ["a", "b"] },
        ],
      }) }],
    });
    const out = await parseQuestions("INTERROGATORY NO. 1: State your full name. ...");
    expect(out).toHaveLength(2);
    expect(out[0].number).toBe(1);
    expect(out[1].subparts).toEqual(["a", "b"]);
  });

  it("empty text → empty array, no Claude call", async () => {
    const out = await parseQuestions("");
    expect(out).toEqual([]);
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });

  it("malformed JSON → throws", async () => {
    messagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "not json" }] });
    await expect(parseQuestions("blah")).rejects.toThrow(/parse/i);
  });

  it("strips ```json fences before parsing", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "```json\n{\"questions\":[{\"number\":1,\"text\":\"x\"}]}\n```" }],
    });
    const out = await parseQuestions("blah");
    expect(out).toHaveLength(1);
  });

  it("filters questions with missing required fields", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        questions: [
          { number: 1, text: "OK" },
          { text: "no number" },
          { number: 2 },
        ],
      }) }],
    });
    const out = await parseQuestions("blah");
    expect(out).toHaveLength(1);
    expect(out[0].number).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/discovery-response-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parse.ts`**

Create `src/server/services/discovery-response/parse.ts`:

```ts
import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { ParsedQuestion } from "./types";

const SYSTEM = `You are a discovery-document parser. Given the text of opposing counsel's interrogatories, requests for production, or requests for admission, extract every numbered question into strict JSON: {"questions": [{"number": <int>, "text": "<exact question text>", "subparts": ["<a>", "<b>"]?}]}. Skip preambles, definitions, instructions, and signature blocks. Preserve the question's original wording. If a question has lettered subparts (a, b, c), include them as a string array. If no questions are present, return {"questions": []}. Never invent questions.`;

export async function parseQuestions(text: string): Promise<ParsedQuestion[]> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];

  const env = getEnv();
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: trimmed.slice(0, 80000) }],
  });

  const block = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const raw = (block?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: { questions?: Array<{ number?: unknown; text?: unknown; subparts?: unknown }> };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse discovery questions JSON: ${e instanceof Error ? e.message : e}`);
  }

  const out: ParsedQuestion[] = [];
  for (const q of parsed.questions ?? []) {
    if (typeof q.number !== "number") continue;
    if (typeof q.text !== "string" || !q.text.trim()) continue;
    const subparts = Array.isArray(q.subparts) && q.subparts.every((s) => typeof s === "string") ? (q.subparts as string[]) : undefined;
    out.push({ number: q.number, text: q.text, subparts });
  }
  return out;
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `npx vitest run tests/unit/discovery-response-parse.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/discovery-response/parse.ts tests/unit/discovery-response-parse.test.ts
git commit -m "feat(discovery-response): Claude question extractor"
```

---

### Task B3: `respond.ts` + `respond-rich.ts` — Claude response generator (TDD)

**Files:**
- Create: `src/server/services/discovery-response/respond.ts`
- Create: `src/server/services/discovery-response/respond-rich.ts`
- Test: `tests/unit/discovery-response-respond.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/discovery-response-respond.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { respondToQuestion } from "@/server/services/discovery-response/respond";

beforeEach(() => messagesCreateMock.mockReset());

describe("respondToQuestion", () => {
  it("returns structured response on happy path", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        responseType: "object",
        responseText: "Vague and ambiguous.",
        objectionBasis: "Vague and ambiguous; calls for legal conclusion.",
      }) }],
    });
    const out = await respondToQuestion(
      { number: 1, text: "Define justice." },
      [],
      { plaintiff: "Smith", defendant: "Acme", caseNumber: "24-1", court: "S.D.N.Y." },
    );
    expect(out?.responseType).toBe("object");
    expect(out?.objectionBasis).toContain("ambiguous");
  });

  it("clamps invalid responseType to written_response", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ responseType: "wat", responseText: "x" }) }],
    });
    const out = await respondToQuestion(
      { number: 1, text: "x" },
      [],
      { plaintiff: "p", defendant: "d", caseNumber: "1", court: "c" },
    );
    expect(out?.responseType).toBe("written_response");
  });

  it("Anthropic error → returns null", async () => {
    messagesCreateMock.mockRejectedValue(new Error("rate limited"));
    const out = await respondToQuestion(
      { number: 1, text: "x" },
      [],
      { plaintiff: "p", defendant: "d", caseNumber: "1", court: "c" },
    );
    expect(out).toBeNull();
  });

  it("malformed JSON → returns null", async () => {
    messagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "garbage" }] });
    const out = await respondToQuestion(
      { number: 1, text: "x" },
      [],
      { plaintiff: "p", defendant: "d", caseNumber: "1", court: "c" },
    );
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/discovery-response-respond.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `respond.ts`**

Create `src/server/services/discovery-response/respond.ts`:

```ts
import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { DocChunk } from "@/server/services/case-strategy/types";
import type { OurResponseType, ParsedQuestion, ResponseDraft, CaseCaption } from "./types";

const VALID_TYPES: Set<OurResponseType> = new Set([
  "admit", "deny", "object", "lack_of_knowledge", "written_response", "produced_documents",
]);

const SYSTEM = `You are a defense attorney drafting a response to opposing counsel's discovery request. Given a single question, supporting case excerpts, and the case caption, produce a strict JSON response: {"responseType": "admit"|"deny"|"object"|"lack_of_knowledge"|"written_response"|"produced_documents", "responseText": "<exact response text in formal legal style>", "objectionBasis": "<short objection rationale or null>"}.

Guidance:
- Use "object" only when there is a real legal basis (vague, overbroad, privileged, irrelevant, calls for legal conclusion). State the basis in objectionBasis.
- Prefer "lack_of_knowledge" when reasonable inquiry has not yet revealed the answer.
- "produced_documents" means responsive documents are being produced; describe them briefly.
- "written_response" is the catch-all for narrative answers.
- Be conservative — never admit unless the case excerpts clearly support it.`;

function buildUserContent(question: ParsedQuestion, chunks: DocChunk[], caption: CaseCaption): string {
  return [
    `# Case caption`,
    `${caption.plaintiff} v. ${caption.defendant} — ${caption.caseNumber} (${caption.court})`,
    ``,
    `# Question (${question.number})`,
    question.text,
    question.subparts?.length ? `Subparts: ${question.subparts.join(", ")}` : "",
    ``,
    chunks.length > 0
      ? [`# Relevant case excerpts`, ...chunks.slice(0, 5).map((c) => `[${c.documentTitle}#${c.chunkIndex}] ${c.content.slice(0, 1500)}`)].join("\n\n")
      : "",
  ].filter(Boolean).join("\n");
}

export async function respondToQuestion(
  question: ParsedQuestion,
  chunks: DocChunk[],
  caption: CaseCaption,
): Promise<ResponseDraft | null> {
  const env = getEnv();
  const anthropic = getAnthropic();

  let response;
  try {
    response = await anthropic.messages.create({
      model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 800,
      system: SYSTEM,
      messages: [{ role: "user", content: buildUserContent(question, chunks, caption) }],
    });
  } catch {
    return null;
  }

  const block = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (block?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: { responseType?: string; responseText?: string; objectionBasis?: string | null };
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const responseType = (VALID_TYPES.has(parsed.responseType as OurResponseType)
    ? (parsed.responseType as OurResponseType)
    : "written_response");

  return {
    responseType,
    responseText: parsed.responseText ?? null,
    objectionBasis: parsed.objectionBasis ?? null,
    aiGenerated: true,
  };
}
```

- [ ] **Step 4: Implement `respond-rich.ts`**

Create `src/server/services/discovery-response/respond-rich.ts`:

```ts
import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { CaseDigest, DocChunk } from "@/server/services/case-strategy/types";
import type { OurResponseType, ParsedQuestion, ResponseDraft } from "./types";

const VALID_TYPES: Set<OurResponseType> = new Set([
  "admit", "deny", "object", "lack_of_knowledge", "written_response", "produced_documents",
]);

const SYSTEM = `You are a defense attorney drafting a response to opposing counsel's discovery request. You have full case context plus prior responses you've already drafted in this same set. Maintain consistency with prior responses. Output strict JSON: {"responseType": ..., "responseText": ..., "objectionBasis": ... | null}. Same response-type vocabulary and guidance as a standard response. Be conservative.`;

export interface PriorDraft {
  questionIndex: number;
  responseType: OurResponseType;
  responseText: string | null;
}

export async function respondToQuestionRich(
  question: ParsedQuestion,
  digest: CaseDigest,
  chunks: DocChunk[],
  priorDrafts: PriorDraft[],
): Promise<ResponseDraft | null> {
  const env = getEnv();
  const anthropic = getAnthropic();

  const userContent = [
    `# Case digest`,
    JSON.stringify(digest.caption),
    `Recent activity: ${digest.recentActivity}`,
    ``,
    `# Question (${question.number})`,
    question.text,
    question.subparts?.length ? `Subparts: ${question.subparts.join(", ")}` : "",
    ``,
    `# Relevant case excerpts`,
    chunks.slice(0, 8).map((c) => `[${c.documentTitle}#${c.chunkIndex}] ${c.content.slice(0, 1500)}`).join("\n\n") || "(none)",
    ``,
    priorDrafts.length > 0
      ? [`# Prior responses you've drafted in this set`, ...priorDrafts.map((d) => `Q${d.questionIndex + 1}: [${d.responseType}] ${d.responseText ?? ""}`.slice(0, 300))].join("\n")
      : "",
  ].filter(Boolean).join("\n");

  let response;
  try {
    response = await anthropic.messages.create({
      model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 800,
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });
  } catch {
    return null;
  }

  const block = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (block?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
  let parsed: { responseType?: string; responseText?: string; objectionBasis?: string | null };
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const responseType = (VALID_TYPES.has(parsed.responseType as OurResponseType)
    ? (parsed.responseType as OurResponseType)
    : "written_response");

  return {
    responseType,
    responseText: parsed.responseText ?? null,
    objectionBasis: parsed.objectionBasis ?? null,
    aiGenerated: true,
  };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/discovery-response-respond.test.ts`
Expected: 4 passed.
Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/discovery-response/respond.ts \
        src/server/services/discovery-response/respond-rich.ts \
        tests/unit/discovery-response-respond.test.ts
git commit -m "feat(discovery-response): Claude response generators (per-q + rich)"
```

---

### Task B4: `docx.ts` — DOCX builder (TDD)

**Files:**
- Create: `src/server/services/discovery-response/docx.ts`
- Test: `tests/unit/discovery-response-docx.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/discovery-response-docx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDiscoveryResponseDocx } from "@/server/services/discovery-response/docx";

describe("buildDiscoveryResponseDocx", () => {
  it("produces a non-empty Buffer with header + Q&A pairs", async () => {
    const buf = await buildDiscoveryResponseDocx(
      {
        requestType: "rfa",
        setNumber: 1,
        servingParty: "Plaintiff Smith",
        questions: [
          { number: 1, text: "Admit the contract was signed." },
          { number: 2, text: "Admit damages exceed $10,000." },
        ],
      },
      [
        { questionIndex: 0, responseType: "admit", responseText: "Admitted.", objectionBasis: null },
        { questionIndex: 1, responseType: "deny", responseText: "Denied.", objectionBasis: null },
      ],
      { plaintiff: "Smith", defendant: "Acme", caseNumber: "24-1", court: "S.D.N.Y." },
    );
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("inserts placeholder for missing drafts", async () => {
    const buf = await buildDiscoveryResponseDocx(
      {
        requestType: "interrogatories",
        setNumber: 1,
        servingParty: "X",
        questions: [
          { number: 1, text: "Q1" },
          { number: 2, text: "Q2" },
        ],
      },
      [{ questionIndex: 0, responseType: "admit", responseText: "Admitted.", objectionBasis: null }],
      { plaintiff: "p", defendant: "d", caseNumber: "1", court: "c" },
    );
    expect(buf.length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/discovery-response-docx.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `docx.ts`**

Create `src/server/services/discovery-response/docx.ts`:

```ts
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel,
} from "docx";
import type { OurResponseType, ParsedQuestion, CaseCaption } from "./types";

interface DocxRequest {
  requestType: "interrogatories" | "rfp" | "rfa";
  setNumber: number;
  servingParty: string;
  questions: ParsedQuestion[];
}

interface DocxDraft {
  questionIndex: number;
  responseType: OurResponseType;
  responseText: string | null;
  objectionBasis: string | null;
}

const TITLE: Record<DocxRequest["requestType"], string> = {
  interrogatories: "RESPONSES TO INTERROGATORIES",
  rfp: "RESPONSES TO REQUESTS FOR PRODUCTION",
  rfa: "RESPONSES TO REQUESTS FOR ADMISSION",
};

const TYPE_LABEL: Record<OurResponseType, string> = {
  admit: "ADMITTED",
  deny: "DENIED",
  object: "OBJECTION",
  lack_of_knowledge: "LACK OF KNOWLEDGE",
  written_response: "RESPONSE",
  produced_documents: "DOCUMENTS PRODUCED",
};

export async function buildDiscoveryResponseDocx(
  request: DocxRequest,
  drafts: DocxDraft[],
  caption: CaseCaption,
): Promise<Buffer> {
  const draftMap = new Map(drafts.map((d) => [d.questionIndex, d]));
  const headerParas = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: caption.court.toUpperCase(), bold: true })] }),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ children: [new TextRun(`${caption.plaintiff} v. ${caption.defendant}`)] }),
    new Paragraph({ children: [new TextRun(`Case No. ${caption.caseNumber}`)] }),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${TITLE[request.requestType]} (Set ${request.setNumber})`, bold: true })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(`Propounded by: ${request.servingParty}`)] }),
    new Paragraph({ children: [new TextRun("")] }),
  ];

  const body: Paragraph[] = [];
  request.questions.forEach((q, i) => {
    body.push(
      new Paragraph({ children: [new TextRun({ text: `${q.number}. ${q.text}`, bold: true })] }),
    );
    if (q.subparts?.length) {
      body.push(
        new Paragraph({ children: [new TextRun(`  Subparts: ${q.subparts.join(", ")}`)] }),
      );
    }
    const draft = draftMap.get(i);
    if (!draft) {
      body.push(new Paragraph({ children: [new TextRun({ text: "RESPONSE: (no response drafted)", italics: true })] }));
    } else {
      body.push(
        new Paragraph({ children: [new TextRun({ text: `RESPONSE — ${TYPE_LABEL[draft.responseType]}`, bold: true })] }),
      );
      if (draft.objectionBasis) {
        body.push(new Paragraph({ children: [new TextRun(`  Basis: ${draft.objectionBasis}`)] }));
      }
      if (draft.responseText) {
        body.push(new Paragraph({ children: [new TextRun(draft.responseText)] }));
      }
    }
    body.push(new Paragraph({ children: [new TextRun("")] }));
  });

  const doc = new Document({
    sections: [{ properties: {}, children: [...headerParas, ...body] }],
  });
  return await Packer.toBuffer(doc);
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/unit/discovery-response-docx.test.ts`
Expected: 2 passed.
Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/discovery-response/docx.ts \
        tests/unit/discovery-response-docx.test.ts
git commit -m "feat(discovery-response): DOCX builder for Q&A export"
```

---

### Task B5: `orchestrator.ts` — full flow (TDD)

**Files:**
- Create: `src/server/services/discovery-response/orchestrator.ts`
- Test: `tests/unit/discovery-response-orchestrator.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/discovery-response-orchestrator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  parseMock: vi.fn(),
  respondMock: vi.fn(),
  decrementMock: vi.fn(),
  refundMock: vi.fn(),
  reqSelectMock: vi.fn(),
  draftSelectMock: vi.fn(),
  draftBulkInsertMock: vi.fn(),
  reqUpdateMock: vi.fn(),
}));

vi.mock("@/server/services/discovery-response/parse", () => ({ parseQuestions: mocks.parseMock }));
vi.mock("@/server/services/discovery-response/respond", () => ({ respondToQuestion: mocks.respondMock }));
vi.mock("@/server/services/discovery-response/respond-rich", () => ({ respondToQuestionRich: vi.fn() }));
vi.mock("@/server/services/case-strategy/voyage", () => ({ embedTexts: async () => [[0.1]] }));
vi.mock("@/server/services/credits", () => ({
  decrementCredits: mocks.decrementMock,
  refundCredits: mocks.refundMock,
}));

vi.mock("@/server/db/schema/incoming-discovery-requests", () => ({
  incomingDiscoveryRequests: { _table: "req", id: { _col: "id" } },
}));
vi.mock("@/server/db/schema/our-discovery-response-drafts", () => ({
  ourDiscoveryResponseDrafts: { _table: "drafts", requestId: { _col: "req_id" } },
}));

vi.mock("@/server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((tbl: { _table?: string }) => {
        const which = tbl?._table;
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve(which === "drafts" ? mocks.draftSelectMock() : mocks.reqSelectMock()),
            ),
            orderBy: vi.fn(() => Promise.resolve(which === "drafts" ? mocks.draftSelectMock() : mocks.reqSelectMock())),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => mocks.draftBulkInsertMock()) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => mocks.reqUpdateMock()) })) })),
    execute: vi.fn(() => Promise.resolve([])),
  },
}));

beforeEach(() => Object.values(mocks).forEach((m) => m.mockReset()));

describe("draftBatch", () => {
  it("happy path: batch generates N responses, charges per success", async () => {
    mocks.reqSelectMock.mockResolvedValue([
      { id: "r1", caseId: "c1", questions: [
        { number: 1, text: "Q1" },
        { number: 2, text: "Q2" },
      ], status: "parsed" },
    ]);
    mocks.draftSelectMock.mockResolvedValue([]);
    mocks.respondMock.mockResolvedValue({ responseType: "admit", responseText: "Admitted.", objectionBasis: null, aiGenerated: true });
    mocks.decrementMock.mockResolvedValue(true);
    mocks.draftBulkInsertMock.mockResolvedValue([]);
    mocks.reqUpdateMock.mockResolvedValue([]);

    const { draftBatch } = await import("@/server/services/discovery-response/orchestrator");
    const out = await draftBatch({ requestId: "r1", userId: "u1" });
    expect(out.successCount).toBe(2);
    expect(out.failedCount).toBe(0);
    expect(out.creditsCharged).toBe(2);
  });

  it("conflict: drafts already exist → throws ConflictError", async () => {
    mocks.reqSelectMock.mockResolvedValue([
      { id: "r1", caseId: "c1", questions: [{ number: 1, text: "Q1" }], status: "responding" },
    ]);
    mocks.draftSelectMock.mockResolvedValue([{ id: "d1" }]);

    const { draftBatch, DraftsExistError } = await import("@/server/services/discovery-response/orchestrator");
    await expect(draftBatch({ requestId: "r1", userId: "u1" })).rejects.toBeInstanceOf(DraftsExistError);
  });

  it("budget exhausts mid-flight: stops, marks remaining failed", async () => {
    mocks.reqSelectMock.mockResolvedValue([
      { id: "r1", caseId: "c1", questions: [
        { number: 1, text: "Q1" }, { number: 2, text: "Q2" }, { number: 3, text: "Q3" },
      ], status: "parsed" },
    ]);
    mocks.draftSelectMock.mockResolvedValue([]);
    mocks.respondMock.mockResolvedValue({ responseType: "admit", responseText: "x", objectionBasis: null, aiGenerated: true });
    mocks.decrementMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    mocks.draftBulkInsertMock.mockResolvedValue([]);
    mocks.reqUpdateMock.mockResolvedValue([]);

    const { draftBatch } = await import("@/server/services/discovery-response/orchestrator");
    const out = await draftBatch({ requestId: "r1", userId: "u1" });
    expect(out.creditsCharged).toBe(1);
    expect(out.failedCount).toBe(2);
  });

  it("Anthropic error per-call: marks failed, no charge", async () => {
    mocks.reqSelectMock.mockResolvedValue([
      { id: "r1", caseId: "c1", questions: [{ number: 1, text: "Q1" }], status: "parsed" },
    ]);
    mocks.draftSelectMock.mockResolvedValue([]);
    mocks.respondMock.mockResolvedValue(null);
    mocks.draftBulkInsertMock.mockResolvedValue([]);
    mocks.reqUpdateMock.mockResolvedValue([]);

    const { draftBatch } = await import("@/server/services/discovery-response/orchestrator");
    const out = await draftBatch({ requestId: "r1", userId: "u1" });
    expect(out.successCount).toBe(0);
    expect(out.failedCount).toBe(1);
    expect(out.creditsCharged).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/discovery-response-orchestrator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `orchestrator.ts`**

Create `src/server/services/discovery-response/orchestrator.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { incomingDiscoveryRequests } from "@/server/db/schema/incoming-discovery-requests";
import { ourDiscoveryResponseDrafts } from "@/server/db/schema/our-discovery-response-drafts";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { embedTexts } from "@/server/services/case-strategy/voyage";
import { respondToQuestion } from "./respond";
import { respondToQuestionRich, type PriorDraft } from "./respond-rich";
import type { BatchResult, ParsedQuestion, ResponseDraft, CaseCaption } from "./types";

export class DraftsExistError extends Error {
  constructor() {
    super("Drafts already exist for this request");
    this.name = "DraftsExistError";
  }
}
export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}
export class RequestServedError extends Error {
  constructor() {
    super("Request is served and locked from edits");
    this.name = "RequestServedError";
  }
}

const CONCURRENCY = 5;
const TOP_K_BATCH = 5;
const TOP_K_RICH = 8;
const QUESTION_HARD_LIMIT = 100;

interface BatchArgs { requestId: string; userId: string; }
interface SingleArgs { requestId: string; questionIndex: number; userId: string; }

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadCaption(caseId: string): Promise<CaseCaption> {
  const { cases } = await import("@/server/db/schema/cases");
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  return {
    plaintiff: c?.plaintiffName ?? "Plaintiff",
    defendant: c?.defendantName ?? "Defendant",
    caseNumber: c?.caseNumber ?? "",
    court: c?.court ?? "U.S. District Court",
  };
}

async function ragForQuestion(caseId: string, questionText: string, k: number) {
  const [vec] = await embedTexts([questionText], "query");
  if (!vec || vec.length === 0) return [];
  const queryLit = `[${vec.join(",")}]`;
  const rows = await db.execute<{
    document_id: string; document_title: string; chunk_index: number; content: string; similarity: number;
  }>(sql`
    WITH q AS (SELECT ${queryLit}::vector AS v)
    SELECT
      de.document_id,
      COALESCE(d.filename, 'Untitled') AS document_title,
      de.chunk_index,
      de.content,
      1 - (de.embedding <=> q.v) AS similarity
    FROM document_embeddings de
    JOIN documents d ON d.id = de.document_id
    CROSS JOIN q
    WHERE d.case_id = ${caseId}
    ORDER BY de.embedding <=> q.v
    LIMIT ${k}
  `);
  return rows.map((r) => ({
    documentId: r.document_id,
    documentTitle: r.document_title,
    chunkIndex: r.chunk_index,
    content: r.content,
    similarity: Number(r.similarity),
  }));
}

export async function draftBatch(args: BatchArgs): Promise<BatchResult> {
  const [request] = await db
    .select()
    .from(incomingDiscoveryRequests)
    .where(eq(incomingDiscoveryRequests.id, args.requestId))
    .limit(1);
  if (!request) throw new Error(`Request ${args.requestId} not found`);

  const existing = await db
    .select({ id: ourDiscoveryResponseDrafts.id })
    .from(ourDiscoveryResponseDrafts)
    .where(eq(ourDiscoveryResponseDrafts.requestId, args.requestId))
    .limit(1);
  if (existing.length > 0) throw new DraftsExistError();

  const questions = request.questions as ParsedQuestion[];
  if (questions.length === 0) {
    return { successCount: 0, failedCount: 0, creditsCharged: 0 };
  }

  const caption = await loadCaption(request.caseId);

  const inserts: Array<{
    requestId: string; questionIndex: number; responseType: ResponseDraft["responseType"];
    responseText: string | null; objectionBasis: string | null; aiGenerated: boolean;
  }> = [];
  let creditsCharged = 0;
  let successCount = 0;
  let failedCount = 0;
  let budgetExhausted = false;

  await runWithConcurrency(questions, CONCURRENCY, async (q) => {
    const i = questions.indexOf(q);
    if (budgetExhausted) {
      inserts.push({
        requestId: args.requestId, questionIndex: i,
        responseType: "written_response",
        responseText: "(credit budget exhausted — re-run after topping up)",
        objectionBasis: null, aiGenerated: false,
      });
      failedCount++;
      return;
    }

    const chunks = await ragForQuestion(request.caseId, q.text, TOP_K_BATCH);
    const draft = await respondToQuestion(q, chunks, caption);
    if (!draft) {
      inserts.push({
        requestId: args.requestId, questionIndex: i,
        responseType: "written_response",
        responseText: "(generation failed — re-run)",
        objectionBasis: null, aiGenerated: false,
      });
      failedCount++;
      return;
    }

    const charged = await decrementCredits(args.userId, 1);
    if (!charged) {
      budgetExhausted = true;
      inserts.push({
        requestId: args.requestId, questionIndex: i,
        responseType: "written_response",
        responseText: "(credit budget exhausted — re-run after topping up)",
        objectionBasis: null, aiGenerated: false,
      });
      failedCount++;
      return;
    }

    creditsCharged++;
    successCount++;
    inserts.push({
      requestId: args.requestId, questionIndex: i,
      responseType: draft.responseType,
      responseText: draft.responseText,
      objectionBasis: draft.objectionBasis,
      aiGenerated: true,
    });
  });

  if (inserts.length > 0) {
    await db.insert(ourDiscoveryResponseDrafts).values(inserts);
  }
  await db
    .update(incomingDiscoveryRequests)
    .set({ status: "responding", updatedAt: new Date() })
    .where(eq(incomingDiscoveryRequests.id, args.requestId));

  return { successCount, failedCount, creditsCharged };
}

export async function draftSingle(args: SingleArgs): Promise<ResponseDraft> {
  const [request] = await db
    .select()
    .from(incomingDiscoveryRequests)
    .where(eq(incomingDiscoveryRequests.id, args.requestId))
    .limit(1);
  if (!request) throw new Error(`Request ${args.requestId} not found`);
  if (request.status === "served") throw new RequestServedError();

  const questions = request.questions as ParsedQuestion[];
  const q = questions[args.questionIndex];
  if (!q) throw new Error(`Question index ${args.questionIndex} out of range`);

  const charged = await decrementCredits(args.userId, 1);
  if (!charged) throw new InsufficientCreditsError();

  try {
    const { buildCaseDigest } = await import("@/server/services/case-strategy/aggregate");
    const digest = await buildCaseDigest(request.caseId);

    const chunks = await ragForQuestion(request.caseId, q.text, TOP_K_RICH);
    const priorDraftRows = await db
      .select()
      .from(ourDiscoveryResponseDrafts)
      .where(eq(ourDiscoveryResponseDrafts.requestId, args.requestId))
      .orderBy(ourDiscoveryResponseDrafts.questionIndex);
    const priorDrafts: PriorDraft[] = priorDraftRows
      .filter((d) => d.questionIndex !== args.questionIndex)
      .map((d) => ({ questionIndex: d.questionIndex, responseType: d.responseType, responseText: d.responseText }));

    const draft = await respondToQuestionRich(q, digest, chunks, priorDrafts);
    if (!draft) {
      await refundCredits(args.userId, 1);
      throw new Error("Generation failed");
    }

    await db
      .insert(ourDiscoveryResponseDrafts)
      .values({
        requestId: args.requestId,
        questionIndex: args.questionIndex,
        responseType: draft.responseType,
        responseText: draft.responseText,
        objectionBasis: draft.objectionBasis,
        aiGenerated: true,
      })
      .onConflictDoUpdate({
        target: [ourDiscoveryResponseDrafts.requestId, ourDiscoveryResponseDrafts.questionIndex],
        set: {
          responseType: draft.responseType,
          responseText: draft.responseText,
          objectionBasis: draft.objectionBasis,
          aiGenerated: true,
          updatedAt: new Date(),
        },
      });
    return draft;
  } catch (e) {
    await refundCredits(args.userId, 1);
    throw e;
  }
}

export async function parseAndSave(args: {
  caseId: string;
  orgId: string;
  userId: string;
  meta: { requestType: "interrogatories" | "rfp" | "rfa"; setNumber: number; servingParty: string; dueAt: Date | null };
  source: { mode: "paste"; text: string } | { mode: "document"; documentId: string };
}): Promise<typeof incomingDiscoveryRequests.$inferSelect> {
  const charged = await decrementCredits(args.userId, 1);
  if (!charged) throw new InsufficientCreditsError();

  let sourceText = "";
  let sourceDocumentId: string | null = null;
  try {
    if (args.source.mode === "paste") {
      sourceText = args.source.text;
    } else {
      const { documents } = await import("@/server/db/schema/documents");
      const [doc] = await db.select().from(documents).where(eq(documents.id, args.source.documentId)).limit(1);
      if (!doc) throw new Error("Document not found");
      if (!doc.extractedText) {
        const e = new Error("Document extraction in progress, retry shortly");
        (e as { code?: string }).code = "EXTRACT_PENDING";
        throw e;
      }
      sourceText = doc.extractedText;
      sourceDocumentId = doc.id;
    }

    const { parseQuestions } = await import("./parse");
    const questions = await parseQuestions(sourceText);
    if (questions.length > QUESTION_HARD_LIMIT) {
      throw new Error(`Sets > ${QUESTION_HARD_LIMIT} questions not supported`);
    }

    const [row] = await db
      .insert(incomingDiscoveryRequests)
      .values({
        orgId: args.orgId,
        caseId: args.caseId,
        requestType: args.meta.requestType,
        setNumber: args.meta.setNumber,
        servingParty: args.meta.servingParty,
        dueAt: args.meta.dueAt,
        status: "parsed",
        sourceText,
        sourceDocumentId,
        questions,
        createdBy: args.userId,
      })
      .returning();
    return row;
  } catch (e) {
    await refundCredits(args.userId, 1);
    throw e;
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/unit/discovery-response-orchestrator.test.ts`
Expected: 4 passed.
Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/discovery-response/orchestrator.ts \
        tests/unit/discovery-response-orchestrator.test.ts
git commit -m "feat(discovery-response): orchestrator with batch + retry + concurrency cap"
```

---

## Phase C — tRPC

### Task C1: `discoveryResponseDrafter` router

**Files:**
- Create: `src/server/trpc/routers/discovery-response-drafter.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Implement router**

Create `src/server/trpc/routers/discovery-response-drafter.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { incomingDiscoveryRequests } from "@/server/db/schema/incoming-discovery-requests";
import { ourDiscoveryResponseDrafts } from "@/server/db/schema/our-discovery-response-drafts";
import { isStrategyEnabled } from "@/server/lib/feature-flags";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import {
  DraftsExistError,
  InsufficientCreditsError,
  RequestServedError,
  draftBatch,
  draftSingle,
  parseAndSave,
} from "@/server/services/discovery-response/orchestrator";
import { buildDiscoveryResponseDocx } from "@/server/services/discovery-response/docx";
import type { OurResponseType } from "@/server/db/schema/our-discovery-response-drafts";

function assertEnabled(orgId: string | null | undefined) {
  if (!isStrategyEnabled(orgId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Discovery response drafter not enabled for this organization." });
  }
}

const requestTypeEnum = z.enum(["interrogatories", "rfp", "rfa"]);
const responseTypeEnum = z.enum(["admit", "deny", "object", "lack_of_knowledge", "written_response", "produced_documents"]);

export const discoveryResponseDrafterRouter = router({
  parseAndSave: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      requestType: requestTypeEnum,
      setNumber: z.number().int().min(1).max(99),
      servingParty: z.string().min(1).max(200),
      dueAt: z.string().datetime().optional(),
      source: z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("paste"), text: z.string().min(1) }),
        z.object({ mode: z.literal("document"), documentId: z.string().uuid() }),
      ]),
    }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Org required" });
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await parseAndSave({
          caseId: input.caseId, orgId: ctx.user.orgId, userId: ctx.user.id,
          meta: {
            requestType: input.requestType, setNumber: input.setNumber,
            servingParty: input.servingParty, dueAt: input.dueAt ? new Date(input.dueAt) : null,
          },
          source: input.source,
        });
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "Insufficient credits." });
        }
        if (e instanceof Error && (e as { code?: string }).code === "EXTRACT_PENDING") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        }
        throw e;
      }
    }),

  listIncoming: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      return ctx.db
        .select()
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.caseId, input.caseId))
        .orderBy(incomingDiscoveryRequests.receivedAt);
    }),

  getIncoming: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [req] = await ctx.db
        .select()
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      await assertCaseAccess(ctx, req.caseId);

      const drafts = await ctx.db
        .select()
        .from(ourDiscoveryResponseDrafts)
        .where(eq(ourDiscoveryResponseDrafts.requestId, input.requestId))
        .orderBy(ourDiscoveryResponseDrafts.questionIndex);

      return { request: req, drafts };
    }),

  draftBatch: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [req] = await ctx.db
        .select({ caseId: incomingDiscoveryRequests.caseId })
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      await assertCaseAccess(ctx, req.caseId);
      try {
        return await draftBatch({ requestId: input.requestId, userId: ctx.user.id });
      } catch (e) {
        if (e instanceof DraftsExistError) throw new TRPCError({ code: "CONFLICT", message: e.message });
        if (e instanceof InsufficientCreditsError) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "Insufficient credits." });
        throw e;
      }
    }),

  draftSingle: protectedProcedure
    .input(z.object({ requestId: z.string().uuid(), questionIndex: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [req] = await ctx.db
        .select({ caseId: incomingDiscoveryRequests.caseId })
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      await assertCaseAccess(ctx, req.caseId);
      try {
        return await draftSingle({ requestId: input.requestId, questionIndex: input.questionIndex, userId: ctx.user.id });
      } catch (e) {
        if (e instanceof RequestServedError) throw new TRPCError({ code: "FORBIDDEN", message: e.message });
        if (e instanceof InsufficientCreditsError) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "Insufficient credits." });
        throw e;
      }
    }),

  updateDraft: protectedProcedure
    .input(z.object({
      draftId: z.string().uuid(),
      responseType: responseTypeEnum,
      responseText: z.string().nullable(),
      objectionBasis: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [d] = await ctx.db
        .select({ requestId: ourDiscoveryResponseDrafts.requestId })
        .from(ourDiscoveryResponseDrafts)
        .where(eq(ourDiscoveryResponseDrafts.id, input.draftId))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      const [req] = await ctx.db
        .select({ caseId: incomingDiscoveryRequests.caseId, status: incomingDiscoveryRequests.status })
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, d.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      await assertCaseAccess(ctx, req.caseId);
      if (req.status === "served") throw new TRPCError({ code: "FORBIDDEN", message: "Request is served and locked" });

      await ctx.db
        .update(ourDiscoveryResponseDrafts)
        .set({
          responseType: input.responseType as OurResponseType,
          responseText: input.responseText,
          objectionBasis: input.objectionBasis,
          aiGenerated: false,
          updatedAt: new Date(),
        })
        .where(eq(ourDiscoveryResponseDrafts.id, input.draftId));
      return { success: true };
    }),

  markServed: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [req] = await ctx.db
        .select({ caseId: incomingDiscoveryRequests.caseId })
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      await assertCaseAccess(ctx, req.caseId);
      await ctx.db
        .update(incomingDiscoveryRequests)
        .set({ status: "served", servedAt: new Date(), updatedAt: new Date() })
        .where(eq(incomingDiscoveryRequests.id, input.requestId));
      return { success: true };
    }),

  exportDocx: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [req] = await ctx.db
        .select()
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      await assertCaseAccess(ctx, req.caseId);

      const drafts = await ctx.db
        .select()
        .from(ourDiscoveryResponseDrafts)
        .where(eq(ourDiscoveryResponseDrafts.requestId, input.requestId))
        .orderBy(ourDiscoveryResponseDrafts.questionIndex);

      const { cases } = await import("@/server/db/schema/cases");
      const [c] = await ctx.db.select().from(cases).where(eq(cases.id, req.caseId)).limit(1);

      const buf = await buildDiscoveryResponseDocx(
        {
          requestType: req.requestType as "interrogatories" | "rfp" | "rfa",
          setNumber: req.setNumber,
          servingParty: req.servingParty,
          questions: req.questions as Array<{ number: number; text: string; subparts?: string[] }>,
        },
        drafts.map((d) => ({
          questionIndex: d.questionIndex,
          responseType: d.responseType,
          responseText: d.responseText,
          objectionBasis: d.objectionBasis,
        })),
        {
          plaintiff: c?.plaintiffName ?? "Plaintiff",
          defendant: c?.defendantName ?? "Defendant",
          caseNumber: c?.caseNumber ?? "",
          court: c?.court ?? "U.S. District Court",
        },
      );
      return { base64: buf.toString("base64") };
    }),
});
```

- [ ] **Step 2: Register in root**

Open `src/server/trpc/root.ts`. Add to imports next to `motionCiteCheckRouter`:

```ts
import { discoveryResponseDrafterRouter } from "./routers/discovery-response-drafter";
```

Inside `appRouter = router({ ... })`, add next to `motionCiteCheck`:

```ts
discoveryResponseDrafter: discoveryResponseDrafterRouter,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/discovery-response-drafter.ts src/server/trpc/root.ts
git commit -m "feat(discovery-response): tRPC router (parseAndSave/list/get/batch/single/update/served/docx)"
```

---

## Phase D — UI

### Task D1: `ResponseRow` + `IncomingDiscoveryDetail` components

**Files:**
- Create: `src/components/cases/discovery/incoming/response-row.tsx`
- Create: `src/components/cases/discovery/incoming/incoming-discovery-detail.tsx`

- [ ] **Step 1: `ResponseRow`**

Create `src/components/cases/discovery/incoming/response-row.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type ResponseType =
  | "admit" | "deny" | "object" | "lack_of_knowledge" | "written_response" | "produced_documents";

interface Draft {
  id: string;
  questionIndex: number;
  responseType: ResponseType;
  responseText: string | null;
  objectionBasis: string | null;
  aiGenerated: boolean;
}

interface Props {
  requestId: string;
  questionIndex: number;
  questionNumber: number;
  questionText: string;
  draft: Draft | null;
  isServed: boolean;
}

const TYPE_LABELS: Record<ResponseType, string> = {
  admit: "Admit", deny: "Deny", object: "Object",
  lack_of_knowledge: "Lack of Knowledge", written_response: "Response", produced_documents: "Documents Produced",
};

export function ResponseRow({ requestId, questionIndex, questionNumber, questionText, draft, isServed }: Props) {
  const utils = trpc.useUtils();
  const [responseType, setResponseType] = useState<ResponseType>(draft?.responseType ?? "written_response");
  const [responseText, setResponseText] = useState(draft?.responseText ?? "");
  const [objectionBasis, setObjectionBasis] = useState(draft?.objectionBasis ?? "");

  const update = trpc.discoveryResponseDrafter.updateDraft.useMutation({
    onSuccess: () => utils.discoveryResponseDrafter.getIncoming.invalidate({ requestId }),
    onError: (e) => toast.error(e.message),
  });
  const retry = trpc.discoveryResponseDrafter.draftSingle.useMutation({
    onSuccess: () => {
      toast.success("Re-drafted");
      utils.discoveryResponseDrafter.getIncoming.invalidate({ requestId });
    },
    onError: (e) => toast.error(e.message),
  });

  const onSave = () => {
    if (!draft) return;
    update.mutate({
      draftId: draft.id,
      responseType,
      responseText: responseText || null,
      objectionBasis: objectionBasis || null,
    });
  };

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="text-sm">
        <span className="font-semibold">Q{questionNumber}.</span> {questionText}
      </div>
      {draft ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={responseType}
              onChange={(e) => setResponseType(e.target.value as ResponseType)}
              onBlur={onSave}
              disabled={isServed}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
            >
              {Object.entries(TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            {draft.aiGenerated && <span className="text-xs text-zinc-500">AI</span>}
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => retry.mutate({ requestId, questionIndex })}
                disabled={retry.isPending || isServed}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                {retry.isPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                Regenerate (1cr)
              </button>
            </div>
          </div>
          <textarea
            value={responseText}
            onChange={(e) => setResponseText(e.target.value)}
            onBlur={onSave}
            disabled={isServed}
            placeholder="Response text"
            className="w-full min-h-[60px] rounded border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-200"
          />
          {responseType === "object" && (
            <input
              type="text"
              value={objectionBasis}
              onChange={(e) => setObjectionBasis(e.target.value)}
              onBlur={onSave}
              disabled={isServed}
              placeholder="Objection basis (e.g. vague and ambiguous)"
              className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200"
            />
          )}
        </div>
      ) : (
        <div className="text-xs text-zinc-500">(no response drafted yet)</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `IncomingDiscoveryDetail`**

Create `src/components/cases/discovery/incoming/incoming-discovery-detail.tsx`:

```tsx
"use client";
import { Loader2, FileDown, CheckCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ResponseRow } from "./response-row";

interface Props { requestId: string; }

export function IncomingDiscoveryDetail({ requestId }: Props) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.discoveryResponseDrafter.getIncoming.useQuery({ requestId });
  const draftBatch = trpc.discoveryResponseDrafter.draftBatch.useMutation({
    onSuccess: (r) => {
      toast.success(`Drafted ${r.successCount} of ${r.successCount + r.failedCount} (${r.creditsCharged}cr)`);
      utils.discoveryResponseDrafter.getIncoming.invalidate({ requestId });
    },
    onError: (e) => toast.error(e.message),
  });
  const markServed = trpc.discoveryResponseDrafter.markServed.useMutation({
    onSuccess: () => {
      toast.success("Marked as served");
      utils.discoveryResponseDrafter.getIncoming.invalidate({ requestId });
    },
    onError: (e) => toast.error(e.message),
  });
  const exportDocx = trpc.discoveryResponseDrafter.exportDocx.useQuery(
    { requestId },
    { enabled: false },
  );

  if (isLoading || !data) return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-zinc-500" /></div>;

  const { request, drafts } = data;
  const draftsByIndex = new Map(drafts.map((d) => [d.questionIndex, d]));
  const questions = request.questions as Array<{ number: number; text: string; subparts?: string[] }>;
  const isServed = request.status === "served";
  const hasDrafts = drafts.length > 0;

  const onExport = async () => {
    const r = await exportDocx.refetch();
    if (!r.data?.base64) return toast.error("Export failed");
    const bin = atob(r.data.base64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `discovery-responses-${request.requestType}-set-${request.setNumber}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">
            {request.requestType.toUpperCase()} — Set {request.setNumber}
          </h2>
          <p className="text-xs text-zinc-500">
            From {request.servingParty} · {questions.length} questions · status: {request.status}
            {request.dueAt && ` · due ${new Date(request.dueAt).toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex gap-2">
          {!hasDrafts && !isServed && (
            <Button size="sm" disabled={draftBatch.isPending} onClick={() => draftBatch.mutate({ requestId })}>
              {draftBatch.isPending ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : <RefreshCw className="mr-1.5 size-3" />}
              Draft all responses ({questions.length}cr)
            </Button>
          )}
          {hasDrafts && (
            <Button size="sm" variant="outline" onClick={onExport} disabled={exportDocx.isFetching}>
              <FileDown className="mr-1.5 size-3" /> Export DOCX
            </Button>
          )}
          {hasDrafts && !isServed && (
            <Button size="sm" variant="outline" onClick={() => markServed.mutate({ requestId })}>
              <CheckCircle className="mr-1.5 size-3" /> Mark as served
            </Button>
          )}
        </div>
      </header>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <ResponseRow
            key={i}
            requestId={requestId}
            questionIndex={i}
            questionNumber={q.number}
            questionText={q.text}
            draft={draftsByIndex.get(i) ?? null}
            isServed={isServed}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"
git add src/components/cases/discovery/incoming/response-row.tsx \
        src/components/cases/discovery/incoming/incoming-discovery-detail.tsx
git commit -m "feat(discovery-response): ResponseRow + IncomingDiscoveryDetail components"
```

Expected: no errors.

---

### Task D2: `IncomingDiscoveryList` + `AddIncomingDiscoveryDialog`

**Files:**
- Create: `src/components/cases/discovery/incoming/incoming-discovery-list.tsx`
- Create: `src/components/cases/discovery/incoming/add-incoming-discovery-dialog.tsx`

- [ ] **Step 1: List component**

Create `src/components/cases/discovery/incoming/incoming-discovery-list.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { AddIncomingDiscoveryDialog } from "./add-incoming-discovery-dialog";
import { IncomingDiscoveryDetail } from "./incoming-discovery-detail";

interface Props { caseId: string; }

export function IncomingDiscoveryList({ caseId }: Props) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data, isLoading } = trpc.discoveryResponseDrafter.listIncoming.useQuery({ caseId });

  if (activeId) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setActiveId(null)}
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          ← Back to list
        </button>
        <IncomingDiscoveryDetail requestId={activeId} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Incoming discovery</h2>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-3" /> Add Incoming
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-zinc-500" /></div>
      ) : (data?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-sm text-zinc-500">
          No incoming discovery yet. Click "Add Incoming" to paste or upload requests received from opposing counsel.
        </div>
      ) : (
        <ul className="space-y-2">
          {data!.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setActiveId(r.id)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left hover:bg-zinc-800"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-100">
                    {r.requestType.toUpperCase()} — Set {r.setNumber}
                  </span>
                  <span className="text-xs text-zinc-500">{r.status}</span>
                </div>
                <p className="text-xs text-zinc-500">
                  From {r.servingParty}
                  {r.dueAt && ` · due ${new Date(r.dueAt).toLocaleDateString()}`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <AddIncomingDiscoveryDialog
          caseId={caseId}
          onClose={() => setOpen(false)}
          onCreated={(id) => { setOpen(false); setActiveId(id); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add dialog**

Create `src/components/cases/discovery/incoming/add-incoming-discovery-dialog.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Props {
  caseId: string;
  onClose: () => void;
  onCreated: (requestId: string) => void;
}

export function AddIncomingDiscoveryDialog({ caseId, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<"paste" | "document">("paste");
  const [text, setText] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [requestType, setRequestType] = useState<"interrogatories" | "rfp" | "rfa">("interrogatories");
  const [setNumber, setSetNumber] = useState(1);
  const [servingParty, setServingParty] = useState("");
  const [dueAt, setDueAt] = useState("");

  const parse = trpc.discoveryResponseDrafter.parseAndSave.useMutation({
    onSuccess: (r) => {
      toast.success("Parsed and saved");
      onCreated(r.id);
    },
    onError: (e) => toast.error(e.message),
  });

  const onSubmit = () => {
    parse.mutate({
      caseId,
      requestType,
      setNumber,
      servingParty,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      source: mode === "paste" ? { mode, text } : { mode, documentId },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Add incoming discovery</h3>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="text-zinc-400">Type</span>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as "interrogatories" | "rfp" | "rfa")}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200"
            >
              <option value="interrogatories">Interrogatories</option>
              <option value="rfp">Requests for Production</option>
              <option value="rfa">Requests for Admission</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-zinc-400">Set #</span>
            <input
              type="number" min={1} max={99}
              value={setNumber}
              onChange={(e) => setSetNumber(Number(e.target.value))}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200"
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="text-zinc-400">Serving party</span>
            <input
              type="text"
              placeholder="Plaintiff Smith"
              value={servingParty}
              onChange={(e) => setServingParty(e.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200"
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="text-zinc-400">Due date (optional)</span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200"
            />
          </label>
        </div>

        <div className="flex gap-2 border-b border-zinc-800">
          <button
            type="button"
            onClick={() => setMode("paste")}
            className={`px-3 py-2 text-sm ${mode === "paste" ? "border-b-2 border-white text-white" : "text-zinc-500"}`}
          >Paste</button>
          <button
            type="button"
            onClick={() => setMode("document")}
            className={`px-3 py-2 text-sm ${mode === "document" ? "border-b-2 border-white text-white" : "text-zinc-500"}`}
          >Use uploaded document</button>
        </div>

        {mode === "paste" ? (
          <textarea
            placeholder="Paste interrogatories / RFP / RFA text here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full min-h-[200px] rounded border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-200"
          />
        ) : (
          <div className="space-y-2">
            <label className="block text-sm">
              <span className="text-zinc-400">Document ID</span>
              <input
                type="text"
                placeholder="Paste a document UUID from the case"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200 font-mono"
              />
            </label>
            <p className="text-xs text-zinc-500">
              Upload your file via the case Documents tab first, then paste its ID here.
              The file must finish text extraction before parsing.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={parse.isPending || !servingParty || (mode === "paste" ? !text : !documentId)}
            onClick={onSubmit}
          >
            {parse.isPending ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : null}
            Parse &amp; save (1cr)
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"
git add src/components/cases/discovery/incoming/incoming-discovery-list.tsx \
        src/components/cases/discovery/incoming/add-incoming-discovery-dialog.tsx
git commit -m "feat(discovery-response): IncomingDiscoveryList + Add dialog"
```

Expected: no errors.

---

### Task D3: Wire Outgoing/Incoming toggle into `DiscoveryTab`

**Files:**
- Modify: `src/components/cases/discovery/discovery-tab.tsx`

- [ ] **Step 1: Read current tab**

Open `src/components/cases/discovery/discovery-tab.tsx`. Locate the top of the component body. We'll add a toggle that switches between the existing outgoing flow and the new `IncomingDiscoveryList`.

- [ ] **Step 2: Add toggle**

Add to imports:

```ts
import { IncomingDiscoveryList } from "./incoming/incoming-discovery-list";
```

Inside `DiscoveryTab` component body, add a top-level mode state:

```ts
const [mode, setMode] = useState<"outgoing" | "incoming">("outgoing");
```

(Make sure `useState` is already imported.)

Wrap the existing return JSX in a parent `<div>` with the toggle on top:

```tsx
return (
  <div className="space-y-4">
    <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-950 p-1">
      <button
        type="button"
        onClick={() => setMode("outgoing")}
        className={`px-3 py-1 text-sm rounded ${mode === "outgoing" ? "bg-zinc-800 text-white" : "text-zinc-400"}`}
      >
        Outgoing
      </button>
      <button
        type="button"
        onClick={() => setMode("incoming")}
        className={`px-3 py-1 text-sm rounded ${mode === "incoming" ? "bg-zinc-800 text-white" : "text-zinc-400"}`}
      >
        Incoming
      </button>
    </div>

    {mode === "outgoing" ? (
      <>{/* existing outgoing content (everything that was rendered before) */}</>
    ) : (
      <IncomingDiscoveryList caseId={caseId} />
    )}
  </div>
);
```

Move all the previous JSX (NewDiscoveryWizard, grouped requests list, PrivilegeLogSection, SubpoenasSection, etc.) inside the `<>{/* outgoing */}</>` fragment.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"
git add src/components/cases/discovery/discovery-tab.tsx
git commit -m "feat(discovery-response): Outgoing/Incoming toggle in DiscoveryTab"
```

Expected: no errors.

---

## Phase E — E2E + final checks

### Task E1: Playwright smoke

**Files:**
- Create: `e2e/discovery-response-smoke.spec.ts`

- [ ] **Step 1: Write spec**

Create `e2e/discovery-response-smoke.spec.ts`:

```ts
// Phase 4.5 smoke: discovery tab renders without 500 with the incoming
// drafter bundle present. Real flow (parse + draft + DOCX) is manual UAT.
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("4.5 discovery response drafter smoke", () => {
  test("case discovery tab returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=discovery`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/discovery-response-smoke.spec.ts
git commit -m "test(discovery-response): Playwright smoke for discovery tab"
```

---

### Task E2: Full test + typecheck pass

- [ ] **Step 1: Run vitest**

Run: `npx vitest run`
Expected: all tests pass; total ≈ previous 1247 + ~15 new (5 parse + 4 respond + 2 docx + 4 orchestrator).

The pre-existing flake in `tests/integration/case-messages-router.test.ts` (voyageai ESM resolution) may still report a failed file with no test failures — ignore it.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: only the pre-existing `stripe.ts` API-version error.

- [ ] **Step 3: If anything new is red, halt and resolve before opening PR.**

---

### Task E3: Push + open PR

- [ ] **Step 1: Push**

```bash
git push -u origin feat/discovery-response-drafter
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(4.5): Discovery Response Drafter — incoming requests + AI response generation" --body "$(cat <<'EOF'
## Summary

Adds a new "Incoming" sub-tab to \`/cases/[id]?tab=discovery\` where lawyers paste or upload opposing counsel's interrogatories / RFPs / RFAs, parse them into structured questions with Claude, batch-generate structured responses (admit / deny / object / lack_of_knowledge / written_response / produced_documents) using case-doc RAG, edit inline, retry weak rows with richer context, and export DOCX.

- Spec: docs/superpowers/specs/2026-05-01-discovery-response-drafter-design.md
- Plan: docs/superpowers/plans/2026-05-01-discovery-response-drafter.md

## Phases

- **A** — schemas + migration **0058** (incoming + drafts tables) applied to Supabase prod
- **B** — backend services (TDD): types, parse (Claude), respond (per-q + rich), docx, orchestrator with concurrency cap 5 + budget exhaustion
- **C** — tRPC \`discoveryResponseDrafter\` router (parseAndSave / list / get / draftBatch / draftSingle / updateDraft / markServed / exportDocx)
- **D** — UI: ResponseRow + IncomingDiscoveryDetail + IncomingDiscoveryList + Add dialog + Outgoing/Incoming toggle in DiscoveryTab
- **E** — Playwright smoke + full suite green

## Decisions

| # | Choice |
|---|---|
| Storage | New tables for incoming + our drafts (clean separation from outgoing 3.1.x) |
| Entry mode | Paste + Upload |
| Generation flow | Hybrid batch + per-question retry (rich context) |
| Response shape | Structured (\`responseType\` + \`responseText\` + \`objectionBasis\`); reuses 3.1 enum |
| RAG scope | Per-question top-5 for batch; full digest + top-8 for retry |
| Pricing | 1cr extract + 1cr per question generation (mirrors 4.4 cite-check) |
| UI placement | Sub-tab in existing Discovery tab |

## Test plan (manual UAT after merge)

- [ ] Open \`/cases/<id>?tab=discovery\` → toggle to Incoming
- [ ] Click Add Incoming → paste 5 interrogatories → Parse
- [ ] On detail page click "Draft all responses (5cr)" → wait ~10-30s → 5 responses appear
- [ ] Edit one response inline → blur → confirm aiGenerated flips to false
- [ ] Click "Regenerate" on one row (1cr extra) → response refreshes
- [ ] Click Export DOCX → file downloads with header + Q&A pairs
- [ ] Click Mark as served → status flips, all controls disabled
- [ ] Verify upload path: upload PDF via Documents tab → wait for extract → Add Incoming → use document mode → parses
- [ ] Verify budget exhaustion: drain credits to ≤ 2, batch on 5-question set → first 1-2 succeed, rest get budget-exhausted placeholder

## Tests

- ~15 new vitest cases (5 parse + 4 respond + 2 docx + 4 orchestrator)
- 1 new Playwright smoke
- Suite total: ≈1262 passing (was 1247)
- Typecheck clean (only pre-existing stripe.ts API-version error)
- Migration 0058 applied to Supabase prod

## Out of scope (deferred)

1. Manual question entry (paste / upload only)
2. Multi-set bulk batch
3. Service tracking integration (DOCX only)
4. Privilege log auto-generation
5. Cross-set context awareness
6. Calendar reminder for due_at
7. Re-parse on source edit
EOF
)"
```

- [ ] **Step 3: Capture PR URL.**

---

## Summary

| Phase | Tasks | New files | Modified files |
|---|---|---|---|
| A | 2 | 3 | 0 |
| B | 5 | 6 (1 types + 5 service + 4 tests) | 0 |
| C | 1 | 1 | 1 |
| D | 3 | 4 | 1 |
| E | 3 | 1 | 0 |

**Total:** 14 tasks. New unit tests: ~15. New e2e smoke: 1. New migration: 0058. Net new files: ~16.

## Out of scope (deferred)

1. Manual question entry (paste / upload only)
2. Multi-set bulk batch
3. Service tracking integration
4. Privilege log auto-generation
5. Cross-set context awareness
6. Calendar reminder for due_at
7. Re-parse on source edit
8. Streaming response generation
9. Multi-language Bluebook / non-English text
