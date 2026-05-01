# 4.3 AI Motion Drafter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strategy → Motion bridge — let a lawyer click "Draft this motion" on a 4.2 recommendation card, see a preview of which template + sources will be used, confirm, and land in the existing 2.4.2 motion editor with auto-pulled context pre-loaded.

**Architecture:** New `motion-drafter` service (classify + sources + orchestrator) + new tRPC router + 1 migration adding 4 columns + small modifications to existing `motions.create`, `draftMotionSection`, `motion-wizard.tsx`, and `recommendation-card.tsx`. Reuses 4.2 Voyage RAG infra and 2.4.2 motion editor.

**Tech Stack:** TypeScript / Next.js 16 / Drizzle / postgres+pgvector / Anthropic SDK / Voyage AI / tRPC v11 / vitest / Playwright.

**Active deviations from spec:** none (all spec decisions captured).

---

## Phase A — Schema + migration

### Task A1: Create feature branch + Drizzle schema deltas

**Files:**
- Modify: `src/server/db/schema/case-strategy-recommendations.ts`
- Modify: `src/server/db/schema/case-motions.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git pull --rebase origin main
git checkout -b feat/motion-drafter
```

- [ ] **Step 2: Add columns to `case_strategy_recommendations`**

Open `src/server/db/schema/case-strategy-recommendations.ts`. Add to the imports at the top (if not already imported):

```ts
import { numeric } from "drizzle-orm/pg-core";
import { motionTemplates } from "./motion-templates";
```

Inside the table definition object, add two new columns next to existing `dismissed_by`:

```ts
suggestedTemplateId: uuid("suggested_template_id").references(() => motionTemplates.id, { onDelete: "set null" }),
suggestConfidence: numeric("suggest_confidence", { precision: 3, scale: 2 }),
```

- [ ] **Step 3: Add columns to `case_motions`**

Open `src/server/db/schema/case-motions.ts`. Add to the imports at the top (if not already imported):

```ts
import { jsonb } from "drizzle-orm/pg-core";
import { caseStrategyRecommendations } from "./case-strategy-recommendations";
```

Inside the table definition, add two columns next to existing `created_by`:

```ts
drafterContextJson: jsonb("drafter_context_json"),
draftedFromRecommendationId: uuid("drafted_from_recommendation_id").references(() => caseStrategyRecommendations.id, { onDelete: "set null" }),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | head -10`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/case-strategy-recommendations.ts \
        src/server/db/schema/case-motions.ts
git commit -m "feat(motion-drafter): schema deltas for classifier cache + drafter context"
```

---

### Task A2: SQL migration 0056 + apply to Supabase

**Files:**
- Create: `src/server/db/migrations/0056_motion_drafter.sql`

- [ ] **Step 1: Write migration**

Create `src/server/db/migrations/0056_motion_drafter.sql`:

```sql
ALTER TABLE case_strategy_recommendations
  ADD COLUMN suggested_template_id uuid REFERENCES motion_templates(id) ON DELETE SET NULL,
  ADD COLUMN suggest_confidence numeric(3,2);

ALTER TABLE case_motions
  ADD COLUMN drafter_context_json jsonb,
  ADD COLUMN drafted_from_recommendation_id uuid REFERENCES case_strategy_recommendations(id) ON DELETE SET NULL;
```

- [ ] **Step 2: Apply via the existing batch script**

Run: `pnpm tsx scripts/apply-migrations-batch.ts 0056 0056`
Expected output ends with `applied 1 migration(s)`.

If the script complains the file doesn't exist or the range is empty, double-check the filename starts with `0056_` (4-digit prefix).

- [ ] **Step 3: Verify columns landed**

Run a one-off sanity script (do NOT commit it). Create a temp file `/tmp/verify-0056.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "prefer" });
  const cols = await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_name IN ('case_strategy_recommendations', 'case_motions')
      AND column_name IN ('suggested_template_id','suggest_confidence','drafter_context_json','drafted_from_recommendation_id')
    ORDER BY table_name, column_name`;
  console.table(cols);
  await sql.end();
}
main();
```

Run: `pnpm tsx /tmp/verify-0056.ts`
Expected: 4 rows listed. Delete the temp script after.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/migrations/0056_motion_drafter.sql
git commit -m "feat(motion-drafter): migration 0056 — classifier cache + drafter context cols"
```

---

## Phase B — Backend services (TDD)

### Task B1: classify.ts — Claude template classifier

**Files:**
- Create: `src/server/services/motion-drafter/types.ts`
- Create: `src/server/services/motion-drafter/classify.ts`
- Test: `tests/unit/motion-drafter-classify.test.ts`

- [ ] **Step 1: Types**

Create `src/server/services/motion-drafter/types.ts`:

```ts
import type { Citation, DocChunk } from "@/server/services/case-strategy/types";

export interface TemplateOption {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export interface ClassifyResult {
  templateId: string | null;
  confidence: number;
  reasoning: string;
}

export interface DrafterContext {
  chunks: DocChunk[];
  citedEntities: Citation[];
  fromRecommendationId: string;
  generatedAt: string;
}

export interface SuggestionResult {
  template: { id: string; slug: string; name: string } | null;
  confidence: number;
  suggestedTitle: string;
  citedEntities: Citation[];
  autoPulledChunks: DocChunk[];
  suggestedFromCache: boolean;
}
```

- [ ] **Step 2: Failing test**

Create `tests/unit/motion-drafter-classify.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { classifyTemplate } from "@/server/services/motion-drafter/classify";
import type { TemplateOption } from "@/server/services/motion-drafter/types";

const TEMPLATES: TemplateOption[] = [
  { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "Motion to Dismiss (12(b)(6))", description: "Failure to state a claim" },
  { id: "t-msj", slug: "motion_for_summary_judgment", name: "Motion for Summary Judgment", description: "FRCP 56" },
  { id: "t-mtc", slug: "motion_to_compel", name: "Motion to Compel Discovery", description: "FRCP 37" },
];

beforeEach(() => messagesCreateMock.mockReset());

describe("classifyTemplate", () => {
  it("happy path: picks valid template + parses confidence", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ template_id: "t-mtd", confidence: 0.92, reasoning: "MTD signals" }) }],
    });
    const out = await classifyTemplate(
      { title: "File Motion to Dismiss for failure to state a claim", rationale: "Plaintiff lacks elements", category: "procedural" },
      TEMPLATES,
    );
    expect(out.templateId).toBe("t-mtd");
    expect(out.confidence).toBeCloseTo(0.92);
    expect(out.reasoning).toContain("MTD");
  });

  it("hallucinated id → null template, confidence 0", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ template_id: "t-fake", confidence: 0.99, reasoning: "x" }) }],
    });
    const out = await classifyTemplate(
      { title: "x", rationale: "x", category: "procedural" },
      TEMPLATES,
    );
    expect(out.templateId).toBeNull();
    expect(out.confidence).toBe(0);
  });

  it("malformed JSON → throws parse error", async () => {
    messagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "not json" }] });
    await expect(
      classifyTemplate({ title: "x", rationale: "x", category: "procedural" }, TEMPLATES),
    ).rejects.toThrow(/parse/i);
  });

  it("clamps confidence to [0,1]", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ template_id: "t-mtd", confidence: 1.5, reasoning: "x" }) }],
    });
    const out = await classifyTemplate({ title: "x", rationale: "x", category: "procedural" }, TEMPLATES);
    expect(out.confidence).toBe(1);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `npx vitest run tests/unit/motion-drafter-classify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement classify.ts**

Create `src/server/services/motion-drafter/classify.ts`:

```ts
import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { ClassifyResult, TemplateOption } from "./types";

const SYSTEM = `You are a litigation classifier. Given a strategic recommendation and a list of available motion templates, pick the SINGLE best matching template id, or return null if none clearly fit. Output strict JSON: {"template_id": "<uuid|null>", "confidence": <0..1>, "reasoning": "<one sentence>"}. Confidence reflects how directly the recommendation maps to the template's purpose. Never invent template ids.`;

export interface RecForClassify {
  title: string;
  rationale: string;
  category: string;
}

export async function classifyTemplate(
  rec: RecForClassify,
  templates: TemplateOption[],
): Promise<ClassifyResult> {
  const env = getEnv();
  const anthropic = getAnthropic();

  const userContent = [
    `# Recommendation`,
    `Category: ${rec.category}`,
    `Title: ${rec.title}`,
    `Rationale: ${rec.rationale}`,
    ``,
    `# Available templates`,
    ...templates.map((t) => `- id=${t.id} slug=${t.slug} name="${t.name}" description="${t.description}"`),
  ].join("\n");

  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 500,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: { template_id: string | null; confidence: number; reasoning: string };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse classifier JSON: ${e instanceof Error ? e.message : e}`);
  }

  const validIds = new Set(templates.map((t) => t.id));
  const id = parsed.template_id && validIds.has(parsed.template_id) ? parsed.template_id : null;
  const conf = id === null ? 0 : Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));

  return {
    templateId: id,
    confidence: conf,
    reasoning: String(parsed.reasoning ?? ""),
  };
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `npx vitest run tests/unit/motion-drafter-classify.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/motion-drafter/types.ts \
        src/server/services/motion-drafter/classify.ts \
        tests/unit/motion-drafter-classify.test.ts
git commit -m "feat(motion-drafter): Claude template classifier"
```

---

### Task B2: sources.ts — RAG + cited-entity bundle

**Files:**
- Create: `src/server/services/motion-drafter/sources.ts`
- Test: `tests/unit/motion-drafter-sources.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/motion-drafter-sources.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const embedTextsMock = vi.fn();
const dbExecuteMock = vi.fn();
const dbSelectFromWhereMock = vi.fn();

vi.mock("@/server/services/case-strategy/voyage", () => ({
  embedTexts: embedTextsMock,
}));
vi.mock("@/server/db", () => ({
  db: {
    execute: dbExecuteMock,
    select: () => ({ from: () => ({ where: dbSelectFromWhereMock }) }),
  },
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ VOYAGE_API_KEY: "test-key", STRATEGY_TOP_K_CHUNKS: 8 }),
}));

import { bundleSources } from "@/server/services/motion-drafter/sources";

beforeEach(() => {
  embedTextsMock.mockReset();
  dbExecuteMock.mockReset();
  dbSelectFromWhereMock.mockReset();
});

describe("bundleSources", () => {
  it("returns cited entities + RAG chunks for a non-empty case", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    dbExecuteMock.mockResolvedValue([
      { document_id: "doc-1", document_title: "Compl.", chunk_index: 0, content: "...", similarity: 0.91 },
    ]);
    dbSelectFromWhereMock.mockResolvedValue([{ id: "doc-1" }]);

    const out = await bundleSources("c1", {
      title: "MTD on personal jurisdiction",
      rationale: "no minimum contacts",
      citations: [{ kind: "document", id: "doc-1" }],
    });

    expect(out.autoPulledChunks).toHaveLength(1);
    expect(out.citedEntities).toHaveLength(1);
    expect(out.citedEntities[0].kind).toBe("document");
    expect(embedTextsMock).toHaveBeenCalledWith(expect.any(Array), "query");
  });

  it("empty case (no docs, no citations) → empty bundle, no Voyage call", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    dbExecuteMock.mockResolvedValue([]);
    dbSelectFromWhereMock.mockResolvedValue([]);

    const out = await bundleSources("c1", {
      title: "x",
      rationale: "y",
      citations: [],
    });

    expect(out.autoPulledChunks).toEqual([]);
    expect(out.citedEntities).toEqual([]);
  });

  it("drops cited document ids that no longer exist", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    dbExecuteMock.mockResolvedValue([]);
    dbSelectFromWhereMock.mockResolvedValue([{ id: "doc-live" }]);

    const out = await bundleSources("c1", {
      title: "x",
      rationale: "y",
      citations: [
        { kind: "document", id: "doc-live" },
        { kind: "document", id: "doc-stale" },
      ],
    });

    expect(out.citedEntities).toHaveLength(1);
    expect(out.citedEntities[0].id).toBe("doc-live");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/motion-drafter-sources.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sources.ts**

Create `src/server/services/motion-drafter/sources.ts`:

```ts
import { inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { documents } from "@/server/db/schema/documents";
import { embedTexts } from "@/server/services/case-strategy/voyage";
import { getEnv } from "@/lib/env";
import type { Citation, DocChunk } from "@/server/services/case-strategy/types";

export interface RecForSources {
  title: string;
  rationale: string;
  citations: Citation[];
}

export interface SourcesBundle {
  autoPulledChunks: DocChunk[];
  citedEntities: Citation[];
}

export async function bundleSources(
  caseId: string,
  rec: RecForSources,
): Promise<SourcesBundle> {
  const env = getEnv();

  const docCitations = rec.citations.filter((c) => c.kind === "document");
  let liveDocIds = new Set<string>();
  if (docCitations.length > 0) {
    const ids = docCitations.map((c) => c.id);
    const liveRows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(inArray(documents.id, ids));
    liveDocIds = new Set(liveRows.map((r) => r.id));
  }
  const citedEntities: Citation[] = rec.citations.filter(
    (c) => c.kind !== "document" || liveDocIds.has(c.id),
  );

  let autoPulledChunks: DocChunk[] = [];
  if (env.VOYAGE_API_KEY) {
    const [queryVec] = await embedTexts(
      [`${rec.title}. ${rec.rationale}`],
      "query",
    );
    if (queryVec && queryVec.length > 0) {
      const k = Number(env.STRATEGY_TOP_K_CHUNKS ?? 8);
      const queryLit = `[${queryVec.join(",")}]`;
      const rows = await db.execute<{
        document_id: string;
        document_title: string;
        chunk_index: number;
        content: string;
        similarity: number;
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
      autoPulledChunks = rows.map((r) => ({
        documentId: r.document_id,
        documentTitle: r.document_title,
        chunkIndex: r.chunk_index,
        content: r.content,
        similarity: Number(r.similarity),
      }));
    }
  }

  return { autoPulledChunks, citedEntities };
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `npx vitest run tests/unit/motion-drafter-sources.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/motion-drafter/sources.ts \
        tests/unit/motion-drafter-sources.test.ts
git commit -m "feat(motion-drafter): RAG + cited-entity source bundle"
```

---

### Task B3: orchestrator.ts — full suggest flow

**Files:**
- Create: `src/server/services/motion-drafter/orchestrator.ts`
- Test: `tests/unit/motion-drafter-orchestrator.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/motion-drafter-orchestrator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const classifyMock = vi.fn();
const bundleMock = vi.fn();
const decrementMock = vi.fn();
const refundMock = vi.fn();
const dbSelectRecMock = vi.fn();
const dbSelectTplMock = vi.fn();
const dbUpdateMock = vi.fn();

vi.mock("@/server/services/motion-drafter/classify", () => ({
  classifyTemplate: classifyMock,
}));
vi.mock("@/server/services/motion-drafter/sources", () => ({
  bundleSources: bundleMock,
}));
vi.mock("@/server/services/credits", () => ({
  decrementCredits: decrementMock,
  refundCredits: refundMock,
}));
vi.mock("@/server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((tbl: { _name?: string }) => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(tbl._name === "tpl" ? dbSelectTplMock() : dbSelectRecMock())),
        })),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => dbUpdateMock()) })) })),
  },
}));
// Force the .from() distinguisher
vi.mock("@/server/db/schema/case-strategy-recommendations", () => ({
  caseStrategyRecommendations: { _name: "rec", id: "rec.id" },
}));
vi.mock("@/server/db/schema/motion-templates", () => ({
  motionTemplates: { _name: "tpl", id: "tpl.id", orgId: "tpl.orgId" },
}));

beforeEach(() => {
  [classifyMock, bundleMock, decrementMock, refundMock, dbSelectRecMock, dbSelectTplMock, dbUpdateMock]
    .forEach((m) => m.mockReset());
});

describe("suggestMotion", () => {
  it("first call: classifies, charges credits, returns result", async () => {
    dbSelectRecMock.mockResolvedValue([
      { id: "r1", caseId: "c1", title: "MTD", rationale: "x", category: "procedural", citations: [], suggestedTemplateId: null, suggestConfidence: null },
    ]);
    dbSelectTplMock.mockResolvedValue([
      { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "MTD", description: "FRCP 12(b)(6)" },
    ]);
    classifyMock.mockResolvedValue({ templateId: "t-mtd", confidence: 0.9, reasoning: "x" });
    bundleMock.mockResolvedValue({ autoPulledChunks: [], citedEntities: [] });
    decrementMock.mockResolvedValue(true);

    const { suggestMotion } = await import("@/server/services/motion-drafter/orchestrator");
    const out = await suggestMotion({ recommendationId: "r1", userId: "u1", orgId: "o1" });

    expect(out.template?.id).toBe("t-mtd");
    expect(out.confidence).toBeCloseTo(0.9);
    expect(out.suggestedFromCache).toBe(false);
    expect(decrementMock).toHaveBeenCalledOnce();
    expect(refundMock).not.toHaveBeenCalled();
  });

  it("cache hit: skips classify + skips charge", async () => {
    dbSelectRecMock.mockResolvedValue([
      { id: "r1", caseId: "c1", title: "x", rationale: "y", category: "procedural", citations: [], suggestedTemplateId: "t-mtd", suggestConfidence: "0.85" },
    ]);
    dbSelectTplMock.mockResolvedValue([
      { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "MTD", description: "x" },
    ]);
    bundleMock.mockResolvedValue({ autoPulledChunks: [], citedEntities: [] });

    const { suggestMotion } = await import("@/server/services/motion-drafter/orchestrator");
    const out = await suggestMotion({ recommendationId: "r1", userId: "u1", orgId: "o1" });

    expect(out.template?.id).toBe("t-mtd");
    expect(out.suggestedFromCache).toBe(true);
    expect(classifyMock).not.toHaveBeenCalled();
    expect(decrementMock).not.toHaveBeenCalled();
  });

  it("classifier failure → refunds credits, re-throws", async () => {
    dbSelectRecMock.mockResolvedValue([
      { id: "r1", caseId: "c1", title: "x", rationale: "y", category: "procedural", citations: [], suggestedTemplateId: null, suggestConfidence: null },
    ]);
    dbSelectTplMock.mockResolvedValue([
      { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "MTD", description: "x" },
    ]);
    decrementMock.mockResolvedValue(true);
    classifyMock.mockRejectedValue(new Error("Claude down"));

    const { suggestMotion } = await import("@/server/services/motion-drafter/orchestrator");
    await expect(
      suggestMotion({ recommendationId: "r1", userId: "u1", orgId: "o1" }),
    ).rejects.toThrow(/Claude down/);
    expect(refundMock).toHaveBeenCalledOnce();
  });

  it("low confidence: persists null template, charge holds, banner-friendly result", async () => {
    dbSelectRecMock.mockResolvedValue([
      { id: "r1", caseId: "c1", title: "x", rationale: "y", category: "procedural", citations: [], suggestedTemplateId: null, suggestConfidence: null },
    ]);
    dbSelectTplMock.mockResolvedValue([
      { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "MTD", description: "x" },
    ]);
    classifyMock.mockResolvedValue({ templateId: "t-mtd", confidence: 0.4, reasoning: "weak" });
    bundleMock.mockResolvedValue({ autoPulledChunks: [], citedEntities: [] });
    decrementMock.mockResolvedValue(true);

    const { suggestMotion } = await import("@/server/services/motion-drafter/orchestrator");
    const out = await suggestMotion({ recommendationId: "r1", userId: "u1", orgId: "o1" });

    expect(out.template).toBeNull();
    expect(out.confidence).toBeCloseTo(0.4);
    expect(refundMock).not.toHaveBeenCalled();
  });

  it("insufficient credits: throws PAYMENT_REQUIRED before classify", async () => {
    dbSelectRecMock.mockResolvedValue([
      { id: "r1", caseId: "c1", title: "x", rationale: "y", category: "procedural", citations: [], suggestedTemplateId: null, suggestConfidence: null },
    ]);
    dbSelectTplMock.mockResolvedValue([
      { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "MTD", description: "x" },
    ]);
    decrementMock.mockResolvedValue(false);

    const { suggestMotion, InsufficientCreditsError } = await import("@/server/services/motion-drafter/orchestrator");
    await expect(
      suggestMotion({ recommendationId: "r1", userId: "u1", orgId: "o1" }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(classifyMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/motion-drafter-orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement orchestrator.ts**

Create `src/server/services/motion-drafter/orchestrator.ts`:

```ts
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/server/db";
import { caseStrategyRecommendations } from "@/server/db/schema/case-strategy-recommendations";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { classifyTemplate } from "./classify";
import { bundleSources } from "./sources";
import type { SuggestionResult, TemplateOption } from "./types";

const SUGGEST_COST = 5;

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}

export interface SuggestArgs {
  recommendationId: string;
  userId: string;
  orgId: string;
}

export async function suggestMotion(args: SuggestArgs): Promise<SuggestionResult & { caseId: string }> {
  const [rec] = await db
    .select()
    .from(caseStrategyRecommendations)
    .where(eq(caseStrategyRecommendations.id, args.recommendationId))
    .limit(1);
  if (!rec) throw new Error(`Recommendation ${args.recommendationId} not found`);

  const tplRows = await db
    .select()
    .from(motionTemplates)
    .where(or(isNull(motionTemplates.orgId), eq(motionTemplates.orgId, args.orgId)))
    .limit(50);
  const templates: TemplateOption[] = tplRows.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description ?? "",
  }));

  // Cache check
  const isCached = rec.suggestConfidence !== null;
  let templateId: string | null;
  let confidence: number;

  if (isCached) {
    templateId = rec.suggestedTemplateId ?? null;
    confidence = Number(rec.suggestConfidence);
  } else {
    const credited = await decrementCredits(args.userId, SUGGEST_COST);
    if (!credited) throw new InsufficientCreditsError();

    try {
      const result = await classifyTemplate(
        {
          title: rec.title,
          rationale: rec.rationale,
          category: rec.category,
        },
        templates,
      );
      templateId = result.confidence >= 0.7 ? result.templateId : null;
      confidence = result.confidence;

      await db
        .update(caseStrategyRecommendations)
        .set({
          suggestedTemplateId: templateId,
          suggestConfidence: String(confidence),
        })
        .where(eq(caseStrategyRecommendations.id, args.recommendationId));
    } catch (e) {
      await refundCredits(args.userId, SUGGEST_COST);
      throw e;
    }
  }

  const sources = await bundleSources(rec.caseId, {
    title: rec.title,
    rationale: rec.rationale,
    citations: (rec.citations as never) ?? [],
  });

  const tpl = templateId ? templates.find((t) => t.id === templateId) ?? null : null;
  const suggestedTitle = tpl ? `${tpl.name} — ${rec.title.slice(0, 80)}` : rec.title.slice(0, 80);

  return {
    caseId: rec.caseId,
    template: tpl ? { id: tpl.id, slug: tpl.slug, name: tpl.name } : null,
    confidence,
    suggestedTitle,
    citedEntities: sources.citedEntities,
    autoPulledChunks: sources.autoPulledChunks,
    suggestedFromCache: isCached,
  };
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `npx vitest run tests/unit/motion-drafter-orchestrator.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/motion-drafter/orchestrator.ts \
        tests/unit/motion-drafter-orchestrator.test.ts
git commit -m "feat(motion-drafter): orchestrator (cache/credit/classify/sources flow)"
```

---

## Phase C — Inject excerpts into existing draft service

### Task C1: Modify `draftMotionSection` to accept extra excerpts

**Files:**
- Modify: `src/server/services/motions/draft.ts`
- Test: `tests/unit/motion-drafter-prompt.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/motion-drafter-prompt.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const messagesCreateMock = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "draft body" }],
});
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: messagesCreateMock },
  })),
}));

import { draftMotionSection } from "@/server/services/motions/draft";

describe("draftMotionSection with drafter excerpts", () => {
  it("prepends excerpts block to prompt when extraExcerpts present", async () => {
    messagesCreateMock.mockClear();
    await draftMotionSection({
      motionType: "motion_to_dismiss",
      sectionKey: "introduction",
      caseFacts: "facts",
      attachedMemos: [],
      extraExcerpts: [
        { documentTitle: "Compl.", chunkIndex: 0, content: "Plaintiff alleges X.", similarity: 0.9 },
        { documentTitle: "Compl.", chunkIndex: 1, content: "Plaintiff alleges Y.", similarity: 0.8 },
        { documentTitle: "Aff.", chunkIndex: 0, content: "Z stated W.", similarity: 0.7 },
        { documentTitle: "Aff.", chunkIndex: 1, content: "Should be dropped (top-3 only).", similarity: 0.6 },
      ],
    });
    const sentPrompt = messagesCreateMock.mock.calls[0][0].messages[0].content;
    expect(sentPrompt).toMatch(/## Relevant case excerpts/);
    expect(sentPrompt).toContain("Plaintiff alleges X.");
    expect(sentPrompt).toContain("Z stated W.");
    expect(sentPrompt).not.toContain("Should be dropped");
  });

  it("does not add excerpts block when extraExcerpts absent", async () => {
    messagesCreateMock.mockClear();
    await draftMotionSection({
      motionType: "motion_to_dismiss",
      sectionKey: "introduction",
      caseFacts: "facts",
      attachedMemos: [],
    });
    const sentPrompt = messagesCreateMock.mock.calls[0][0].messages[0].content;
    expect(sentPrompt).not.toMatch(/## Relevant case excerpts/);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/motion-drafter-prompt.test.ts`
Expected: FAIL — `extraExcerpts` not on `DraftInput`.

- [ ] **Step 3: Modify `draft.ts`**

Open `src/server/services/motions/draft.ts`. Replace the file with:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { renderPrompt } from "./prompts";
import type { MotionType, SectionKey, AttachedMemo, Citation } from "./types";

export class NoMemosAttachedError extends Error {
  constructor() {
    super("Argument section requires at least one attached research memo");
    this.name = "NoMemosAttachedError";
  }
}

const MEMO_MARKER = /\[\[memo:([0-9a-fA-F-]{36})\]\]/g;

export interface DraftExcerpt {
  documentTitle: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

export interface DraftInput {
  motionType: MotionType;
  sectionKey: SectionKey;
  caseFacts: string;
  attachedMemos: AttachedMemo[];
  extraExcerpts?: DraftExcerpt[];
}

export interface DraftOutput {
  text: string;
  citations: Citation[];
}

const EXCERPT_TOP_N = 3;
const EXCERPT_CHAR_CAP = 1500;

function renderExcerptsBlock(excerpts: DraftExcerpt[]): string {
  const top = excerpts.slice(0, EXCERPT_TOP_N);
  if (top.length === 0) return "";
  const lines = top.map(
    (e) => `[${e.documentTitle}#${e.chunkIndex}] ${e.content.slice(0, EXCERPT_CHAR_CAP)}`,
  );
  return ["## Relevant case excerpts", ...lines, ""].join("\n");
}

export async function draftMotionSection(
  input: DraftInput,
  deps: { client?: Anthropic } = {},
): Promise<DraftOutput> {
  if (input.sectionKey === "argument" && input.attachedMemos.length === 0) {
    throw new NoMemosAttachedError();
  }
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const basePrompt = renderPrompt(input.motionType, input.sectionKey, {
    caseFacts: input.caseFacts,
    attachedMemos: input.attachedMemos,
  });
  const excerptsBlock = input.extraExcerpts && input.extraExcerpts.length > 0
    ? renderExcerptsBlock(input.extraExcerpts)
    : "";
  const prompt = excerptsBlock ? `${excerptsBlock}\n${basePrompt}` : basePrompt;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && "text" in textBlock ? textBlock.text : "";

  const memoMap = new Map(input.attachedMemos.map((m) => [m.id, m]));
  const citations: Citation[] = [];
  for (const match of text.matchAll(MEMO_MARKER)) {
    const memoId = match[1];
    const memo = memoMap.get(memoId);
    if (memo) citations.push({ memoId, snippet: memo.title });
  }

  return { text, citations };
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `npx vitest run tests/unit/motion-drafter-prompt.test.ts`
Expected: 2 passed.

Also re-run any existing motion tests to confirm we did not break them:

Run: `npx vitest run tests/unit/motions`
Expected: all pre-existing motion tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/motions/draft.ts tests/unit/motion-drafter-prompt.test.ts
git commit -m "feat(motion-drafter): inject case excerpts into section draft prompt"
```

---

## Phase D — tRPC routers

### Task D1: New `motionDrafter` router

**Files:**
- Create: `src/server/trpc/routers/motion-drafter.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Implement router**

Create `src/server/trpc/routers/motion-drafter.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { caseStrategyRecommendations } from "@/server/db/schema/case-strategy-recommendations";
import { isStrategyEnabled } from "@/server/lib/feature-flags";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import {
  InsufficientCreditsError,
  suggestMotion,
} from "@/server/services/motion-drafter/orchestrator";

function assertEnabled(orgId: string | null | undefined) {
  if (!isStrategyEnabled(orgId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Motion drafter not enabled for this organization.",
    });
  }
}

export const motionDrafterRouter = router({
  suggest: protectedProcedure
    .input(z.object({ recommendationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      if (!ctx.user.orgId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Org required" });
      }

      const [rec] = await ctx.db
        .select({ caseId: caseStrategyRecommendations.caseId })
        .from(caseStrategyRecommendations)
        .where(eq(caseStrategyRecommendations.id, input.recommendationId))
        .limit(1);
      if (!rec) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
      }
      await assertCaseAccess(ctx, rec.caseId);

      try {
        const out = await suggestMotion({
          recommendationId: input.recommendationId,
          userId: ctx.user.id,
          orgId: ctx.user.orgId,
        });
        return out;
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "Insufficient credits." });
        }
        throw e;
      }
    }),
});
```

- [ ] **Step 2: Wire into `root.ts`**

Open `src/server/trpc/root.ts`. Add to imports (near existing `caseStrategy` imports):

```ts
import { motionDrafterRouter } from "./routers/motion-drafter";
```

Inside the `appRouter = router({ ... })` object, add next to `caseStrategy`:

```ts
motionDrafter: motionDrafterRouter,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | head -10`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/motion-drafter.ts src/server/trpc/root.ts
git commit -m "feat(motion-drafter): tRPC suggest endpoint"
```

---

### Task D2: Extend `motions.create` to persist `drafterContextJson`

**Files:**
- Modify: `src/server/trpc/routers/motions.ts`

- [ ] **Step 1: Add input field + persist**

Open `src/server/trpc/routers/motions.ts`. In the `create` procedure input schema, add an optional field:

```ts
drafterContextJson: z.object({
  chunks: z.array(z.object({
    documentId: z.string().uuid(),
    documentTitle: z.string(),
    chunkIndex: z.number().int(),
    content: z.string(),
    similarity: z.number(),
  })),
  citedEntities: z.array(z.object({
    kind: z.enum(["document", "deadline", "filing", "motion", "message"]),
    id: z.string().uuid(),
    excerpt: z.string().optional(),
  })),
  fromRecommendationId: z.string().uuid(),
  generatedAt: z.string(),
}).optional(),
```

In the `.values({ ... })` call inside the same `create` procedure, add to the inserted row:

```ts
drafterContextJson: input.drafterContextJson ?? null,
draftedFromRecommendationId: input.drafterContextJson?.fromRecommendationId ?? null,
```

- [ ] **Step 2: Pipe excerpts into `generateSection`**

Locate the existing `generateSection` procedure body. Where it builds the call to `draftMotionSection` (around line 195 in current code), modify the args:

```ts
const drafterCtx = motion.drafterContextJson as
  | { chunks?: Array<{ documentTitle: string; chunkIndex: number; content: string; similarity: number }> }
  | null;
const out = await draftMotionSection({
  motionType: tpl.motionType as "motion_to_dismiss" | "motion_for_summary_judgment" | "motion_to_compel",
  sectionKey: input.sectionKey,
  caseFacts: caseRow.description ?? "",
  attachedMemos,
  extraExcerpts: drafterCtx?.chunks ?? undefined,
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | head -10`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/motions.ts
git commit -m "feat(motion-drafter): persist drafter context on motions.create + pipe to generateSection"
```

---

## Phase E — UI

### Task E1: `MotionDrafterPreview` component

**Files:**
- Create: `src/components/cases/motions/motion-drafter-preview.tsx`

- [ ] **Step 1: Implement component**

Create `src/components/cases/motions/motion-drafter-preview.tsx`:

```tsx
"use client";
import { Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Chunk {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

interface Citation {
  kind: "document" | "deadline" | "filing" | "motion" | "message";
  id: string;
  excerpt?: string;
}

interface Props {
  isLoading: boolean;
  template: { id: string; slug: string; name: string } | null;
  confidence: number;
  suggestedTitle: string;
  citedEntities: Citation[];
  autoPulledChunks: Chunk[];
  onConfirm: () => void;
  onCustomize: () => void;
}

export function MotionDrafterPreview({
  isLoading,
  template,
  confidence,
  suggestedTitle,
  citedEntities,
  autoPulledChunks,
  onConfirm,
  onCustomize,
}: Props) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-900">
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber-400" />
            <h3 className="font-medium text-zinc-100">AI Suggestion</h3>
          </div>

          {template ? (
            <div>
              <p className="text-sm text-zinc-400">Suggested template</p>
              <p className="font-medium text-zinc-100">{template.name}</p>
              <p className="text-xs text-zinc-500">
                Confidence: {(confidence * 100).toFixed(0)}%
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-amber-900/40 bg-amber-950/20 p-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <p className="text-sm text-amber-200">
                AI couldn&apos;t confidently match a template. Pick one in the next step.
              </p>
            </div>
          )}

          <div>
            <p className="text-sm text-zinc-400">Suggested title</p>
            <p className="text-sm text-zinc-200">{suggestedTitle}</p>
          </div>

          <div>
            <p className="text-sm text-zinc-400">
              Auto-pulled excerpts ({autoPulledChunks.length})
            </p>
            <ul className="mt-1 space-y-1 text-xs text-zinc-400">
              {autoPulledChunks.slice(0, 5).map((c, i) => (
                <li key={`${c.documentId}-${c.chunkIndex}-${i}`} className="truncate">
                  <span className="text-zinc-500">[{c.documentTitle}]</span> {c.content.slice(0, 100)}…
                </li>
              ))}
              {autoPulledChunks.length === 0 && (
                <li className="text-zinc-500">(none — no embeddings yet for this case)</li>
              )}
            </ul>
          </div>

          <div>
            <p className="text-sm text-zinc-400">
              Cited entities ({citedEntities.length})
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {citedEntities.map((c) => (
                <span
                  key={`${c.kind}-${c.id}`}
                  className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                >
                  {c.kind}
                </span>
              ))}
              {citedEntities.length === 0 && (
                <span className="text-xs text-zinc-500">(none)</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={onConfirm}>Confirm &amp; continue</Button>
        <Button variant="outline" onClick={onCustomize}>
          Customize
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | head -10`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/motions/motion-drafter-preview.tsx
git commit -m "feat(motion-drafter): MotionDrafterPreview step-0 component"
```

---

### Task E2: Wire step 0 into `motion-wizard.tsx`

**Files:**
- Modify: `src/components/cases/motions/motion-wizard.tsx`

- [ ] **Step 1: Read current wizard**

Open `src/components/cases/motions/motion-wizard.tsx` and locate the `useState<1 | 2>(1)` line and the `useSearchParams`-style logic. Familiarise yourself with the existing two steps; the new "step 0" will be added before them and only render when the URL has `?fromRec=<id>`.

- [ ] **Step 2: Add step 0 logic**

Top of file imports (add):

```ts
import { useSearchParams, useRouter } from "next/navigation";
import { MotionDrafterPreview } from "./motion-drafter-preview";
```

Inside the `MotionWizard` component body, before the existing `useState`, add:

```ts
const searchParams = useSearchParams();
const fromRecId = searchParams.get("fromRec");
const router = useRouter();

const suggest = trpc.motionDrafter.suggest.useMutation();

const [step, setStep] = useState<0 | 1 | 2>(fromRecId ? 0 : 1);
```

Replace the existing `const [step, setStep] = useState<1 | 2>(1);` with the above (i.e. delete the old one). Update every reference to `setStep(1)` and `setStep(2)` to use the new union type — TypeScript will guide you.

After the existing `useState` declarations, trigger the suggestion:

```ts
const [drafterCtx, setDrafterCtx] = useState<typeof suggest.data | null>(null);

useEffect(() => {
  if (!fromRecId || drafterCtx) return;
  suggest.mutate(
    { recommendationId: fromRecId },
    {
      onSuccess: (data) => {
        setDrafterCtx(data);
        if (data.template) setTemplateId(data.template.id);
        setTitle(data.suggestedTitle);
      },
      onError: (e) => {
        toast.error(e.message);
        // Fall back to manual flow
        setStep(1);
      },
    },
  );
}, [fromRecId, drafterCtx, suggest, setTemplateId, setTitle]);
```

Add `useEffect` to the existing React import. Add `import { toast } from "sonner";` at the top if not already there.

- [ ] **Step 3: Render step 0**

Replace the existing `if (step === 1)` block with a step-0 block first, then the existing step 1, then step 2:

```tsx
if (step === 0) {
  return (
    <MotionDrafterPreview
      isLoading={suggest.isPending || !drafterCtx}
      template={drafterCtx?.template ?? null}
      confidence={drafterCtx?.confidence ?? 0}
      suggestedTitle={drafterCtx?.suggestedTitle ?? ""}
      citedEntities={drafterCtx?.citedEntities ?? []}
      autoPulledChunks={drafterCtx?.autoPulledChunks ?? []}
      onConfirm={() => setStep(2)}
      onCustomize={() => setStep(1)}
    />
  );
}
```

(Confirm jumps to step 2 because `templateId` and `title` are already set from `onSuccess`. Customize falls back to step 1 — template picker — for a manual override.)

- [ ] **Step 4: Pipe `drafterContextJson` into `motions.create`**

Locate the existing `create.mutate({...})` call. Augment its argument:

```ts
create.mutate({
  caseId,
  templateId: templateId!,
  title,
  memoIds: effectiveSelectedMemos,
  collectionIds: selectedCollections,
  splitMemo,
  drafterContextJson: drafterCtx
    ? {
        chunks: drafterCtx.autoPulledChunks,
        citedEntities: drafterCtx.citedEntities,
        fromRecommendationId: fromRecId!,
        generatedAt: new Date().toISOString(),
      }
    : undefined,
});
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | head -10`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/cases/motions/motion-wizard.tsx
git commit -m "feat(motion-drafter): wizard step 0 + drafterContextJson on create"
```

---

### Task E3: "Draft this motion" button on `RecommendationCard`

**Files:**
- Modify: `src/components/cases/strategy/recommendation-card.tsx`

- [ ] **Step 1: Add button**

Open `src/components/cases/strategy/recommendation-card.tsx`. Add to imports:

```ts
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
```

Inside `RecommendationCard`, add `category` to the `rec` prop type:

```ts
rec: {
  id: string;
  category: "procedural" | "discovery" | "substantive" | "client";
  priority: number;
  title: string;
  rationale: string;
  citations: Citation[];
};
```

Inside the component body:

```ts
const router = useRouter();
```

Inside `<CardContent>`, after the citations row and before the closing `</CardContent>`, add:

```tsx
{rec.category !== "client" && (
  <div className="flex justify-end pt-1">
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        router.push(`/cases/${caseId}/motions/new?fromRec=${rec.id}`)
      }
    >
      <FileText className="mr-1.5 size-3" /> Draft this motion
    </Button>
  </div>
)}
```

(No client-side credit pre-check — the wizard's `suggest.mutate` call handles credit errors via `onError → toast`.)

- [ ] **Step 2: Pass `category` from parent**

Open `src/components/cases/strategy/recommendations-panel.tsx`. In the `RecommendationCard` invocation, ensure `category` is included in the spread `rec={{ ... }}`. Add it next to `id`/`priority`/`title`/`rationale`/`citations`:

```tsx
rec={{
  id: r.id,
  category: r.category as "procedural" | "discovery" | "substantive" | "client",
  priority: r.priority,
  title: r.title,
  rationale: r.rationale,
  citations: (r.citations ?? []) as Array<{
    kind: "document" | "deadline" | "filing" | "motion" | "message";
    id: string;
    excerpt?: string;
  }>,
}}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | head -10`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/strategy/recommendation-card.tsx \
        src/components/cases/strategy/recommendations-panel.tsx
git commit -m "feat(motion-drafter): Draft this motion button on RecommendationCard"
```

---

## Phase F — E2E + final checks

### Task F1: Playwright smoke

**Files:**
- Create: `e2e/motion-drafter-smoke.spec.ts`

- [ ] **Step 1: Write spec**

Create `e2e/motion-drafter-smoke.spec.ts`:

```ts
// Phase 4.3 smoke: routes touched by Motion Drafter must not 500.
// Auth + actual classifier flow are out of scope here — manual UAT covers them.
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("4.3 motion drafter smoke", () => {
  test("strategy tab still loads (Draft button is in bundle)", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=strategy`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("motion wizard with ?fromRec= param does not 500", async ({ page, baseURL }) => {
    const resp = await page.goto(
      `${baseURL}/cases/${FAKE_UUID}/motions/new?fromRec=${FAKE_UUID}`,
    );
    expect(resp?.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/motion-drafter-smoke.spec.ts
git commit -m "test(motion-drafter): Playwright smoke for strategy + wizard routes"
```

---

### Task F2: Full test + typecheck pass

- [ ] **Step 1: Run full unit suite**

Run: `npx vitest run`
Expected: all tests pass; count is the previous 1215 + ~14 new from this plan (4 classify + 3 sources + 5 orchestrator + 2 prompt = 14).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: only the pre-existing `stripe.ts` API-version error.

- [ ] **Step 3: If anything red, halt and resolve before opening PR.**

---

### Task F3: Push + open PR

- [ ] **Step 1: Push**

```bash
git push -u origin feat/motion-drafter
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(4.3): AI Motion Drafter — Strategy → Motion bridge" --body "$(cat <<'EOF'
## Summary

Strategy → Motion bridge: lawyer clicks "Draft this motion" on a 4.2 recommendation card, sees an AI-suggested template + RAG-pulled case excerpts, confirms or customises, and lands in the existing 2.4.2 motion editor with auto-pulled context pre-loaded.

- Spec: docs/superpowers/specs/2026-05-01-ai-motion-drafter-design.md
- Plan: docs/superpowers/plans/2026-05-01-ai-motion-drafter.md

## Phases

- **A** — schema (2 cols on case_strategy_recommendations + 2 cols on case_motions, migration 0056)
- **B** — services: classifier (Claude), sources (RAG + cited entities), orchestrator (cache/credit/refund)
- **C** — `draftMotionSection` injects top-3 excerpts when drafter context is present
- **D** — tRPC: new `motionDrafter.suggest` + `motions.create` accepts `drafterContextJson`
- **E** — UI: wizard step 0 (`MotionDrafterPreview`), Draft button on recommendation card
- **F** — Playwright smoke + full suite green

## Decisions

| # | Choice |
|---|---|
| Entry mode | Strategy → Motion bridge |
| Auto-pick UX | Hybrid preview |
| Template classifier | Claude |
| RAG scope | Augment (memos + collections + auto-pulled docs) |
| Preview UX | Pre-filled wizard step 0 |
| Confidence threshold | 0.7 gate |
| Credit cost | 5 credits per suggest (cached on retry); section drafts remain free |

## Test plan

- [ ] Apply migration 0056 in prod via `pnpm tsx scripts/apply-migrations-batch.ts 0056 0056`
- [ ] Open /cases/<id>?tab=strategy as user in beta org
- [ ] Click "Draft this motion" on a procedural rec → wizard step 0 renders with suggested template + sources
- [ ] Confirm → motion is created with `drafterContextJson` populated → `generateSection` injects excerpts (verify by section text containing case-doc references)
- [ ] Click on a recommendation with no clear template match → wizard opens at step 1 with banner
- [ ] Click on the same rec twice → second call is cache-hit (free, no credit charge in DB)
- [ ] Click on `client`-category rec → button is hidden
- [ ] Verify credit refund path: simulate Anthropic timeout → user is refunded

## Tests

- ~14 new vitest cases (4 classify + 3 sources + 5 orchestrator + 2 prompt)
- 2 new Playwright smoke tests
EOF
)"
```

- [ ] **Step 3: Capture PR URL** for the next session.

---

## Summary

| Phase | Tasks | New files | Modified files |
|---|---|---|---|
| A | 2 | 1 | 2 |
| B | 3 | 4 | 0 |
| C | 1 | 1 (test) | 1 |
| D | 2 | 1 | 2 |
| E | 3 | 1 | 3 |
| F | 3 | 1 | 0 |

**Total:** 14 tasks across 6 phases. New tests: ~14 unit + 2 e2e smoke. New migration: `0056`. Net new files: 9. Modified files: 8.

## Out of scope (deferred)

- Streaming preview
- Re-classify on rec edit
- Per-section auto-citation chips inside generated motion text
- Multi-rec batch drafting
- Custom template authoring UI
- Auto-attach generated motion to a filing package
