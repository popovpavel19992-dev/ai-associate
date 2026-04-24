# 2.4.2 Motion Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship hybrid motion generator (template + AI) for 3 federal civil motions with DOCX export and optional hook into 2.4.1 deadlines on filing.

**Architecture:** New `motion_templates` + `case_motions` tables. Service layer splits into `draft.ts` (Anthropic grounding on attached research memos), `docx.ts` (template skeleton → `docx` Buffer), and `prompts.ts` (per-motion system prompts). tRPC `motions` router wires the flow; 4-step wizard UI lives under `/cases/[id]/motions/new`. `markFiled` optionally calls existing `deadlines.createTriggerEvent` service.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, tRPC v11, Supabase Postgres, `@anthropic-ai/sdk` (claude-opus-4-7), `docx` v9, Tailwind, Vitest, Playwright.

**Branch:** `feature/2.4.2-motion-generator`

**Spec:** `docs/superpowers/specs/2026-04-23-motion-generator-design.md`

---

## File Structure

**Create:**
- `src/server/db/migrations/0021_motion_generator.sql` — schema + motion deadline rules seed
- `src/server/db/schema/motion-templates.ts` — Drizzle schema
- `src/server/db/schema/case-motions.ts` — Drizzle schema
- `src/server/db/seed/motion-templates.ts` — idempotent seed upsert
- `src/server/services/motions/types.ts` — shared types
- `src/server/services/motions/prompts.ts` — per-motion system prompts
- `src/server/services/motions/draft.ts` — Anthropic drafting service
- `src/server/services/motions/docx.ts` — DOCX renderer
- `src/server/trpc/routers/motions.ts` — tRPC router
- `src/components/cases/motions/motions-tab.tsx` — list tab
- `src/components/cases/motions/motion-wizard.tsx` — 2-step wizard client
- `src/components/cases/motions/section-editor.tsx` — per-section textarea + regenerate
- `src/components/cases/motions/motion-detail.tsx` — detail view + Mark-as-Filed modal
- `src/app/(app)/cases/[id]/motions/new/page.tsx` — wizard route
- `src/app/(app)/cases/[id]/motions/[motionId]/page.tsx` — detail route
- `src/app/api/motions/[motionId]/docx/route.ts` — DOCX download endpoint
- `tests/unit/motion-docx.test.ts`
- `tests/unit/motion-draft.test.ts`
- `tests/unit/motion-prompts.test.ts`
- `tests/integration/motions-router.test.ts`
- `e2e/motion-generator-smoke.spec.ts`

**Modify:**
- `src/server/trpc/root.ts` — register `motions` router
- `src/app/(app)/cases/[id]/page.tsx` — add `motions` tab entry + render branch
- `src/server/db/seed.ts` — call `seedMotionTemplates()`

---

### Task 1: Schema migration + Drizzle definitions

**Files:**
- Create: `src/server/db/migrations/0021_motion_generator.sql`
- Create: `src/server/db/schema/motion-templates.ts`
- Create: `src/server/db/schema/case-motions.ts`

- [ ] **Step 1: Write migration SQL**

```sql
-- src/server/db/migrations/0021_motion_generator.sql
CREATE TABLE motion_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  motion_type text NOT NULL,
  skeleton jsonb NOT NULL,
  section_prompts jsonb NOT NULL,
  default_deadline_rule_slugs text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT motion_templates_slug_unique UNIQUE (org_id, slug)
);

CREATE INDEX motion_templates_org_idx ON motion_templates(org_id);

CREATE TABLE case_motions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  template_id uuid NOT NULL REFERENCES motion_templates(id) ON DELETE restrict,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  caption jsonb NOT NULL,
  sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  attached_memo_ids uuid[] NOT NULL DEFAULT '{}',
  attached_collection_ids uuid[] NOT NULL DEFAULT '{}',
  filed_at timestamptz,
  trigger_event_id uuid REFERENCES case_trigger_events(id) ON DELETE set null,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_motions_status_check CHECK (status IN ('draft','filed'))
);

CREATE INDEX case_motions_case_idx ON case_motions(case_id);
CREATE INDEX case_motions_org_idx ON case_motions(org_id);

-- Global (org_id NULL) motion-triggered deadline rules
INSERT INTO deadline_rules (org_id, trigger_event, name, description, days, day_type, shift_if_holiday, default_reminders, jurisdiction, citation, active)
VALUES
  (NULL, 'motion_filed', 'Opposition brief due (MTD)', 'Opposition to Motion to Dismiss', 14, 'calendar', true, '[7,3,1]'::jsonb, 'FRCP', 'Local Rule (federal default)', true),
  (NULL, 'motion_filed', 'Opposition brief due (MSJ)', 'Opposition to Motion for Summary Judgment', 21, 'calendar', true, '[7,3,1]'::jsonb, 'FRCP', 'Local Rule / FRCP 56', true),
  (NULL, 'opposition_filed', 'Reply brief due', 'Reply brief after opposition', 7, 'calendar', true, '[3,1]'::jsonb, 'FRCP', 'Local Rule (federal default)', true);
```

- [ ] **Step 2: Create Drizzle schema for motion_templates**

```ts
// src/server/db/schema/motion-templates.ts
import { pgTable, uuid, text, jsonb, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const motionTemplates = pgTable(
  "motion_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    motionType: text("motion_type").notNull(),
    skeleton: jsonb("skeleton").notNull(),
    sectionPrompts: jsonb("section_prompts").notNull(),
    defaultDeadlineRuleSlugs: text("default_deadline_rule_slugs").array().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("motion_templates_org_idx").on(table.orgId),
    unique("motion_templates_slug_unique").on(table.orgId, table.slug),
  ],
);

export type MotionTemplate = typeof motionTemplates.$inferSelect;
export type NewMotionTemplate = typeof motionTemplates.$inferInsert;
```

- [ ] **Step 3: Create Drizzle schema for case_motions**

```ts
// src/server/db/schema/case-motions.ts
import { pgTable, uuid, text, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";
import { motionTemplates } from "./motion-templates";
import { caseTriggerEvents } from "./case-trigger-events";

export const caseMotions = pgTable(
  "case_motions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    templateId: uuid("template_id").references(() => motionTemplates.id, { onDelete: "restrict" }).notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    caption: jsonb("caption").notNull(),
    sections: jsonb("sections").notNull().default({}),
    attachedMemoIds: uuid("attached_memo_ids").array().notNull().default([]),
    attachedCollectionIds: uuid("attached_collection_ids").array().notNull().default([]),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    triggerEventId: uuid("trigger_event_id").references(() => caseTriggerEvents.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_motions_case_idx").on(table.caseId),
    index("case_motions_org_idx").on(table.orgId),
    check("case_motions_status_check", sql`${table.status} IN ('draft','filed')`),
  ],
);

export type CaseMotion = typeof caseMotions.$inferSelect;
export type NewCaseMotion = typeof caseMotions.$inferInsert;
```

- [ ] **Step 4: Apply migration and verify**

Run: `npm run db:push`
Expected: migration 0021 applied, no errors. Confirm with: `psql $DATABASE_URL -c "\d case_motions"`.

- [ ] **Step 5: Commit**

```bash
git checkout -b feature/2.4.2-motion-generator
git add src/server/db/migrations/0021_motion_generator.sql src/server/db/schema/motion-templates.ts src/server/db/schema/case-motions.ts
git commit -m "feat(2.4.2): motion generator schema + deadline rules seed"
```

---

### Task 2: Shared service types

**Files:**
- Create: `src/server/services/motions/types.ts`

- [ ] **Step 1: Define shared types**

```ts
// src/server/services/motions/types.ts
export type MotionType = "motion_to_dismiss" | "motion_for_summary_judgment" | "motion_to_compel";

export type SectionKey = "facts" | "argument" | "conclusion";

export type SkeletonSection =
  | { key: string; type: "merge"; required?: boolean }
  | { key: string; type: "static"; text: string }
  | { key: SectionKey; type: "ai"; heading: string };

export interface MotionSkeleton {
  sections: SkeletonSection[];
}

export interface Citation {
  memoId: string;
  snippet: string;
}

export interface MotionSectionContent {
  text: string;
  aiGenerated: boolean;
  citations: Citation[];
}

export type MotionSections = Partial<Record<SectionKey, MotionSectionContent>>;

export interface MotionCaption {
  court: string;
  district: string;
  plaintiff: string;
  defendant: string;
  caseNumber: string;
  documentTitle: string;
}

export interface AttachedMemo {
  id: string;
  title: string;
  content: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/services/motions/types.ts
git commit -m "feat(2.4.2): motion service shared types"
```

---

### Task 3: Per-motion system prompts + template seed

**Files:**
- Create: `src/server/services/motions/prompts.ts`
- Create: `src/server/db/seed/motion-templates.ts`
- Modify: `src/server/db/seed.ts`
- Create: `tests/unit/motion-prompts.test.ts`

- [ ] **Step 1: Write failing prompt test**

```ts
// tests/unit/motion-prompts.test.ts
import { describe, it, expect } from "vitest";
import { renderPrompt, SYSTEM_PROMPTS } from "@/server/services/motions/prompts";

describe("motion prompts", () => {
  it("exports a system prompt for each motion type per section", () => {
    for (const mt of ["motion_to_dismiss", "motion_for_summary_judgment", "motion_to_compel"] as const) {
      for (const sk of ["facts", "argument", "conclusion"] as const) {
        expect(SYSTEM_PROMPTS[mt][sk]).toMatch(/.+/);
      }
    }
  });

  it("renders placeholders for case facts and attached memos", () => {
    const out = renderPrompt("motion_to_dismiss", "argument", {
      caseFacts: "Plaintiff slipped on a wet floor.",
      attachedMemos: [{ id: "m1", title: "Personal Jurisdiction", content: "Memo body text." }],
    });
    expect(out).toContain("Plaintiff slipped on a wet floor.");
    expect(out).toContain("Personal Jurisdiction");
    expect(out).toContain("Memo body text.");
    expect(out).toContain("[[memo:m1]]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/motion-prompts.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement prompts module**

```ts
// src/server/services/motions/prompts.ts
import type { MotionType, SectionKey, AttachedMemo } from "./types";

const COMMON = `You are a federal civil litigator drafting a motion for a U.S. District Court. Output plain text only — no markdown. When citing case law, place the marker [[memo:<memo_id>]] immediately after the citation so provenance is preserved. Cite only from the attached memos. If attached memos are insufficient, state that in one short sentence rather than inventing authority.`;

export const SYSTEM_PROMPTS: Record<MotionType, Record<SectionKey, string>> = {
  motion_to_dismiss: {
    facts: `${COMMON}\n\nDraft a concise Statement of Facts for a Motion to Dismiss under FRCP 12(b)(6). Accept the complaint's well-pleaded facts as true and frame them neutrally. 2–4 paragraphs.`,
    argument: `${COMMON}\n\nDraft the Argument for a Motion to Dismiss under FRCP 12(b)(6). State the Twombly/Iqbal plausibility standard and apply controlling law from attached memos to the facts. Use headings per ground.`,
    conclusion: `${COMMON}\n\nDraft a one-paragraph Conclusion requesting dismissal of the Complaint.`,
  },
  motion_for_summary_judgment: {
    facts: `${COMMON}\n\nDraft a Statement of Undisputed Material Facts for a Motion for Summary Judgment (FRCP 56). Each fact as a numbered sentence with an evidentiary reference placeholder in brackets.`,
    argument: `${COMMON}\n\nDraft the Argument for summary judgment. State the Rule 56 standard and apply controlling law from attached memos to the undisputed facts, separated per claim.`,
    conclusion: `${COMMON}\n\nDraft a one-paragraph Conclusion requesting summary judgment in movant's favor on the identified claims.`,
  },
  motion_to_compel: {
    facts: `${COMMON}\n\nDraft the Factual Background for a Motion to Compel (FRCP 37). Describe discovery request(s) served, the deficient response, and meet-and-confer efforts. 2–3 paragraphs.`,
    argument: `${COMMON}\n\nDraft the Argument for a Motion to Compel. State Rule 26(b)(1) scope, address specific objections, and apply attached-memo law. Include a meet-and-confer subsection.`,
    conclusion: `${COMMON}\n\nDraft a one-paragraph Conclusion requesting the Court compel responses and award expenses under Rule 37(a)(5).`,
  },
};

export function renderPrompt(
  motionType: MotionType,
  section: SectionKey,
  ctx: { caseFacts: string; attachedMemos: AttachedMemo[] },
): string {
  const memoBlock = ctx.attachedMemos.length
    ? ctx.attachedMemos
        .map((m) => `--- MEMO ${m.title} (cite as [[memo:${m.id}]]) ---\n${m.content}`)
        .join("\n\n")
    : "(no memos attached)";
  return `${SYSTEM_PROMPTS[motionType][section]}\n\nCASE FACTS:\n${ctx.caseFacts}\n\nATTACHED MEMOS:\n${memoBlock}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/motion-prompts.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Write seed script**

```ts
// src/server/db/seed/motion-templates.ts
import { db } from "../index";
import { motionTemplates } from "../schema/motion-templates";
import { eq, and, isNull } from "drizzle-orm";
import { SYSTEM_PROMPTS } from "@/server/services/motions/prompts";
import type { MotionSkeleton } from "@/server/services/motions/types";

const SKELETON_COMMON: MotionSkeleton["sections"] = [
  { key: "caption", type: "merge", required: true },
  { key: "facts", type: "ai", heading: "STATEMENT OF FACTS" },
  { key: "argument", type: "ai", heading: "ARGUMENT" },
  { key: "conclusion", type: "ai", heading: "CONCLUSION" },
  { key: "signature", type: "merge" },
  { key: "certificate_of_service", type: "static", text: "I hereby certify that on the date signed above, I electronically filed the foregoing with the Clerk of Court using the CM/ECF system, which will send notification to all counsel of record." },
];

const TEMPLATES = [
  { slug: "motion_to_dismiss_12b6", name: "Motion to Dismiss (FRCP 12(b)(6))", description: "Failure to state a claim upon which relief can be granted.", motionType: "motion_to_dismiss" as const, defaultDeadlineRuleSlugs: [] },
  { slug: "motion_for_summary_judgment", name: "Motion for Summary Judgment (FRCP 56)", description: "No genuine dispute as to material fact.", motionType: "motion_for_summary_judgment" as const, defaultDeadlineRuleSlugs: [] },
  { slug: "motion_to_compel_discovery", name: "Motion to Compel Discovery (FRCP 37)", description: "Compelling discovery responses after meet-and-confer.", motionType: "motion_to_compel" as const, defaultDeadlineRuleSlugs: [] },
];

export async function seedMotionTemplates(): Promise<void> {
  for (const t of TEMPLATES) {
    const existing = await db
      .select({ id: motionTemplates.id })
      .from(motionTemplates)
      .where(and(isNull(motionTemplates.orgId), eq(motionTemplates.slug, t.slug)))
      .limit(1);

    const payload = {
      orgId: null,
      slug: t.slug,
      name: t.name,
      description: t.description,
      motionType: t.motionType,
      skeleton: { sections: SKELETON_COMMON },
      sectionPrompts: SYSTEM_PROMPTS[t.motionType],
      defaultDeadlineRuleSlugs: t.defaultDeadlineRuleSlugs,
      active: true,
    };

    if (existing[0]) {
      await db.update(motionTemplates).set(payload).where(eq(motionTemplates.id, existing[0].id));
    } else {
      await db.insert(motionTemplates).values(payload);
    }
  }
}
```

- [ ] **Step 6: Wire seed into main entrypoint**

Open `src/server/db/seed.ts`. Import `seedMotionTemplates` from `./seed/motion-templates` and invoke it at the end of the existing seed flow (match the pattern used by `sectionPresets` seeding). Add a `console.log("Seeded motion templates")` after the call.

- [ ] **Step 7: Run the seed**

Run: `npm run db:seed`
Expected: exits cleanly, prints "Seeded motion templates". Verify: `psql $DATABASE_URL -c "SELECT slug, motion_type FROM motion_templates WHERE org_id IS NULL;"` shows 3 rows.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/motions/prompts.ts src/server/db/seed/motion-templates.ts src/server/db/seed.ts tests/unit/motion-prompts.test.ts
git commit -m "feat(2.4.2): motion system prompts + template seed"
```

---

### Task 4: AI draft service

**Files:**
- Create: `src/server/services/motions/draft.ts`
- Create: `tests/unit/motion-draft.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/motion-draft.test.ts
import { describe, it, expect, vi } from "vitest";
import { draftMotionSection, NoMemosAttachedError } from "@/server/services/motions/draft";

function makeMockAnthropic(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: responseText }] }),
    },
  } as unknown as import("@anthropic-ai/sdk").default;
}

describe("draftMotionSection", () => {
  it("drafts text and extracts memo citations from markers", async () => {
    const client = makeMockAnthropic(
      "The complaint fails to allege minimum contacts [[memo:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa]] and therefore personal jurisdiction is lacking.",
    );
    const out = await draftMotionSection(
      {
        motionType: "motion_to_dismiss",
        sectionKey: "argument",
        caseFacts: "Defendant is a NY resident.",
        attachedMemos: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "Personal Jurisdiction", content: "Int'l Shoe test..." }],
      },
      { client },
    );
    expect(out.text).toContain("minimum contacts");
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0].memoId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("throws NoMemosAttachedError for argument section with no memos", async () => {
    const client = makeMockAnthropic("unused");
    await expect(
      draftMotionSection(
        { motionType: "motion_to_dismiss", sectionKey: "argument", caseFacts: "facts", attachedMemos: [] },
        { client },
      ),
    ).rejects.toBeInstanceOf(NoMemosAttachedError);
  });

  it("allows facts and conclusion sections without memos", async () => {
    const client = makeMockAnthropic("Plaintiff alleges X.");
    const out = await draftMotionSection(
      { motionType: "motion_to_dismiss", sectionKey: "facts", caseFacts: "facts", attachedMemos: [] },
      { client },
    );
    expect(out.text).toBe("Plaintiff alleges X.");
    expect(out.citations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/motion-draft.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement draft service**

```ts
// src/server/services/motions/draft.ts
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

export interface DraftInput {
  motionType: MotionType;
  sectionKey: SectionKey;
  caseFacts: string;
  attachedMemos: AttachedMemo[];
}

export interface DraftOutput {
  text: string;
  citations: Citation[];
}

export async function draftMotionSection(
  input: DraftInput,
  deps: { client?: Anthropic } = {},
): Promise<DraftOutput> {
  if (input.sectionKey === "argument" && input.attachedMemos.length === 0) {
    throw new NoMemosAttachedError();
  }
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const prompt = renderPrompt(input.motionType, input.sectionKey, {
    caseFacts: input.caseFacts,
    attachedMemos: input.attachedMemos,
  });

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/motion-draft.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/motions/draft.ts tests/unit/motion-draft.test.ts
git commit -m "feat(2.4.2): AI drafting service with citation extraction"
```

---

### Task 5: DOCX renderer

**Files:**
- Create: `src/server/services/motions/docx.ts`
- Create: `tests/unit/motion-docx.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/motion-docx.test.ts
import { describe, it, expect } from "vitest";
import { renderMotionDocx } from "@/server/services/motions/docx";

describe("renderMotionDocx", () => {
  it("produces a non-empty Buffer for a minimal motion input", async () => {
    const buf = await renderMotionDocx({
      caption: {
        court: "U.S. District Court",
        district: "Southern District of New York",
        plaintiff: "Alice Plaintiff",
        defendant: "Bob Defendant",
        caseNumber: "1:26-cv-12345",
        documentTitle: "MOTION TO DISMISS",
      },
      skeleton: {
        sections: [
          { key: "caption", type: "merge", required: true },
          { key: "facts", type: "ai", heading: "STATEMENT OF FACTS" },
          { key: "argument", type: "ai", heading: "ARGUMENT" },
          { key: "conclusion", type: "ai", heading: "CONCLUSION" },
          { key: "signature", type: "merge" },
          { key: "certificate_of_service", type: "static", text: "I hereby certify..." },
        ],
      },
      sections: {
        facts: { text: "Facts body paragraph.", aiGenerated: true, citations: [] },
        argument: { text: "Argument body.", aiGenerated: true, citations: [] },
        conclusion: { text: "Conclusion body.", aiGenerated: true, citations: [] },
      },
      signer: { name: "Jane Lawyer", firm: "Lawyer & Co.", barNumber: "NY-12345", date: "April 23, 2026" },
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/motion-docx.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement DOCX renderer**

```ts
// src/server/services/motions/docx.ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import type { MotionSkeleton, MotionSections, MotionCaption, SectionKey } from "./types";

export interface DocxInput {
  caption: MotionCaption;
  skeleton: MotionSkeleton;
  sections: MotionSections;
  signer: { name: string; firm?: string; barNumber?: string; date: string };
}

function captionParagraphs(c: MotionCaption): Paragraph[] {
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.court.toUpperCase(), bold: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.district.toUpperCase(), bold: true })] }),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ children: [new TextRun(`${c.plaintiff},`)] }),
    new Paragraph({ children: [new TextRun({ text: "          Plaintiff,", italics: true })] }),
    new Paragraph({ children: [new TextRun("v.")] }),
    new Paragraph({ children: [new TextRun(`${c.defendant},`)] }),
    new Paragraph({ children: [new TextRun({ text: "          Defendant.", italics: true })] }),
    new Paragraph({ children: [new TextRun(`Case No. ${c.caseNumber}`)] }),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.documentTitle.toUpperCase(), bold: true })] }),
    new Paragraph({ children: [new TextRun("")] }),
  ];
}

function signatureParagraphs(s: DocxInput["signer"]): Paragraph[] {
  return [
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ children: [new TextRun(`Dated: ${s.date}`)] }),
    new Paragraph({ children: [new TextRun("Respectfully submitted,")] }),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ children: [new TextRun(`/s/ ${s.name}`)] }),
    new Paragraph({ children: [new TextRun(s.name)] }),
    ...(s.firm ? [new Paragraph({ children: [new TextRun(s.firm)] })] : []),
    ...(s.barNumber ? [new Paragraph({ children: [new TextRun(`Bar No. ${s.barNumber}`)] })] : []),
  ];
}

function textParagraphs(text: string): Paragraph[] {
  const parts = text.split(/\n{2,}/);
  return parts.map((p) => new Paragraph({ children: [new TextRun(p.replace(/\[\[memo:[0-9a-fA-F-]{36}\]\]/g, ""))] }));
}

export async function renderMotionDocx(input: DocxInput): Promise<Buffer> {
  const children: Paragraph[] = [];

  for (const s of input.skeleton.sections) {
    if (s.type === "merge" && s.key === "caption") {
      children.push(...captionParagraphs(input.caption));
    } else if (s.type === "merge" && s.key === "signature") {
      children.push(...signatureParagraphs(input.signer));
    } else if (s.type === "ai") {
      const content = input.sections[s.key as SectionKey];
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: s.heading, bold: true })] }));
      if (content?.text) children.push(...textParagraphs(content.text));
      else children.push(new Paragraph({ children: [new TextRun({ text: "[Section not yet drafted]", italics: true })] }));
    } else if (s.type === "static") {
      children.push(new Paragraph({ children: [new TextRun("")] }));
      children.push(new Paragraph({ children: [new TextRun(s.text)] }));
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
          paragraph: { spacing: { line: 480 } },
        },
      },
    },
    sections: [
      { properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children },
    ],
  });

  return await Packer.toBuffer(doc);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/motion-docx.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/motions/docx.ts tests/unit/motion-docx.test.ts
git commit -m "feat(2.4.2): motion DOCX renderer"
```

---

### Task 6: tRPC router — read + create + suggestions

**Files:**
- Create: `src/server/trpc/routers/motions.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 0: Discover existing column names**

Before writing the router, confirm the real column names for the fields the router will read. Run:

```bash
grep -E "plaintiff|defendant|caseNumber|court|summary|description" src/server/db/schema/cases.ts
grep -E "caseId|content|body|title|orgId" src/server/db/schema/research-memos.ts
grep -E "caseId|orgId" src/server/db/schema/research-collections.ts
```

Substitute the actual field names into the code below wherever `caseRow.plaintiffName`, `caseRow.defendantName`, `caseRow.caseNumber`, `caseRow.court`, `caseRow.summary`, `researchMemos.content`, `researchMemos.caseId`, `researchCollections.caseId` appear.

- [ ] **Step 1: Implement listTemplates / list / get / suggestMemos / create**

```ts
// src/server/trpc/routers/motions.ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, desc, or, isNull, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { caseMotions } from "@/server/db/schema/case-motions";
import { cases } from "@/server/db/schema/cases";
import { researchMemos } from "@/server/db/schema/research-memos";
import { researchCollections } from "@/server/db/schema/research-collections";
import { caseTriggerEvents } from "@/server/db/schema/case-trigger-events";

async function loadCaseForOrg(ctx: { db: typeof import("@/server/db").db; orgId: string }, caseId: string) {
  const rows = await ctx.db.select().from(cases).where(and(eq(cases.id, caseId), eq(cases.orgId, ctx.orgId))).limit(1);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
  return rows[0];
}

export const motionsRouter = router({
  listTemplates: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(motionTemplates)
      .where(and(eq(motionTemplates.active, true), or(isNull(motionTemplates.orgId), eq(motionTemplates.orgId, ctx.orgId))));
  }),

  list: protectedProcedure.input(z.object({ caseId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await loadCaseForOrg(ctx, input.caseId);
    return ctx.db
      .select()
      .from(caseMotions)
      .where(and(eq(caseMotions.caseId, input.caseId), eq(caseMotions.orgId, ctx.orgId)))
      .orderBy(desc(caseMotions.createdAt));
  }),

  get: protectedProcedure.input(z.object({ motionId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(caseMotions)
      .where(and(eq(caseMotions.id, input.motionId), eq(caseMotions.orgId, ctx.orgId)))
      .limit(1);
    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
    return rows[0];
  }),

  suggestMemos: protectedProcedure.input(z.object({ caseId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await loadCaseForOrg(ctx, input.caseId);
    const memos = await ctx.db
      .select({ id: researchMemos.id, title: researchMemos.title, createdAt: researchMemos.createdAt })
      .from(researchMemos)
      .where(and(eq(researchMemos.orgId, ctx.orgId), eq(researchMemos.caseId, input.caseId)))
      .orderBy(desc(researchMemos.createdAt));
    const collections = await ctx.db
      .select({ id: researchCollections.id, name: researchCollections.name })
      .from(researchCollections)
      .where(and(eq(researchCollections.orgId, ctx.orgId), eq(researchCollections.caseId, input.caseId)));
    return { memos, collections };
  }),

  create: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      templateId: z.string().uuid(),
      title: z.string().min(1).max(200),
      memoIds: z.array(z.string().uuid()).default([]),
      collectionIds: z.array(z.string().uuid()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const caseRow = await loadCaseForOrg(ctx, input.caseId);
      const tpl = await ctx.db.select().from(motionTemplates).where(eq(motionTemplates.id, input.templateId)).limit(1);
      if (!tpl[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });

      const caption = {
        court: "U.S. District Court",
        district: caseRow.court ?? "",
        plaintiff: caseRow.plaintiffName ?? "",
        defendant: caseRow.defendantName ?? "",
        caseNumber: caseRow.caseNumber ?? "",
        documentTitle: tpl[0].name,
      };

      const inserted = await ctx.db.insert(caseMotions).values({
        orgId: ctx.orgId,
        caseId: input.caseId,
        templateId: input.templateId,
        title: input.title,
        status: "draft",
        caption,
        sections: {},
        attachedMemoIds: input.memoIds,
        attachedCollectionIds: input.collectionIds,
        createdBy: ctx.userId,
      }).returning();
      return inserted[0];
    }),
});
```

- [ ] **Step 2: Register in root router**

Open `src/server/trpc/root.ts`. Add the import next to the other router imports:

```ts
import { motionsRouter } from "./routers/motions";
```

Add to the `appRouter` object (place it near `deadlines`):

```ts
motions: motionsRouter,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in motions-related files. Fix any column-name mismatches discovered in Step 0.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/motions.ts src/server/trpc/root.ts
git commit -m "feat(2.4.2): motions router — list/get/create/suggest"
```

---

### Task 7: tRPC router — generateSection, updateSection, updateAttachments

**Files:**
- Modify: `src/server/trpc/routers/motions.ts`

- [ ] **Step 1: Append three procedures inside the `motionsRouter` object**

```ts
  generateSection: protectedProcedure
    .input(z.object({
      motionId: z.string().uuid(),
      sectionKey: z.enum(["facts", "argument", "conclusion"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const motionRows = await ctx.db
        .select()
        .from(caseMotions)
        .where(and(eq(caseMotions.id, input.motionId), eq(caseMotions.orgId, ctx.orgId)))
        .limit(1);
      const motion = motionRows[0];
      if (!motion) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
      if (motion.status === "filed") throw new TRPCError({ code: "FORBIDDEN", message: "Cannot regenerate filed motion" });
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Anthropic API key not configured" });
      }

      const tplRows = await ctx.db.select().from(motionTemplates).where(eq(motionTemplates.id, motion.templateId)).limit(1);
      const tpl = tplRows[0]!;

      const caseRow = await loadCaseForOrg(ctx, motion.caseId);
      const memos = motion.attachedMemoIds.length
        ? await ctx.db
            .select({ id: researchMemos.id, title: researchMemos.title, content: researchMemos.content })
            .from(researchMemos)
            .where(and(inArray(researchMemos.id, motion.attachedMemoIds), eq(researchMemos.orgId, ctx.orgId)))
        : [];

      const { draftMotionSection, NoMemosAttachedError } = await import("@/server/services/motions/draft");
      try {
        const out = await draftMotionSection({
          motionType: tpl.motionType as "motion_to_dismiss" | "motion_for_summary_judgment" | "motion_to_compel",
          sectionKey: input.sectionKey,
          caseFacts: caseRow.summary ?? caseRow.description ?? "",
          attachedMemos: memos.map((m) => ({ id: m.id, title: m.title, content: m.content ?? "" })),
        });

        const nextSections = {
          ...(motion.sections as Record<string, unknown>),
          [input.sectionKey]: { text: out.text, aiGenerated: true, citations: out.citations },
        };
        await ctx.db.update(caseMotions).set({ sections: nextSections, updatedAt: new Date() }).where(eq(caseMotions.id, motion.id));
        return { text: out.text, citations: out.citations };
      } catch (e) {
        if (e instanceof NoMemosAttachedError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      }
    }),

  updateSection: protectedProcedure
    .input(z.object({
      motionId: z.string().uuid(),
      sectionKey: z.enum(["facts", "argument", "conclusion"]),
      text: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(caseMotions)
        .where(and(eq(caseMotions.id, input.motionId), eq(caseMotions.orgId, ctx.orgId)))
        .limit(1);
      const motion = rows[0];
      if (!motion) throw new TRPCError({ code: "NOT_FOUND" });
      if (motion.status === "filed") throw new TRPCError({ code: "FORBIDDEN", message: "Filed motions are immutable" });

      const existing = (motion.sections as Record<string, { text: string; aiGenerated: boolean; citations: unknown[] } | undefined>)[input.sectionKey];
      const nextSections = {
        ...(motion.sections as Record<string, unknown>),
        [input.sectionKey]: {
          text: input.text,
          aiGenerated: existing?.aiGenerated ?? false,
          citations: existing?.citations ?? [],
        },
      };
      await ctx.db.update(caseMotions).set({ sections: nextSections, updatedAt: new Date() }).where(eq(caseMotions.id, motion.id));
      return { ok: true };
    }),

  updateAttachments: protectedProcedure
    .input(z.object({
      motionId: z.string().uuid(),
      memoIds: z.array(z.string().uuid()),
      collectionIds: z.array(z.string().uuid()),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(caseMotions)
        .set({ attachedMemoIds: input.memoIds, attachedCollectionIds: input.collectionIds, updatedAt: new Date() })
        .where(and(eq(caseMotions.id, input.motionId), eq(caseMotions.orgId, ctx.orgId)));
      return { ok: true };
    }),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/motions.ts
git commit -m "feat(2.4.2): motions router — generateSection + updateSection + updateAttachments"
```

---

### Task 8: tRPC router — markFiled + delete + deadline trigger hook

**Files:**
- Modify: `src/server/trpc/routers/motions.ts`

- [ ] **Step 0: Locate the deadline-rules apply service**

The 2.4.1 deadlines router exposes `createTriggerEvent` and internally applies matching rules. Identify the service helper so this router can reuse it without a router-to-router call. Run:

```bash
grep -rn "applyDeadlineRules\|applyRulesForTrigger\|createTriggerEvent" src/server/services/ src/server/trpc/routers/deadlines.ts
```

Note the function name and signature. Use that exact name in the code below — replace `applyDeadlineRulesForTrigger` with whatever 2.4.1 actually exported. If no service helper exists and the logic lives only inside the router, factor it out into `src/server/services/deadlines/apply-rules.ts` as a prerequisite sub-step, then continue.

- [ ] **Step 1: Append markFiled and delete procedures**

```ts
  markFiled: protectedProcedure
    .input(z.object({
      motionId: z.string().uuid(),
      filedAt: z.string().datetime(),
      createTrigger: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(caseMotions)
        .where(and(eq(caseMotions.id, input.motionId), eq(caseMotions.orgId, ctx.orgId)))
        .limit(1);
      const motion = rows[0];
      if (!motion) throw new TRPCError({ code: "NOT_FOUND" });
      if (motion.status === "filed") throw new TRPCError({ code: "BAD_REQUEST", message: "Already filed" });

      let triggerEventId: string | null = null;
      if (input.createTrigger) {
        const inserted = await ctx.db.insert(caseTriggerEvents).values({
          caseId: motion.caseId,
          triggerEvent: "motion_filed",
          eventDate: new Date(input.filedAt).toISOString().slice(0, 10),
          jurisdiction: "FRCP",
          notes: `Auto-created from motion: ${motion.title}`,
          createdBy: ctx.userId,
        }).returning({ id: caseTriggerEvents.id });
        triggerEventId = inserted[0]?.id ?? null;

        if (triggerEventId) {
          const { applyDeadlineRulesForTrigger } = await import("@/server/services/deadlines/apply-rules");
          await applyDeadlineRulesForTrigger({ triggerEventId, orgId: ctx.orgId, caseId: motion.caseId });
        }
      }

      await ctx.db.update(caseMotions).set({
        status: "filed",
        filedAt: new Date(input.filedAt),
        triggerEventId,
        updatedAt: new Date(),
      }).where(eq(caseMotions.id, motion.id));

      return { ok: true, triggerEventId };
    }),

  delete: protectedProcedure
    .input(z.object({ motionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ status: caseMotions.status })
        .from(caseMotions)
        .where(and(eq(caseMotions.id, input.motionId), eq(caseMotions.orgId, ctx.orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.status === "filed") throw new TRPCError({ code: "FORBIDDEN", message: "Filed motions cannot be deleted" });
      await ctx.db.delete(caseMotions).where(eq(caseMotions.id, input.motionId));
      return { ok: true };
    }),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/motions.ts src/server/services/deadlines/apply-rules.ts 2>/dev/null || git add src/server/trpc/routers/motions.ts
git commit -m "feat(2.4.2): motions router — markFiled with deadline trigger + delete"
```

---

### Task 9: DOCX download API route

**Files:**
- Create: `src/app/api/motions/[motionId]/docx/route.ts`

- [ ] **Step 0: Copy auth pattern from another API route**

Run: `grep -l "auth()" src/app/api/ -r | head -3` — open one route file and match its Clerk auth usage (import path, how `orgId` is obtained).

- [ ] **Step 1: Implement download route**

```ts
// src/app/api/motions/[motionId]/docx/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseMotions } from "@/server/db/schema/case-motions";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { renderMotionDocx } from "@/server/services/motions/docx";
import type { MotionSkeleton, MotionSections, MotionCaption } from "@/server/services/motions/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ motionId: string }> }) {
  const { motionId } = await params;
  const { userId, orgId } = await auth();
  if (!userId || !orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const motionRows = await db
    .select()
    .from(caseMotions)
    .where(and(eq(caseMotions.id, motionId), eq(caseMotions.orgId, orgId)))
    .limit(1);
  const motion = motionRows[0];
  if (!motion) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tplRows = await db.select().from(motionTemplates).where(eq(motionTemplates.id, motion.templateId)).limit(1);
  const tpl = tplRows[0]!;

  const userRows = await db.select().from(users).where(eq(users.id, motion.createdBy)).limit(1);
  const signerName = userRows[0]
    ? `${userRows[0].firstName ?? ""} ${userRows[0].lastName ?? ""}`.trim() || userRows[0].email
    : "Attorney";

  const buf = await renderMotionDocx({
    caption: motion.caption as MotionCaption,
    skeleton: tpl.skeleton as MotionSkeleton,
    sections: motion.sections as MotionSections,
    signer: {
      name: signerName,
      date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    },
  });

  const caseRows = await db.select({ caseNumber: cases.caseNumber }).from(cases).where(eq(cases.id, motion.caseId)).limit(1);
  const safeCaseNumber = (caseRows[0]?.caseNumber ?? "motion").replace(/[^a-zA-Z0-9-]/g, "_");
  const filename = `${safeCaseNumber}-${tpl.slug}-${new Date().toISOString().slice(0, 10)}.docx`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
```

> **Note:** If the codebase stores user display name in a single `name` field instead of `firstName`/`lastName`, substitute accordingly (check `src/server/db/schema/users.ts`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/motions/[motionId]/docx/route.ts"
git commit -m "feat(2.4.2): DOCX download route for motions"
```

---

### Task 10: Motions tab + case page registration

**Files:**
- Create: `src/components/cases/motions/motions-tab.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 0: Confirm trpc client import path**

Run: `grep -rn "from \"@/lib/trpc\"\|from \"@/utils/trpc\"" src/components/cases/deadlines/deadlines-tab.tsx` — use the exact import this file uses.

- [ ] **Step 1: Implement motions-tab**

```tsx
// src/components/cases/motions/motions-tab.tsx
"use client";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

export function MotionsTab({ caseId }: { caseId: string }) {
  const { data: motions, isLoading } = trpc.motions.list.useQuery({ caseId });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Motions</h2>
        <Link
          href={`/cases/${caseId}/motions/new`}
          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New motion
        </Link>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {motions && motions.length === 0 && (
        <p className="text-sm text-gray-500">No motions yet. Click "New motion" to generate one.</p>
      )}

      <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
        {motions?.map((m) => (
          <li key={m.id} className="p-4 hover:bg-gray-50">
            <Link href={`/cases/${caseId}/motions/${m.id}`} className="block">
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.title}</span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    m.status === "filed" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {m.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Updated {new Date(m.updatedAt).toLocaleDateString()}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

> If the real import is different (e.g., `@/utils/trpc`), substitute accordingly.

- [ ] **Step 2: Register tab on case page**

Open `src/app/(app)/cases/[id]/page.tsx`:

1. Add import:
```tsx
import { MotionsTab } from "@/components/cases/motions/motions-tab";
```

2. Add to the `TABS` array (after `deadlines`):
```tsx
{ key: "motions", label: "Motions" },
```

3. Add render branch in the tab-switch section, matching the existing ternary/switch pattern used for other tabs like `deadlines`:
```tsx
{activeTab === "motions" && <MotionsTab caseId={caseId} />}
```

- [ ] **Step 3: Dev server smoke**

Run: `npm run dev` in background. Navigate to any case detail, click **Motions** tab. Expected: empty-state message and "New motion" link render.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/motions/motions-tab.tsx "src/app/(app)/cases/[id]/page.tsx"
git commit -m "feat(2.4.2): motions tab on case detail page"
```

---

### Task 11: Section editor component

**Files:**
- Create: `src/components/cases/motions/section-editor.tsx`

- [ ] **Step 1: Implement section-editor**

```tsx
// src/components/cases/motions/section-editor.tsx
"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

type SectionKey = "facts" | "argument" | "conclusion";

interface Props {
  motionId: string;
  sectionKey: SectionKey;
  heading: string;
  initialText: string;
  initialCitations: Array<{ memoId: string; snippet: string }>;
  onUpdated: () => void;
}

export function SectionEditor({ motionId, sectionKey, heading, initialText, initialCitations, onUpdated }: Props) {
  const [text, setText] = useState(initialText);
  const [citations, setCitations] = useState(initialCitations);
  const [error, setError] = useState<string | null>(null);

  const generate = trpc.motions.generateSection.useMutation({
    onSuccess: (data) => {
      setText(data.text);
      setCitations(data.citations);
      setError(null);
      onUpdated();
    },
    onError: (e) => setError(e.message),
  });

  const save = trpc.motions.updateSection.useMutation({
    onSuccess: () => {
      setError(null);
      onUpdated();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <section className="rounded-md border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{heading}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => generate.mutate({ motionId, sectionKey })}
            disabled={generate.isPending}
            className="rounded-md bg-purple-600 px-3 py-1 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {generate.isPending ? "Generating…" : text ? "Regenerate" : "Generate with AI"}
          </button>
          <button
            type="button"
            onClick={() => save.mutate({ motionId, sectionKey, text })}
            disabled={save.isPending}
            className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        className="mt-3 w-full rounded-md border border-gray-300 p-2 font-mono text-sm"
        placeholder={`${heading} will appear here after generation, or type manually.`}
      />

      {citations.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-gray-700">Citations</p>
          <ul className="mt-1 space-y-1">
            {citations.map((c, i) => (
              <li key={i} className="text-xs text-gray-600">
                from: <span className="font-medium">{c.snippet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/motions/section-editor.tsx
git commit -m "feat(2.4.2): section editor with AI regenerate + save"
```

---

### Task 12: Wizard + new-motion route

**Files:**
- Create: `src/components/cases/motions/motion-wizard.tsx`
- Create: `src/app/(app)/cases/[id]/motions/new/page.tsx`

- [ ] **Step 1: Implement wizard**

```tsx
// src/components/cases/motions/motion-wizard.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export function MotionWizard({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [selectedMemos, setSelectedMemos] = useState<string[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);

  const { data: templates } = trpc.motions.listTemplates.useQuery();
  const { data: suggestions } = trpc.motions.suggestMemos.useQuery({ caseId });
  const create = trpc.motions.create.useMutation({
    onSuccess: (m) => router.push(`/cases/${caseId}/motions/${m.id}`),
  });

  useEffect(() => {
    if (suggestions && suggestions.memos.length && selectedMemos.length === 0) {
      setSelectedMemos(suggestions.memos.map((m) => m.id));
    }
  }, [suggestions, selectedMemos.length]);

  const toggleMemo = (id: string) =>
    setSelectedMemos((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleCollection = (id: string) =>
    setSelectedCollections((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  if (step === 1) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">New Motion — Step 1 of 2: Pick a template</h1>
        <div className="grid gap-3 md:grid-cols-3">
          {templates?.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTemplateId(t.id); setTitle(t.name); }}
              className={`rounded-md border p-4 text-left hover:bg-gray-50 ${templateId === t.id ? "border-blue-600 bg-blue-50" : "border-gray-200"}`}
            >
              <div className="font-semibold">{t.name}</div>
              <div className="mt-1 text-xs text-gray-600">{t.description}</div>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!templateId}
            onClick={() => setStep(2)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Next: Attach research
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">New Motion — Step 2 of 2: Attach research & title</h1>

      <div>
        <label className="block text-sm font-medium">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 p-2"
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold">Research memos</h2>
        {suggestions?.memos.length === 0 && (
          <p className="mt-1 text-sm text-amber-700">
            No research memos on this case yet. Argument generation will be disabled until you attach at least one memo (create via 2.2.3 Research Memos).
          </p>
        )}
        <ul className="mt-2 space-y-1">
          {suggestions?.memos.map((m) => (
            <li key={m.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedMemos.includes(m.id)} onChange={() => toggleMemo(m.id)} />
                {m.title}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="text-sm font-semibold">Research collections</h2>
        <ul className="mt-2 space-y-1">
          {suggestions?.collections.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedCollections.includes(c.id)} onChange={() => toggleCollection(c.id)} />
                {c.name}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex justify-between">
        <button type="button" onClick={() => setStep(1)} className="rounded-md border px-4 py-2 text-sm">Back</button>
        <button
          type="button"
          disabled={!templateId || !title || create.isPending}
          onClick={() =>
            templateId &&
            create.mutate({ caseId, templateId, title, memoIds: selectedMemos, collectionIds: selectedCollections })
          }
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create draft"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create new-motion route**

```tsx
// src/app/(app)/cases/[id]/motions/new/page.tsx
import { MotionWizard } from "@/components/cases/motions/motion-wizard";

export default async function NewMotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-4xl p-6">
      <MotionWizard caseId={id} />
    </div>
  );
}
```

- [ ] **Step 3: Dev server smoke**

Navigate to `/cases/<caseId>/motions/new`. Step 1 shows 3 templates. Pick MTD → Next. Step 2 shows memo/collection suggestions (possibly empty). Enter a title → "Create draft" → redirects to detail route (404 expected until Task 13).

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/motions/motion-wizard.tsx "src/app/(app)/cases/[id]/motions/new/page.tsx"
git commit -m "feat(2.4.2): motion wizard (template + attachments + create)"
```

---

### Task 13: Motion detail view + Mark-as-Filed modal

**Files:**
- Create: `src/components/cases/motions/motion-detail.tsx`
- Create: `src/app/(app)/cases/[id]/motions/[motionId]/page.tsx`

- [ ] **Step 1: Implement detail component**

```tsx
// src/components/cases/motions/motion-detail.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { SectionEditor } from "./section-editor";

export function MotionDetail({ caseId, motionId }: { caseId: string; motionId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: motion, refetch } = trpc.motions.get.useQuery({ motionId });
  const [showFileModal, setShowFileModal] = useState(false);
  const [createTrigger, setCreateTrigger] = useState(true);
  const [filedAt, setFiledAt] = useState(() => new Date().toISOString().slice(0, 16));

  const markFiled = trpc.motions.markFiled.useMutation({
    onSuccess: () => {
      setShowFileModal(false);
      refetch();
      utils.motions.list.invalidate({ caseId });
    },
  });

  const del = trpc.motions.delete.useMutation({
    onSuccess: () => router.push(`/cases/${caseId}`),
  });

  if (!motion) return <p className="p-6 text-sm text-gray-500">Loading…</p>;

  const sections = motion.sections as Record<string, { text: string; citations: Array<{ memoId: string; snippet: string }> } | undefined>;
  const isFiled = motion.status === "filed";
  const noMemos = motion.attachedMemoIds.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{motion.title}</h1>
          <p className="text-sm text-gray-600">Status: {motion.status}</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/motions/${motionId}/docx`} className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50">
            Export DOCX
          </a>
          {!isFiled && (
            <>
              <button
                type="button"
                onClick={() => setShowFileModal(true)}
                className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
              >
                Mark as Filed
              </button>
              <button
                type="button"
                onClick={() => confirm("Delete this draft?") && del.mutate({ motionId })}
                className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </header>

      {noMemos && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          No research memos attached. Argument generation is disabled until you attach a memo.
        </div>
      )}

      <SectionEditor
        motionId={motionId}
        sectionKey="facts"
        heading="Statement of Facts"
        initialText={sections.facts?.text ?? ""}
        initialCitations={sections.facts?.citations ?? []}
        onUpdated={() => refetch()}
      />
      <SectionEditor
        motionId={motionId}
        sectionKey="argument"
        heading="Argument"
        initialText={sections.argument?.text ?? ""}
        initialCitations={sections.argument?.citations ?? []}
        onUpdated={() => refetch()}
      />
      <SectionEditor
        motionId={motionId}
        sectionKey="conclusion"
        heading="Conclusion"
        initialText={sections.conclusion?.text ?? ""}
        initialCitations={sections.conclusion?.citations ?? []}
        onUpdated={() => refetch()}
      />

      {showFileModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-md bg-white p-6">
            <h2 className="text-lg font-semibold">Mark motion as filed</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                Filed at
                <input
                  type="datetime-local"
                  value={filedAt}
                  onChange={(e) => setFiledAt(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 p-2"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createTrigger}
                  onChange={(e) => setCreateTrigger(e.target.checked)}
                />
                Create filing deadlines (opposition / reply briefs) from this motion
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setShowFileModal(false)} className="rounded-md border px-3 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={markFiled.isPending}
                onClick={() => markFiled.mutate({ motionId, filedAt: new Date(filedAt).toISOString(), createTrigger })}
                className="rounded-md bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {markFiled.isPending ? "Filing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create detail route**

```tsx
// src/app/(app)/cases/[id]/motions/[motionId]/page.tsx
import { MotionDetail } from "@/components/cases/motions/motion-detail";

export default async function MotionDetailPage({ params }: { params: Promise<{ id: string; motionId: string }> }) {
  const { id, motionId } = await params;
  return <MotionDetail caseId={id} motionId={motionId} />;
}
```

- [ ] **Step 3: Dev server full flow smoke**

Walk end-to-end: new motion → detail → type Facts → Save → Export DOCX (verify download opens in Word). Mark as Filed with "create deadlines" checked → deadline appears on case Deadlines tab.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/motions/motion-detail.tsx "src/app/(app)/cases/[id]/motions/[motionId]/page.tsx"
git commit -m "feat(2.4.2): motion detail view + mark-as-filed with deadline trigger"
```

---

### Task 14: E2E smoke test

**Files:**
- Create: `e2e/motion-generator-smoke.spec.ts`

- [ ] **Step 0: Copy auth pattern from deadlines-smoke**

Run: `cat e2e/deadlines-smoke.spec.ts` — copy its login/helper pattern verbatim into the new spec below.

- [ ] **Step 1: Write E2E smoke**

```ts
// e2e/motion-generator-smoke.spec.ts
import { test, expect } from "@playwright/test";

test.describe("2.4.2 Motion Generator smoke", () => {
  test("motions tab renders and wizard step 1 shows all 3 templates", async ({ page }) => {
    // TODO: replace with the login/fixture helper used in e2e/deadlines-smoke.spec.ts.
    await page.goto("/cases");
    await page.getByRole("link").first().click();

    await page.getByRole("button", { name: /motions/i }).click();
    await expect(page.getByRole("heading", { name: /motions/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /new motion/i })).toBeVisible();

    await page.getByRole("link", { name: /new motion/i }).click();
    await expect(page.getByText(/Step 1 of 2/i)).toBeVisible();
    await expect(page.getByText(/Motion to Dismiss/i)).toBeVisible();
    await expect(page.getByText(/Motion for Summary Judgment/i)).toBeVisible();
    await expect(page.getByText(/Motion to Compel/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E**

Run: `npx playwright test e2e/motion-generator-smoke.spec.ts`
Expected: PASS (after copying the actual auth setup from the reference spec).

- [ ] **Step 3: Commit**

```bash
git add e2e/motion-generator-smoke.spec.ts
git commit -m "test(2.4.2): E2E smoke for motion wizard"
```

---

### Task 15: Integration test for tRPC happy path

**Files:**
- Create: `tests/integration/motions-router.test.ts`

- [ ] **Step 0: Find existing integration-test fixture helpers**

Run: `grep -rn "createCaller\|createTestOrg\|createTestUser\|createTestCase" tests/ | head` — match the project's actual helpers. If none exist and the project has no `tests/integration/` folder with caller-style tests, skip this task and rely on E2E smoke (note the skip in the final commit message).

- [ ] **Step 1: Write integration test**

```ts
// tests/integration/motions-router.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { createCaller } from "@/server/trpc/root";
import { db } from "@/server/db";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import { eq, and, isNull } from "drizzle-orm";
import { seedMotionTemplates } from "@/server/db/seed/motion-templates";
import { createTestOrg, createTestUser, createTestCase } from "../helpers/fixtures";

describe("motions router — happy path", () => {
  let orgId: string;
  let userId: string;
  let caseId: string;
  let caller: ReturnType<typeof createCaller>;

  beforeAll(async () => {
    await seedMotionTemplates();
    orgId = await createTestOrg();
    userId = await createTestUser(orgId);
    caseId = await createTestCase({ orgId, plaintiff: "Alice", defendant: "Bob", caseNumber: "1:26-cv-1" });
    caller = createCaller({ db, orgId, userId } as never);
  });

  it("lists 3 global seed templates", async () => {
    const tpls = await caller.motions.listTemplates();
    expect(tpls.length).toBeGreaterThanOrEqual(3);
    expect(tpls.map((t) => t.motionType).sort()).toEqual(
      expect.arrayContaining(["motion_to_dismiss", "motion_for_summary_judgment", "motion_to_compel"]),
    );
  });

  it("creates, lists, updates, and prevents delete on filed motion", async () => {
    const [tpl] = await db
      .select()
      .from(motionTemplates)
      .where(and(isNull(motionTemplates.orgId), eq(motionTemplates.slug, "motion_to_dismiss_12b6")))
      .limit(1);

    const m = await caller.motions.create({ caseId, templateId: tpl!.id, title: "MTD 1", memoIds: [], collectionIds: [] });
    expect(m.status).toBe("draft");

    await caller.motions.updateSection({ motionId: m.id, sectionKey: "facts", text: "Plaintiff sued in NY." });
    const reloaded = await caller.motions.get({ motionId: m.id });
    expect((reloaded.sections as Record<string, { text: string }>).facts.text).toBe("Plaintiff sued in NY.");

    const filed = await caller.motions.markFiled({ motionId: m.id, filedAt: new Date().toISOString(), createTrigger: true });
    expect(filed.triggerEventId).toBeTruthy();

    const deadlines = await db.select().from(caseDeadlines).where(eq(caseDeadlines.caseId, caseId));
    expect(deadlines.length).toBeGreaterThan(0);

    await expect(caller.motions.delete({ motionId: m.id })).rejects.toThrow(/Filed motions/);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/integration/motions-router.test.ts`
Expected: 2 passing (or skipped with note if fixture helpers don't exist).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/motions-router.test.ts
git commit -m "test(2.4.2): integration test for motions router"
```

---

### Task 16: Full suite + push + PR

- [ ] **Step 1: Full test run**

Run: `npx vitest run && npx playwright test`
Expected: all existing tests still pass, new tests pass. Fix regressions before proceeding.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Push branch**

```bash
git push -u origin feature/2.4.2-motion-generator
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat(2.4.2): motion generator (MTD / MSJ / Compel)" --body "$(cat <<'PRBODY'
## Summary
- Hybrid template + AI motion drafting for Motion to Dismiss 12(b)(6), Motion for Summary Judgment (Rule 56), Motion to Compel (Rule 37)
- 2-step wizard: pick template → attach auto-suggested research memos → section-level AI drafting with per-section regenerate → DOCX export
- Mandatory research-memo grounding for Argument section — no hallucinated citations
- Mark-as-Filed optionally creates 2.4.1 deadline trigger (opposition / reply brief rules seeded in migration 0021)

## Test plan
- [ ] `npx vitest run` — unit + integration green
- [ ] `npx playwright test e2e/motion-generator-smoke.spec.ts` — E2E smoke green
- [ ] Manual: generate Motion to Dismiss with a research memo attached, verify Argument regenerates with "from: <Memo Name>" provenance
- [ ] Manual: Export DOCX, verify opens cleanly in Word with caption / headings / signature block
- [ ] Manual: Mark as Filed with "create deadlines" checked → opposition-brief deadline appears on Deadlines tab
- [ ] Manual: attempt generation without ANTHROPIC_API_KEY — verify clear error UI

## Spec
`docs/superpowers/specs/2026-04-23-motion-generator-design.md`

## Non-goals (deferred to 2.4.2b)
State courts, per-court local rules, opposition/reply drafting, firm-custom templates, WYSIWYG editor, PDF export.
PRBODY
)"
```

- [ ] **Step 5: Record PR URL and update memory**

Record the PR URL. Update `project_242_execution.md` in memory with PR number, commit count, test counts, merge status.

---

## Self-Review Checklist

**Spec coverage:** All 10 spec decisions mapped to tasks — hybrid model (T3/T4/T5), 3-motion library (T3 seed), mandatory memo grounding (T4 NoMemosAttachedError + T7 router), generic federal caption (T5 captionParagraphs), DOCX-only (T5/T9), section textareas (T11), draft→filed + optional trigger prompt (T8/T13), motion-specific deadline rules seed (T1), no-key gating (T7 PRECONDITION_FAILED), citation provenance UI (T11 citations list).

**Placeholder scan:** Four verification steps flagged inline (T6 Step 0, T8 Step 0, T9 Step 0, T10 Step 0, T14 Step 0, T15 Step 0) where the implementer must confirm real column names, service helper names, and test fixture helpers before writing code. These are verification instructions, not placeholders for logic — every task body contains complete code.

**Type consistency:** `MotionType` literal union is identical across types.ts (T2), prompts.ts (T3), seed (T3), draft.ts (T4), router (T7). `SectionKey` is `"facts" | "argument" | "conclusion"` everywhere. `MotionCaption` / `MotionSections` / `MotionSkeleton` flow through DOCX renderer (T5), router (T6/T7/T8), download route (T9), detail view (T13). Migration SQL column names match Drizzle schema column names.
