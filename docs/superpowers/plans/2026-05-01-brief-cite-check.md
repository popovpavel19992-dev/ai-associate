# 4.4 Brief Cite-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Cite-check" button on `MotionDetail` that extracts every citation from a motion's sections, resolves treatment via cached opinions/statutes (or async-fetches uncached cites from CourtListener), and renders a per-cite severity badge inline.

**Architecture:** New `cite-check/` service module (extract → normalize → resolve → treatment → orchestrator). New tRPC router `motionCiteCheck` (run mutation + get query). New Inngest function `cite-check/resolve.requested` for async CourtListener fetch + treatment. New table `cite_treatments` with 7-day TTL. New column `case_motions.last_cite_check_json`. UI panel polls the get query while async resolutions are pending.

**Tech Stack:** TypeScript / Next.js 16 / Drizzle / postgres / Anthropic SDK / Inngest / tRPC v11 / vitest / Playwright. Reuses existing `CourtListenerClient` (`@/server/services/courtlistener/client`) for async fetches.

**Active deviations from spec:** none.

---

## Phase A — Schema + migration

### Task A1: Create branch + Drizzle schema deltas

**Files:**
- Create: `src/server/db/schema/cite-treatments.ts`
- Modify: `src/server/db/schema/case-motions.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git pull --rebase origin main
git checkout -b feat/brief-cite-check
```

- [ ] **Step 2: Add `cite_treatments` schema**

Create `src/server/db/schema/cite-treatments.ts`:

```ts
import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const citeTreatments = pgTable(
  "cite_treatments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    citeKey: text("cite_key").notNull(),
    citeType: text("cite_type").notNull(),
    status: text("status").notNull(),
    summary: text("summary"),
    signals: jsonb("signals"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("cite_treatments_key_idx").on(t.citeKey),
    index("cite_treatments_expires_idx").on(t.expiresAt),
    check("cite_treatments_type_check", sql`${t.citeType} IN ('opinion','statute')`),
    check(
      "cite_treatments_status_check",
      sql`${t.status} IN ('good_law','caution','overruled','unverified','not_found','malformed')`,
    ),
  ],
);

export type CiteTreatment = typeof citeTreatments.$inferSelect;
export type NewCiteTreatment = typeof citeTreatments.$inferInsert;
```

- [ ] **Step 3: Add column to `case_motions`**

Open `src/server/db/schema/case-motions.ts`. Inside the table definition, add the new column next to existing `triggerEventId`:

```ts
lastCiteCheckJson: jsonb("last_cite_check_json"),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/cite-treatments.ts \
        src/server/db/schema/case-motions.ts
git commit -m "feat(cite-check): schema deltas for treatment cache + per-motion result"
```

---

### Task A2: Migration 0057 + apply to Supabase

**Files:**
- Create: `src/server/db/migrations/0057_cite_check.sql`

- [ ] **Step 1: Write migration**

Create `src/server/db/migrations/0057_cite_check.sql`:

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

- [ ] **Step 2: Apply via existing batch script**

Run: `pnpm tsx -r dotenv/config scripts/apply-migrations-batch.ts 0057 0057`
Expected: ends with `All 1 migrations applied.`

- [ ] **Step 3: Commit**

```bash
git add src/server/db/migrations/0057_cite_check.sql
git commit -m "feat(cite-check): migration 0057 — cite_treatments table + lastCiteCheckJson col"
```

---

## Phase B — Backend services (TDD)

### Task B1: Shared types

**Files:**
- Create: `src/server/services/cite-check/types.ts`

- [ ] **Step 1: Write types**

Create `src/server/services/cite-check/types.ts`:

```ts
export type CiteType = "opinion" | "statute";

export type CiteStatus =
  | "good_law"
  | "caution"
  | "overruled"
  | "unverified"
  | "not_found"
  | "pending"
  | "malformed";

export interface ExtractedCitation {
  raw: string;
  type: CiteType;
}

export interface CiteCheckCitation {
  raw: string;
  citeKey: string;
  type: CiteType;
  status: CiteStatus;
  summary: string | null;
  signals: {
    citedByCount?: number;
    treatmentNotes?: string[];
    cachedOpinionId?: string;
  } | null;
  location: {
    sectionKey: "facts" | "argument" | "conclusion";
    offset: number;
  };
}

export interface CiteCheckResult {
  runAt: string;
  totalCites: number;
  pendingCites: number;
  citations: CiteCheckCitation[];
  creditsCharged: number;
}

export interface TreatmentDecision {
  status: Exclude<CiteStatus, "pending">;
  summary: string | null;
  signals: CiteCheckCitation["signals"];
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/cite-check/types.ts
git commit -m "feat(cite-check): shared types"
```

---

### Task B2: `extract.ts` — Claude citation extractor (TDD)

**Files:**
- Create: `src/server/services/cite-check/extract.ts`
- Test: `tests/unit/cite-check-extract.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/cite-check-extract.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { extractCitations } from "@/server/services/cite-check/extract";

beforeEach(() => messagesCreateMock.mockReset());

describe("extractCitations", () => {
  it("returns parsed citations on happy path", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        citations: [
          { raw: "Bell Atlantic Corp. v. Twombly, 550 U.S. 544 (2007)", type: "opinion" },
          { raw: "28 U.S.C. § 1331", type: "statute" },
        ],
      }) }],
    });
    const out = await extractCitations("Some legal text citing Twombly and §1331.");
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("opinion");
    expect(out[1].type).toBe("statute");
  });

  it("empty text → empty array, no Claude call", async () => {
    const out = await extractCitations("");
    expect(out).toEqual([]);
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });

  it("Claude returns malformed JSON → throws parse error", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "not json" }],
    });
    await expect(extractCitations("text")).rejects.toThrow(/parse/i);
  });

  it("strips ```json fences before parsing", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "```json\n{\"citations\":[{\"raw\":\"x\",\"type\":\"opinion\"}]}\n```" }],
    });
    const out = await extractCitations("text");
    expect(out).toHaveLength(1);
  });

  it("filters out cites with invalid type", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        citations: [
          { raw: "X", type: "opinion" },
          { raw: "Y", type: "regulation" },
          { raw: "Z" },
        ],
      }) }],
    });
    const out = await extractCitations("text");
    expect(out).toHaveLength(1);
    expect(out[0].raw).toBe("X");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/cite-check-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `extract.ts`**

Create `src/server/services/cite-check/extract.ts`:

```ts
import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { ExtractedCitation, CiteType } from "./types";

const SYSTEM = `You are a legal citation extractor. Find every legal citation in the user's text. Return strict JSON: {"citations": [{"raw": "<exact text as written>", "type": "opinion"|"statute"}]}. Include case citations (e.g. "550 U.S. 544"), USC sections (e.g. "28 U.S.C. § 1331"), and CFR sections — all classified as "opinion" for cases or "statute" for USC/CFR. Skip secondary sources, treatises, and bare statute references like "FRCP 12(b)(6)" without a section number. Never invent citations. If no citations found, return {"citations": []}.`;

const VALID_TYPES = new Set<CiteType>(["opinion", "statute"]);

export async function extractCitations(text: string): Promise<ExtractedCitation[]> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];

  const env = getEnv();
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: trimmed.slice(0, 60000) }],
  });

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const raw = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: { citations?: Array<{ raw: unknown; type: unknown }> };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse citation extractor JSON: ${e instanceof Error ? e.message : e}`);
  }

  const out: ExtractedCitation[] = [];
  for (const c of parsed.citations ?? []) {
    const type = c.type as string;
    const rawCite = c.raw as string;
    if (!rawCite || typeof rawCite !== "string") continue;
    if (!VALID_TYPES.has(type as CiteType)) continue;
    out.push({ raw: rawCite, type: type as CiteType });
  }
  return out;
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run tests/unit/cite-check-extract.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/cite-check/extract.ts tests/unit/cite-check-extract.test.ts
git commit -m "feat(cite-check): Claude-based citation extractor"
```

---

### Task B3: `normalize.ts` — pure citeKey generator (TDD)

**Files:**
- Create: `src/server/services/cite-check/normalize.ts`
- Test: `tests/unit/cite-check-normalize.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/cite-check-normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { citeKey } from "@/server/services/cite-check/normalize";

describe("citeKey", () => {
  it("generates stable key for SCOTUS opinion", () => {
    expect(citeKey("Bell Atlantic Corp. v. Twombly, 550 U.S. 544 (2007)", "opinion"))
      .toBe("550_us_544_2007");
  });

  it("generates key for circuit opinion", () => {
    expect(citeKey("Smith v. Jones, 123 F.3d 456 (2d Cir. 1999)", "opinion"))
      .toBe("123_f3d_456_1999");
  });

  it("generates key for USC", () => {
    expect(citeKey("28 U.S.C. § 1331", "statute")).toBe("28_usc_1331");
  });

  it("generates key for CFR with subpart", () => {
    expect(citeKey("29 C.F.R. § 1604.11(a)", "statute")).toBe("29_cfr_1604_11_a");
  });

  it("is case-insensitive on reporter", () => {
    expect(citeKey("550 u.s. 544 (2007)", "opinion")).toBe("550_us_544_2007");
  });

  it("returns 'malformed' marker when no key extractable", () => {
    expect(citeKey("see id.", "opinion")).toBe("malformed");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/cite-check-normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `normalize.ts`**

Create `src/server/services/cite-check/normalize.ts`:

```ts
import type { CiteType } from "./types";

const REPORTER_RX =
  /(\d+)\s+(U\.?S\.?|S\.?\s*Ct\.?|L\.?\s*Ed\.?\s*2d|F\.?\s*\d?d?|F\.?\s*Supp\.?\s*\d?d?|F\.?\s*App'?x|N\.?E\.?\s*\d?d?|P\.?\s*\d?d?|S\.?W\.?\s*\d?d?|N\.?W\.?\s*\d?d?|A\.?\s*\d?d?|S\.?E\.?\s*\d?d?|So\.?\s*\d?d?|Cal\.?\s*\d?d?|N\.?Y\.?\s*\d?d?)\s+(\d+)(?:[^()]*\((?:[^)]*?)\s*(\d{4})\))?/i;

const USC_RX = /(\d+)\s+U\.?\s*S\.?\s*C\.?\s+§§?\s*(\d+(?:[a-z])?(?:\.\d+)?(?:\([a-z0-9]+\))*)/i;
const CFR_RX = /(\d+)\s+C\.?\s*F\.?\s*R\.?\s+§§?\s*(\d+\.\d+(?:[a-z])?(?:\([a-z0-9]+\))*)/i;

function compactReporter(s: string): string {
  return s.toLowerCase().replace(/[\s.']/g, "");
}

function compactSection(s: string): string {
  return s.toLowerCase().replace(/[\s.()'§]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

export function citeKey(raw: string, type: CiteType): string {
  if (type === "statute") {
    let m = raw.match(USC_RX);
    if (m) return `${m[1]}_usc_${compactSection(m[2])}`;
    m = raw.match(CFR_RX);
    if (m) return `${m[1]}_cfr_${compactSection(m[2])}`;
    return "malformed";
  }
  const m = raw.match(REPORTER_RX);
  if (!m) return "malformed";
  const vol = m[1];
  const reporter = compactReporter(m[2]);
  const page = m[3];
  const year = m[4] ?? "";
  return year ? `${vol}_${reporter}_${page}_${year}` : `${vol}_${reporter}_${page}`;
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run tests/unit/cite-check-normalize.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/cite-check/normalize.ts tests/unit/cite-check-normalize.test.ts
git commit -m "feat(cite-check): pure citation-key normalizer"
```

---

### Task B4: `treatment.ts` — Claude treatment classifier (TDD)

**Files:**
- Create: `src/server/services/cite-check/treatment.ts`
- Test: `tests/unit/cite-check-treatment.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/cite-check-treatment.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { decideTreatment } from "@/server/services/cite-check/treatment";

beforeEach(() => messagesCreateMock.mockReset());

describe("decideTreatment", () => {
  it("returns parsed status + summary on happy path", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ status: "good_law", summary: "Still controlling.", signals: { citedByCount: 1283 } }) }],
    });
    const out = await decideTreatment({
      raw: "Twombly, 550 U.S. 544",
      type: "opinion",
      fullText: "long text...",
      citedByCount: 1283,
    });
    expect(out.status).toBe("good_law");
    expect(out.summary).toContain("controlling");
    expect(out.signals?.citedByCount).toBe(1283);
  });

  it("falls back to unverified on JSON parse error", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "garbage" }],
    });
    const out = await decideTreatment({ raw: "X", type: "opinion", fullText: "" });
    expect(out.status).toBe("unverified");
    expect(out.summary).toContain("Treatment unavailable");
  });

  it("clamps invalid status to unverified", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ status: "questionable", summary: "x" }) }],
    });
    const out = await decideTreatment({ raw: "X", type: "opinion", fullText: "" });
    expect(out.status).toBe("unverified");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/cite-check-treatment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `treatment.ts`**

Create `src/server/services/cite-check/treatment.ts`:

```ts
import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { CiteStatus, CiteType, TreatmentDecision } from "./types";

const SYSTEM = `You are a legal-treatment analyst. Given a cited opinion or statute and supporting context, decide whether it is still good law. Output strict JSON: {"status": "good_law"|"caution"|"overruled"|"unverified", "summary": "<one-sentence rationale>", "signals": {"citedByCount": <number?>, "treatmentNotes": ["<short signal>"]}}.

Definitions:
- good_law: positive or neutral; no overruling/abrogation signals
- caution: distinguished, criticized, narrowed, or contradicted by another circuit
- overruled: clearly overruled, abrogated, or vacated
- unverified: insufficient evidence to decide

Be conservative — prefer "caution" over "overruled" unless explicit overruling language is present.`;

const VALID: Set<CiteStatus> = new Set(["good_law", "caution", "overruled", "unverified"]);

export interface TreatmentInput {
  raw: string;
  type: CiteType;
  fullText: string;
  citedByCount?: number;
  citingExcerpts?: string[];
}

export async function decideTreatment(input: TreatmentInput): Promise<TreatmentDecision> {
  const env = getEnv();
  const anthropic = getAnthropic();

  const userContent = [
    `# Citation`,
    input.raw,
    `Type: ${input.type}`,
    input.citedByCount !== undefined ? `Cited by ${input.citedByCount} other opinions.` : "",
    ``,
    `# Cited opinion / statute text (truncated)`,
    (input.fullText ?? "").slice(0, 8000) || "(no text available)",
    ``,
    input.citingExcerpts && input.citingExcerpts.length > 0
      ? [`# Recent excerpts from opinions citing TO this one`, ...input.citingExcerpts.slice(0, 5)].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let response;
  try {
    response = await anthropic.messages.create({
      model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });
  } catch {
    return { status: "unverified", summary: "Treatment unavailable (Claude error).", signals: { citedByCount: input.citedByCount } };
  }

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: { status?: string; summary?: string; signals?: { citedByCount?: number; treatmentNotes?: string[] } };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "unverified", summary: "Treatment unavailable (parse error).", signals: { citedByCount: input.citedByCount } };
  }

  const status: CiteStatus = VALID.has(parsed.status as CiteStatus) ? (parsed.status as CiteStatus) : "unverified";
  return {
    status: status as TreatmentDecision["status"],
    summary: parsed.summary ?? null,
    signals: {
      citedByCount: parsed.signals?.citedByCount ?? input.citedByCount,
      treatmentNotes: parsed.signals?.treatmentNotes,
    },
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run tests/unit/cite-check-treatment.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/cite-check/treatment.ts tests/unit/cite-check-treatment.test.ts
git commit -m "feat(cite-check): Claude treatment classifier with graceful fallback"
```

---

### Task B5: `resolve.ts` — cache lookup chain (TDD)

**Files:**
- Create: `src/server/services/cite-check/resolve.ts`
- Test: `tests/unit/cite-check-resolve.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/cite-check-resolve.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  treatmentMock: vi.fn(),
  inngestSendMock: vi.fn(),
  treatmentSelectMock: vi.fn(),
  opinionSelectMock: vi.fn(),
  statuteSelectMock: vi.fn(),
  treatmentInsertMock: vi.fn(),
}));

vi.mock("@/server/services/cite-check/treatment", () => ({
  decideTreatment: mocks.treatmentMock,
}));
vi.mock("@/server/inngest/client", () => ({
  inngest: { send: mocks.inngestSendMock },
}));

vi.mock("@/server/db/schema/cite-treatments", () => ({
  citeTreatments: { _table: "treatments", citeKey: { _col: "cite_key" } },
}));
vi.mock("@/server/db/schema/cached-opinions", () => ({
  cachedOpinions: { _table: "opinions", citationBluebook: { _col: "citation" } },
}));
vi.mock("@/server/db/schema/cached-statutes", () => ({
  cachedStatutes: { _table: "statutes", citation: { _col: "citation" } },
}));

vi.mock("@/server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((tbl: { _table?: string }) => {
        const which = tbl?._table;
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve(
                which === "treatments"
                  ? mocks.treatmentSelectMock()
                  : which === "opinions"
                  ? mocks.opinionSelectMock()
                  : mocks.statuteSelectMock(),
              ),
            ),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => mocks.treatmentInsertMock()),
      })),
    })),
  },
}));

beforeEach(() => Object.values(mocks).forEach((m) => m.mockReset()));

describe("resolveCite", () => {
  it("treatment cache hit → returns cached, no charge, no inngest", async () => {
    mocks.treatmentSelectMock.mockResolvedValue([
      { citeKey: "550_us_544_2007", citeType: "opinion", status: "good_law", summary: "x", signals: { citedByCount: 1283 } },
    ]);
    const { resolveCite } = await import("@/server/services/cite-check/resolve");
    const out = await resolveCite({ raw: "Twombly, 550 U.S. 544 (2007)", type: "opinion", citeKey: "550_us_544_2007", motionId: "m1" });
    expect(out.status).toBe("good_law");
    expect(out.charged).toBe(false);
    expect(mocks.inngestSendMock).not.toHaveBeenCalled();
    expect(mocks.treatmentMock).not.toHaveBeenCalled();
  });

  it("cached opinion hit → runs treatment + persists + charges", async () => {
    mocks.treatmentSelectMock.mockResolvedValue([]);
    mocks.opinionSelectMock.mockResolvedValue([{ id: "o1", fullText: "long text", metadata: { citedByCount: 100 } }]);
    mocks.treatmentMock.mockResolvedValue({ status: "good_law", summary: "ok", signals: { citedByCount: 100 } });
    mocks.treatmentInsertMock.mockResolvedValue([{}]);

    const { resolveCite } = await import("@/server/services/cite-check/resolve");
    const out = await resolveCite({ raw: "x", type: "opinion", citeKey: "k1", motionId: "m1" });
    expect(out.status).toBe("good_law");
    expect(out.charged).toBe(true);
    expect(mocks.treatmentMock).toHaveBeenCalledOnce();
  });

  it("both cache miss → emits Inngest event, returns pending", async () => {
    mocks.treatmentSelectMock.mockResolvedValue([]);
    mocks.opinionSelectMock.mockResolvedValue([]);
    mocks.statuteSelectMock.mockResolvedValue([]);

    const { resolveCite } = await import("@/server/services/cite-check/resolve");
    const out = await resolveCite({ raw: "Smith v. Jones, 999 F.4d 1", type: "opinion", citeKey: "999_f4d_1", motionId: "m1" });
    expect(out.status).toBe("pending");
    expect(out.charged).toBe(false);
    expect(mocks.inngestSendMock).toHaveBeenCalledOnce();
  });

  it("malformed citeKey skips DB lookups → returns malformed", async () => {
    const { resolveCite } = await import("@/server/services/cite-check/resolve");
    const out = await resolveCite({ raw: "id.", type: "opinion", citeKey: "malformed", motionId: "m1" });
    expect(out.status).toBe("malformed");
    expect(out.charged).toBe(false);
    expect(mocks.inngestSendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/cite-check-resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resolve.ts`**

Create `src/server/services/cite-check/resolve.ts`:

```ts
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { citeTreatments } from "@/server/db/schema/cite-treatments";
import { cachedOpinions } from "@/server/db/schema/cached-opinions";
import { cachedStatutes } from "@/server/db/schema/cached-statutes";
import { inngest } from "@/server/inngest/client";
import { decideTreatment } from "./treatment";
import type { CiteStatus, CiteType, TreatmentDecision } from "./types";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResolveArgs {
  raw: string;
  type: CiteType;
  citeKey: string;
  motionId: string;
}

export interface ResolveResult {
  status: CiteStatus;
  summary: string | null;
  signals: TreatmentDecision["signals"];
  charged: boolean;
}

export async function resolveCite(args: ResolveArgs): Promise<ResolveResult> {
  if (args.citeKey === "malformed") {
    return { status: "malformed", summary: null, signals: null, charged: false };
  }

  const [cached] = await db
    .select()
    .from(citeTreatments)
    .where(and(eq(citeTreatments.citeKey, args.citeKey), gt(citeTreatments.expiresAt, sql`now()`)))
    .limit(1);
  if (cached) {
    return {
      status: cached.status as CiteStatus,
      summary: cached.summary,
      signals: cached.signals as TreatmentDecision["signals"],
      charged: false,
    };
  }

  if (args.type === "opinion") {
    const [op] = await db
      .select()
      .from(cachedOpinions)
      .where(eq(cachedOpinions.citationBluebook, args.raw))
      .limit(1);
    if (op) {
      const decision = await decideTreatment({
        raw: args.raw,
        type: "opinion",
        fullText: op.fullText ?? op.snippet ?? "",
        citedByCount: (op.metadata as { citedByCount?: number })?.citedByCount,
      });
      await persistTreatment(args.citeKey, "opinion", decision);
      return { ...decision, charged: true };
    }
  } else {
    const [st] = await db
      .select()
      .from(cachedStatutes)
      .where(eq(cachedStatutes.citation, args.raw))
      .limit(1);
    if (st) {
      const decision = await decideTreatment({
        raw: args.raw,
        type: "statute",
        fullText: st.fullText ?? st.snippet ?? "",
      });
      await persistTreatment(args.citeKey, "statute", decision);
      return { ...decision, charged: true };
    }
  }

  await inngest.send({
    name: "cite-check/resolve.requested",
    data: { citeKey: args.citeKey, raw: args.raw, type: args.type, motionId: args.motionId },
  });
  return { status: "pending", summary: null, signals: null, charged: false };
}

async function persistTreatment(citeKey: string, citeType: CiteType, decision: TreatmentDecision) {
  await db
    .insert(citeTreatments)
    .values({
      citeKey,
      citeType,
      status: decision.status,
      summary: decision.summary ?? null,
      signals: decision.signals ?? null,
      expiresAt: new Date(Date.now() + TTL_MS),
    })
    .onConflictDoUpdate({
      target: citeTreatments.citeKey,
      set: {
        status: decision.status,
        summary: decision.summary ?? null,
        signals: decision.signals ?? null,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run tests/unit/cite-check-resolve.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/cite-check/resolve.ts tests/unit/cite-check-resolve.test.ts
git commit -m "feat(cite-check): resolve cite via treatment cache → cached opinion → async fetch"
```

---

### Task B6: `orchestrator.ts` — full flow + dedup + budget exhaustion (TDD)

**Files:**
- Create: `src/server/services/cite-check/orchestrator.ts`
- Test: `tests/unit/cite-check-orchestrator.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/cite-check-orchestrator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  extractMock: vi.fn(),
  resolveMock: vi.fn(),
  decrementMock: vi.fn(),
  refundMock: vi.fn(),
  motionSelectMock: vi.fn(),
  motionUpdateMock: vi.fn(),
}));

vi.mock("@/server/services/cite-check/extract", () => ({ extractCitations: mocks.extractMock }));
vi.mock("@/server/services/cite-check/resolve", () => ({ resolveCite: mocks.resolveMock }));
vi.mock("@/server/services/cite-check/normalize", () => ({
  citeKey: (raw: string) => `key_${raw.length}`,
}));
vi.mock("@/server/services/credits", () => ({
  decrementCredits: mocks.decrementMock,
  refundCredits: mocks.refundMock,
}));
vi.mock("@/server/db/schema/case-motions", () => ({
  caseMotions: { _table: "motions", id: { _col: "id" } },
}));
vi.mock("@/server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(mocks.motionSelectMock())) })),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => mocks.motionUpdateMock()) })) })),
  },
}));

beforeEach(() => Object.values(mocks).forEach((m) => m.mockReset()));

describe("runCiteCheck", () => {
  it("happy path: extract + resolve mix, persists json, charges per cite", async () => {
    mocks.motionSelectMock.mockResolvedValue([
      { id: "m1", caseId: "c1", sections: { facts: { text: "facts text" }, argument: { text: "arg text" }, conclusion: { text: "" } }, lastCiteCheckJson: null, updatedAt: new Date() },
    ]);
    mocks.extractMock.mockResolvedValue([
      { raw: "Cite A", type: "opinion" },
      { raw: "Cite B", type: "opinion" },
    ]);
    mocks.resolveMock
      .mockResolvedValueOnce({ status: "good_law", summary: "ok", signals: null, charged: false })
      .mockResolvedValueOnce({ status: "caution", summary: "narrow", signals: null, charged: true });
    mocks.decrementMock.mockResolvedValue(true);
    mocks.motionUpdateMock.mockResolvedValue([{}]);

    const { runCiteCheck } = await import("@/server/services/cite-check/orchestrator");
    const out = await runCiteCheck({ motionId: "m1", userId: "u1" });

    expect(out.totalCites).toBe(2);
    expect(out.pendingCites).toBe(0);
    expect(out.creditsCharged).toBe(2);
    expect(mocks.decrementMock).toHaveBeenCalledTimes(2);
  });

  it("dedup: existing pending run < 60s old → returns existing", async () => {
    const recentRun = {
      runAt: new Date(Date.now() - 30_000).toISOString(),
      totalCites: 5,
      pendingCites: 2,
      citations: [],
      creditsCharged: 3,
    };
    mocks.motionSelectMock.mockResolvedValue([
      { id: "m1", caseId: "c1", sections: { facts: { text: "x" } }, lastCiteCheckJson: recentRun, updatedAt: new Date() },
    ]);
    const { runCiteCheck } = await import("@/server/services/cite-check/orchestrator");
    const out = await runCiteCheck({ motionId: "m1", userId: "u1" });
    expect(out.runAt).toBe(recentRun.runAt);
    expect(mocks.extractMock).not.toHaveBeenCalled();
  });

  it("budget exhaustion: stops charging, marks remaining unverified", async () => {
    mocks.motionSelectMock.mockResolvedValue([
      { id: "m1", caseId: "c1", sections: { facts: { text: "x" } }, lastCiteCheckJson: null, updatedAt: new Date() },
    ]);
    mocks.extractMock.mockResolvedValue([
      { raw: "A", type: "opinion" },
      { raw: "B", type: "opinion" },
      { raw: "C", type: "opinion" },
    ]);
    mocks.resolveMock
      .mockResolvedValueOnce({ status: "good_law", summary: "ok", signals: null, charged: true });
    mocks.decrementMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.motionUpdateMock.mockResolvedValue([{}]);

    const { runCiteCheck } = await import("@/server/services/cite-check/orchestrator");
    const out = await runCiteCheck({ motionId: "m1", userId: "u1" });

    expect(out.totalCites).toBe(3);
    expect(out.creditsCharged).toBe(1);
    expect(out.citations[1].status).toBe("unverified");
    expect(out.citations[1].summary).toContain("Credit budget exhausted");
    expect(out.citations[2].status).toBe("unverified");
    expect(mocks.resolveMock).toHaveBeenCalledOnce();
  });

  it("extract empty → persists totalCites:0", async () => {
    mocks.motionSelectMock.mockResolvedValue([
      { id: "m1", caseId: "c1", sections: { facts: { text: "x" } }, lastCiteCheckJson: null, updatedAt: new Date() },
    ]);
    mocks.extractMock.mockResolvedValue([]);
    mocks.decrementMock.mockResolvedValue(true);
    mocks.motionUpdateMock.mockResolvedValue([{}]);

    const { runCiteCheck } = await import("@/server/services/cite-check/orchestrator");
    const out = await runCiteCheck({ motionId: "m1", userId: "u1" });
    expect(out.totalCites).toBe(0);
    expect(out.creditsCharged).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run tests/unit/cite-check-orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `orchestrator.ts`**

Create `src/server/services/cite-check/orchestrator.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseMotions } from "@/server/db/schema/case-motions";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { extractCitations } from "./extract";
import { citeKey } from "./normalize";
import { resolveCite } from "./resolve";
import type { CiteCheckCitation, CiteCheckResult } from "./types";

const EXTRACT_COST = 1;
const PER_CITE_COST = 1;
const DEDUP_WINDOW_MS = 60_000;

export interface RunArgs {
  motionId: string;
  userId: string;
}

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits for cite-check");
    this.name = "InsufficientCreditsError";
  }
}

export async function runCiteCheck(args: RunArgs): Promise<CiteCheckResult> {
  const [motion] = await db
    .select()
    .from(caseMotions)
    .where(eq(caseMotions.id, args.motionId))
    .limit(1);
  if (!motion) throw new Error(`Motion ${args.motionId} not found`);

  // Dedup: if existing run is recent and still pending, return it instead of starting new.
  const prior = motion.lastCiteCheckJson as CiteCheckResult | null;
  if (prior && prior.pendingCites > 0) {
    const ageMs = Date.now() - new Date(prior.runAt).getTime();
    if (ageMs < DEDUP_WINDOW_MS) return prior;
  }

  // Charge extract upfront.
  const ok = await decrementCredits(args.userId, EXTRACT_COST);
  if (!ok) throw new InsufficientCreditsError();

  let extracted: Awaited<ReturnType<typeof extractCitations>> = [];
  try {
    const sections = motion.sections as Record<string, { text?: string } | undefined>;
    const combined = [
      sections.facts?.text ?? "",
      sections.argument?.text ?? "",
      sections.conclusion?.text ?? "",
    ].join("\n\n");
    extracted = await extractCitations(combined);
  } catch (e) {
    await refundCredits(args.userId, EXTRACT_COST);
    throw e;
  }

  const citations: CiteCheckCitation[] = [];
  let creditsCharged = EXTRACT_COST;
  let pendingCites = 0;
  let budgetExhausted = false;

  for (const c of extracted) {
    const key = citeKey(c.raw, c.type);
    const sectionKey = locateSection(motion.sections, c.raw);

    if (budgetExhausted) {
      citations.push({
        raw: c.raw,
        citeKey: key,
        type: c.type,
        status: "unverified",
        summary: "Credit budget exhausted — re-run after topping up",
        signals: null,
        location: { sectionKey, offset: 0 },
      });
      continue;
    }

    const result = await resolveCite({ raw: c.raw, type: c.type, citeKey: key, motionId: args.motionId });

    let status = result.status;
    let summary = result.summary;
    let signals = result.signals;

    if (result.charged) {
      const charged = await decrementCredits(args.userId, PER_CITE_COST);
      if (!charged) {
        budgetExhausted = true;
        status = "unverified";
        summary = "Credit budget exhausted — re-run after topping up";
        signals = null;
      } else {
        creditsCharged += PER_CITE_COST;
      }
    }

    if (status === "pending") pendingCites += 1;

    citations.push({
      raw: c.raw,
      citeKey: key,
      type: c.type,
      status,
      summary,
      signals,
      location: { sectionKey, offset: 0 },
    });
  }

  const result: CiteCheckResult = {
    runAt: new Date().toISOString(),
    totalCites: extracted.length,
    pendingCites,
    citations,
    creditsCharged,
  };

  await db
    .update(caseMotions)
    .set({ lastCiteCheckJson: result })
    .where(eq(caseMotions.id, args.motionId));

  return result;
}

function locateSection(
  sections: unknown,
  raw: string,
): "facts" | "argument" | "conclusion" {
  const s = sections as Record<string, { text?: string } | undefined>;
  for (const key of ["facts", "argument", "conclusion"] as const) {
    if (s[key]?.text?.includes(raw)) return key;
  }
  return "argument";
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run tests/unit/cite-check-orchestrator.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/cite-check/orchestrator.ts tests/unit/cite-check-orchestrator.test.ts
git commit -m "feat(cite-check): orchestrator with dedup + budget-exhaustion handling"
```

---

## Phase C — Inngest async resolve

### Task C1: `cite-check/resolve.requested` Inngest function

**Files:**
- Create: `src/server/inngest/functions/cite-check-resolve.ts`
- Modify: `src/server/inngest/index.ts`

- [ ] **Step 1: Implement function**

Create `src/server/inngest/functions/cite-check-resolve.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/server/db";
import { caseMotions } from "@/server/db/schema/case-motions";
import { cachedOpinions } from "@/server/db/schema/cached-opinions";
import { citeTreatments } from "@/server/db/schema/cite-treatments";
import { decideTreatment } from "@/server/services/cite-check/treatment";
import type { CiteCheckResult, CiteStatus } from "@/server/services/cite-check/types";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const citeCheckResolve = inngest.createFunction(
  {
    id: "cite-check-resolve",
    retries: 2,
    triggers: [{ event: "cite-check/resolve.requested" }],
  },
  async ({ event, step }) => {
    const { citeKey, raw, type, motionId } = event.data as {
      citeKey: string;
      raw: string;
      type: "opinion" | "statute";
      motionId: string;
    };

    const decision = await step.run("fetch-and-treat", async () => {
      // Currently we only support async fetch for opinions; statutes either
      // hit the cache synchronously or get marked not_found. CourtListener
      // search-by-citation requires an authenticated client we already
      // configure for Phase 2.2 research. Reuse it via dynamic import so we
      // don't drag the client into the synchronous resolve path.
      if (type !== "opinion") {
        return { status: "not_found" as const, summary: null, signals: null };
      }

      const { CourtListenerClient } = await import("@/server/services/courtlistener/client");
      const client = new CourtListenerClient();
      const search = await client.search({ q: raw, type: "o", pageSize: 1 }).catch(() => null);
      const hit = search?.results?.[0];
      if (!hit?.cluster_id) {
        return { status: "not_found" as const, summary: null, signals: null };
      }

      const detail = await client.getOpinion(hit.cluster_id).catch(() => null);
      if (!detail) {
        return { status: "not_found" as const, summary: null, signals: null };
      }

      // Upsert into cached_opinions so subsequent resolves are sync.
      await db
        .insert(cachedOpinions)
        .values({
          courtlistenerId: detail.courtlistenerId,
          citationBluebook: detail.citationBluebook,
          caseName: detail.caseName,
          court: detail.court,
          jurisdiction: detail.jurisdiction,
          courtLevel: detail.courtLevel,
          decisionDate: detail.decisionDate,
          fullText: detail.fullText,
          snippet: detail.snippet,
          metadata: detail.metadata ?? {},
        })
        .onConflictDoNothing({ target: cachedOpinions.courtlistenerId });

      const treatment = await decideTreatment({
        raw,
        type: "opinion",
        fullText: detail.fullText ?? detail.snippet ?? "",
        citedByCount: (detail.metadata as { citedByCount?: number } | undefined)?.citedByCount,
      });

      await db
        .insert(citeTreatments)
        .values({
          citeKey,
          citeType: "opinion",
          status: treatment.status,
          summary: treatment.summary ?? null,
          signals: treatment.signals ?? null,
          expiresAt: new Date(Date.now() + TTL_MS),
        })
        .onConflictDoUpdate({
          target: citeTreatments.citeKey,
          set: {
            status: treatment.status,
            summary: treatment.summary ?? null,
            signals: treatment.signals ?? null,
            generatedAt: new Date(),
            expiresAt: new Date(Date.now() + TTL_MS),
          },
        });

      return treatment;
    });

    await step.run("update-motion-json", async () => {
      const [motion] = await db
        .select({ id: caseMotions.id, json: caseMotions.lastCiteCheckJson })
        .from(caseMotions)
        .where(eq(caseMotions.id, motionId))
        .limit(1);
      if (!motion?.json) return;

      const current = motion.json as CiteCheckResult;
      let pendingCites = 0;
      const citations = current.citations.map((c) => {
        if (c.citeKey === citeKey && c.status === "pending") {
          return {
            ...c,
            status: decision.status as CiteStatus,
            summary: decision.summary,
            signals: decision.signals,
          };
        }
        if (c.status === "pending") pendingCites += 1;
        return c;
      });
      const next: CiteCheckResult = { ...current, pendingCites, citations };
      await db
        .update(caseMotions)
        .set({ lastCiteCheckJson: next, updatedAt: sql`updated_at` })
        .where(eq(caseMotions.id, motionId));
    });
  },
);
```

- [ ] **Step 2: Register function**

Open `src/server/inngest/index.ts`. Add to imports:

```ts
import { citeCheckResolve } from "./functions/cite-check-resolve";
```

Append `citeCheckResolve` to the exported `functions` array.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no new errors.

If there are errors mentioning `CourtListenerClient` constructor signature, inspect the existing class and adjust accordingly — the Phase 2.2 client may take config parameters. Use the same instantiation pattern as `src/server/services/research/opinion-cache.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/server/inngest/functions/cite-check-resolve.ts src/server/inngest/index.ts
git commit -m "feat(cite-check): Inngest async resolve via CourtListener"
```

---

## Phase D — tRPC

### Task D1: `motionCiteCheck` router

**Files:**
- Create: `src/server/trpc/routers/motion-cite-check.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Implement router**

Create `src/server/trpc/routers/motion-cite-check.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { caseMotions } from "@/server/db/schema/case-motions";
import { isStrategyEnabled } from "@/server/lib/feature-flags";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import {
  InsufficientCreditsError,
  runCiteCheck,
} from "@/server/services/cite-check/orchestrator";
import type { CiteCheckResult } from "@/server/services/cite-check/types";

function assertEnabled(orgId: string | null | undefined) {
  if (!isStrategyEnabled(orgId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cite-check not enabled for this organization.",
    });
  }
}

async function loadMotionCaseId(ctx: { db: typeof import("@/server/db").db }, motionId: string) {
  const [m] = await ctx.db
    .select({ id: caseMotions.id, caseId: caseMotions.caseId })
    .from(caseMotions)
    .where(eq(caseMotions.id, motionId))
    .limit(1);
  if (!m) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
  }
  return m.caseId;
}

export const motionCiteCheckRouter = router({
  run: protectedProcedure
    .input(z.object({ motionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const caseId = await loadMotionCaseId(ctx, input.motionId);
      await assertCaseAccess(ctx, caseId);

      try {
        return await runCiteCheck({ motionId: input.motionId, userId: ctx.user.id });
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: "Insufficient credits.",
          });
        }
        throw e;
      }
    }),

  get: protectedProcedure
    .input(z.object({ motionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const caseId = await loadMotionCaseId(ctx, input.motionId);
      await assertCaseAccess(ctx, caseId);

      const [m] = await ctx.db
        .select({ json: caseMotions.lastCiteCheckJson, updatedAt: caseMotions.updatedAt })
        .from(caseMotions)
        .where(eq(caseMotions.id, input.motionId))
        .limit(1);

      return {
        result: (m?.json ?? null) as CiteCheckResult | null,
        motionUpdatedAt: m?.updatedAt ?? null,
      };
    }),
});
```

- [ ] **Step 2: Register in root**

Open `src/server/trpc/root.ts`. Add to imports next to `motionDrafterRouter`:

```ts
import { motionCiteCheckRouter } from "./routers/motion-cite-check";
```

Inside the `appRouter = router({ ... })` object, add next to `motionDrafter`:

```ts
motionCiteCheck: motionCiteCheckRouter,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/motion-cite-check.ts src/server/trpc/root.ts
git commit -m "feat(cite-check): motionCiteCheck tRPC router"
```

---

## Phase E — UI

### Task E1: `CiteCheckPanel` component

**Files:**
- Create: `src/components/cases/motions/cite-check-panel.tsx`

- [ ] **Step 1: Implement component**

Create `src/components/cases/motions/cite-check-panel.tsx`:

```tsx
"use client";
import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, Loader2, FileQuestion, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type Status =
  | "good_law"
  | "caution"
  | "overruled"
  | "unverified"
  | "not_found"
  | "pending"
  | "malformed";

const STATUS_META: Record<Status, { icon: typeof CheckCircle2; color: string; label: string }> = {
  good_law: { icon: CheckCircle2, color: "text-emerald-500", label: "Good law" },
  caution: { icon: AlertTriangle, color: "text-amber-500", label: "Caution" },
  overruled: { icon: XCircle, color: "text-red-500", label: "Overruled" },
  unverified: { icon: HelpCircle, color: "text-zinc-500", label: "Unverified" },
  not_found: { icon: FileQuestion, color: "text-zinc-500", label: "Not in cache" },
  pending: { icon: Loader2, color: "text-zinc-400", label: "Resolving…" },
  malformed: { icon: AlertTriangle, color: "text-amber-600", label: "Malformed" },
};

interface Props {
  motionId: string;
  motionUpdatedAt: string | Date | null;
}

export function CiteCheckPanel({ motionId, motionUpdatedAt }: Props) {
  const utils = trpc.useUtils();
  const [showResults, setShowResults] = useState(false);

  const { data, refetch } = trpc.motionCiteCheck.get.useQuery(
    { motionId },
    {
      refetchInterval: (query) => {
        const r = query.state.data?.result;
        return r && r.pendingCites > 0 ? 5000 : false;
      },
    },
  );

  const run = trpc.motionCiteCheck.run.useMutation({
    onSuccess: () => {
      setShowResults(true);
      utils.motionCiteCheck.get.invalidate({ motionId });
    },
    onError: (e) => toast.error(e.message),
  });

  const result = data?.result ?? null;
  const stale =
    result &&
    motionUpdatedAt &&
    new Date(motionUpdatedAt).getTime() > new Date(result.runAt).getTime();

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-zinc-100">Citation check</h3>
          {result ? (
            <p className="text-xs text-zinc-500">
              Last run: {new Date(result.runAt).toLocaleString()} —{" "}
              {result.totalCites} cites, {result.creditsCharged} credits
              {result.pendingCites > 0 && ` (${result.pendingCites} pending)`}
            </p>
          ) : (
            <p className="text-xs text-zinc-500">
              Verify all citations are still good law (~1 credit per new citation)
            </p>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => run.mutate({ motionId })}
          disabled={run.isPending}
        >
          {run.isPending ? (
            <Loader2 className="mr-1.5 size-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 size-3" />
          )}
          {result ? "Run again" : "Cite-check"}
        </Button>
      </div>

      {stale && (
        <div className="rounded-md border border-amber-900/40 bg-amber-950/20 p-2 text-xs text-amber-200">
          Motion edited since last check. Re-run for fresh treatment.
        </div>
      )}

      {result && (showResults || result.totalCites > 0) && (
        <div className="space-y-1">
          {result.citations.map((c, i) => {
            const meta = STATUS_META[c.status];
            const Icon = meta.icon;
            return (
              <div
                key={`${c.citeKey}-${i}`}
                className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-950 p-2 text-sm"
                title={c.summary ?? meta.label}
              >
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${meta.color} ${
                    c.status === "pending" ? "animate-spin" : ""
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-zinc-200">{c.raw}</p>
                  {c.summary && (
                    <p className="truncate text-xs text-zinc-500">{c.summary}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-zinc-500">{meta.label}</span>
              </div>
            );
          })}
          {result.totalCites === 0 && (
            <p className="text-sm text-zinc-500">No citations found in this motion.</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/motions/cite-check-panel.tsx
git commit -m "feat(cite-check): CiteCheckPanel UI component"
```

---

### Task E2: Wire `CiteCheckPanel` into `MotionDetail`

**Files:**
- Modify: `src/components/cases/motions/motion-detail.tsx`

- [ ] **Step 1: Read current MotionDetail**

Open `src/components/cases/motions/motion-detail.tsx`. The component renders three `<SectionEditor>` blocks (facts, argument, conclusion). The cite-check panel goes below the third one.

- [ ] **Step 2: Add panel**

Add to imports at the top:

```ts
import { CiteCheckPanel } from "./cite-check-panel";
```

Find the existing block that renders the conclusion section editor (around line 100). Immediately after its closing tag, add:

```tsx
{sections.facts?.text && (
  <CiteCheckPanel
    motionId={motion.id}
    motionUpdatedAt={motion.updatedAt as unknown as string | Date | null}
  />
)}
```

(The `as unknown as` cast is consistent with existing casts in the file. The panel renders only after the facts section has text — no point cite-checking an empty motion.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v stripe.ts | grep "error TS"`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/motions/motion-detail.tsx
git commit -m "feat(cite-check): mount CiteCheckPanel in MotionDetail"
```

---

## Phase F — E2E + final checks

### Task F1: Playwright smoke

**Files:**
- Create: `e2e/cite-check-smoke.spec.ts`

- [ ] **Step 1: Write spec**

Create `e2e/cite-check-smoke.spec.ts`:

```ts
// Phase 4.4 smoke: motion detail page renders without 500 with cite-check
// bundle present. Auth + actual classifier flow are out of scope; manual
// UAT covers them.
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("4.4 cite-check smoke", () => {
  test("motion detail page returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}/motions/${FAKE_UUID}`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/cite-check-smoke.spec.ts
git commit -m "test(cite-check): Playwright smoke for motion detail with cite-check bundle"
```

---

### Task F2: Full test + typecheck pass

- [ ] **Step 1: Run full unit suite**

Run: `npx vitest run`
Expected: all tests pass; total ≈ previous 1225 + 17 new (5 extract + 6 normalize + 3 treatment + 4 resolve + 4 orchestrator − overlap with existing files).

A pre-existing flake in `tests/integration/case-messages-router.test.ts` may show "1 failed" file with no test failures — that is unrelated to this PR (voyageai ESM resolution). Ignore it.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: only the pre-existing `stripe.ts` API-version error.

- [ ] **Step 3: If anything new is red, halt and resolve before opening PR.**

---

### Task F3: Push + open PR

- [ ] **Step 1: Push**

```bash
git push -u origin feat/brief-cite-check
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(4.4): Brief Cite-Check — citation treatment for motions" --body "$(cat <<'EOF'
## Summary

Adds a "Cite-check" button to every motion in `MotionDetail`. Clicking it extracts every legal citation from the motion sections (Claude), looks each one up in our cached opinion / statute corpus, runs a Claude treatment classifier ("is this still good law?"), and renders inline severity badges. Uncached cites are fetched asynchronously via Inngest from CourtListener; the UI polls until pending cites resolve.

- Spec: docs/superpowers/specs/2026-05-01-brief-cite-check-design.md
- Plan: docs/superpowers/plans/2026-05-01-brief-cite-check.md

## Phases

- **A** — schema (1 col on case_motions + new cite_treatments table, migration 0057)
- **B** — backend services (TDD): types, Claude extractor, normalizer, treatment classifier, resolve chain (cache → opinion/statute → async), orchestrator (dedup + budget exhaustion)
- **C** — Inngest async resolver (CourtListener fetch → cache → treatment → patch motion json)
- **D** — tRPC router `motionCiteCheck` (run + get) registered in root
- **E** — UI: `CiteCheckPanel` component, mounted in `MotionDetail` below sections
- **F** — Playwright smoke + full suite green

## Decisions

| # | Choice |
|---|---|
| Treatment depth | Heuristic Claude treatment + structural sanity pre-pass |
| Source of cited text | `case_motions.sections` only |
| Result storage | `case_motions.last_cite_check_json` (no history) |
| Cite types | Opinions + statutes (CFR via `cached_statutes`) |
| Cache miss handling | Hybrid sync + async (Inngest) with polling |
| Pricing | 1cr extract + 1cr per NEW cite (7-day treatment cache, classics free) |
| Citation extraction | Claude-based |

## Test plan (manual UAT after merge)

- [ ] Open `/cases/<id>/motions/<motionId>` as user in `STRATEGY_BETA_ORG_IDS` org with a draft motion
- [ ] Click "Cite-check" → wait 5-30s → panel renders with severity icons
- [ ] Re-click on same motion → cached treatments returned, fewer credits charged
- [ ] Edit a section, save, return → banner says "Motion edited since last check"
- [ ] Click on a motion with no citations in text → panel says "No citations found"
- [ ] Verify async fetch: include a citation NOT in `cached_opinions` → first run shows "X pending", panel polls, status updates within 30s
- [ ] Verify budget exhaustion: drain credits to ≤ 2, run on a 5-cite motion → first 1-2 charged, rest marked "unverified" with budget summary

## Tests

- 17 new vitest cases (5 extract + 6 normalize + 3 treatment + 4 resolve + 4 orchestrator)
- 1 new Playwright smoke
- Suite total: ~1242 passing
- Typecheck clean (only pre-existing stripe.ts API-version error)
- Migration 0057 applied to Supabase prod
EOF
)"
```

- [ ] **Step 3: Capture PR URL.**

---

## Summary

| Phase | Tasks | New files | Modified files |
|---|---|---|---|
| A | 2 | 2 | 1 |
| B | 6 | 6 (1 types + 5 service + 5 tests) | 0 |
| C | 1 | 1 | 1 |
| D | 1 | 1 | 1 |
| E | 2 | 1 | 1 |
| F | 3 | 1 | 0 |

**Total:** 15 tasks. New unit tests: 17. New e2e smoke: 1. New migration: 0057. Net new files: ~12.

## Out of scope (deferred)

- Jurisdiction-weighted treatment (2nd Cir not bound by 9th Cir overruling)
- Bluebook format auto-correction (we flag, we don't fix)
- Inline edit of cite from `CiteCheckPanel`
- Statutes treatment richer than "in current code / repealed"
- Cite-checking memos / drip emails / non-motion text
- Multi-language Bluebook (English only)
- Per-cite re-check button (entire motion only in v1)
