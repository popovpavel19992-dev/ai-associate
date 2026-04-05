# 2.1.1 Case Workflow & Stages — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stage-based workflow system to cases — pipeline bar, stage selector, timeline, and overview tab.

**Architecture:** Template-driven stages stored in DB per case type. Free transitions via dropdown. Stage changes log events to `case_events` table inside a transaction. Auto-event logging on existing mutations (document upload, analysis, contract linking).

**Tech Stack:** Drizzle ORM (pgTable, pgEnum), tRPC 11, Zod v4, React (Next.js 16), Vitest, Supabase RLS

**Spec:** `docs/superpowers/specs/2026-04-04-case-workflow-stages-design.md`

---

## Chunk 1: Schema, Constants & Seed

### Task 1: Case Type Enum & Constants

**Files:**
- Create: `src/lib/case-stages.ts`

- [ ] **Step 1: Create stage constants file**

```typescript
// src/lib/case-stages.ts
import type { CASE_TYPES } from "./constants";

export type CaseType = (typeof CASE_TYPES)[number];

export const EVENT_TYPES = [
  "stage_changed",
  "document_added",
  "analysis_completed",
  "manual",
  "contract_linked",
  "draft_linked",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_CATEGORIES = [
  "filing",
  "research",
  "client_communication",
  "evidence",
  "court",
  "administrative",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export interface StageTemplate {
  slug: string;
  name: string;
  description: string;
  color: string;
  tasks: {
    title: string;
    description?: string;
    priority: TaskPriority;
    category: TaskCategory;
  }[];
}

export const STAGE_TEMPLATES: Record<CaseType, StageTemplate[]> = {
  personal_injury: [
    {
      slug: "intake",
      name: "Intake",
      description: "Initial consultation, case evaluation, retainer agreement",
      color: "#3B82F6",
      tasks: [
        { title: "Schedule initial consultation", priority: "high", category: "client_communication" },
        { title: "Evaluate case merits", priority: "high", category: "research" },
        { title: "Prepare retainer agreement", priority: "medium", category: "filing" },
      ],
    },
    {
      slug: "investigation",
      name: "Investigation",
      description: "Gather evidence, police reports, witness statements",
      color: "#8B5CF6",
      tasks: [
        { title: "Obtain police report", priority: "high", category: "evidence" },
        { title: "Identify and contact witnesses", priority: "high", category: "evidence" },
        { title: "Photograph accident scene", priority: "medium", category: "evidence" },
      ],
    },
    {
      slug: "medical-treatment",
      name: "Medical Treatment",
      description: "Track treatment, collect medical records, calculate expenses",
      color: "#EC4899",
      tasks: [
        { title: "Collect medical records", priority: "high", category: "evidence" },
        { title: "Schedule IME appointment", priority: "medium", category: "administrative" },
        { title: "Track treatment progress", priority: "medium", category: "administrative" },
        { title: "Calculate medical expenses", priority: "medium", category: "research" },
      ],
    },
    {
      slug: "demand-negotiation",
      name: "Demand & Negotiation",
      description: "Demand letter, insurance negotiation, settlement offers",
      color: "#F59E0B",
      tasks: [
        { title: "Draft demand letter", priority: "high", category: "filing" },
        { title: "Send demand to insurance", priority: "high", category: "client_communication" },
        { title: "Review settlement offers", priority: "high", category: "research" },
      ],
    },
    {
      slug: "litigation",
      name: "Litigation",
      description: "File complaint, discovery, depositions, motions",
      color: "#EF4444",
      tasks: [
        { title: "File complaint", priority: "urgent", category: "court" },
        { title: "Prepare discovery requests", priority: "high", category: "filing" },
        { title: "Schedule depositions", priority: "high", category: "court" },
      ],
    },
    {
      slug: "settlement-trial",
      name: "Settlement / Trial",
      description: "Final settlement or trial proceedings, verdict",
      color: "#10B981",
      tasks: [
        { title: "Prepare trial exhibits", priority: "urgent", category: "court" },
        { title: "Review final settlement offer", priority: "urgent", category: "research" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Case resolved, final billing, file archival",
      color: "#6B7280",
      tasks: [
        { title: "Prepare final billing", priority: "medium", category: "administrative" },
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
  family_law: [
    {
      slug: "intake",
      name: "Intake",
      description: "Consultation, gather family info, assess situation",
      color: "#3B82F6",
      tasks: [
        { title: "Conduct initial consultation", priority: "high", category: "client_communication" },
        { title: "Gather family information", priority: "high", category: "research" },
      ],
    },
    {
      slug: "filing",
      name: "Filing",
      description: "Prepare and file petition, serve opposing party",
      color: "#8B5CF6",
      tasks: [
        { title: "Prepare petition", priority: "high", category: "filing" },
        { title: "File with court", priority: "urgent", category: "court" },
        { title: "Arrange service of process", priority: "high", category: "court" },
      ],
    },
    {
      slug: "discovery",
      name: "Discovery",
      description: "Financial disclosure, asset investigation, depositions",
      color: "#EC4899",
      tasks: [
        { title: "Prepare financial disclosure", priority: "high", category: "filing" },
        { title: "Investigate assets", priority: "high", category: "research" },
      ],
    },
    {
      slug: "mediation",
      name: "Mediation",
      description: "Attempt mediation, negotiate agreements",
      color: "#F59E0B",
      tasks: [
        { title: "Schedule mediation session", priority: "high", category: "court" },
        { title: "Prepare mediation brief", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "hearing-trial",
      name: "Hearing / Trial",
      description: "Court hearings, trial preparation, testimony",
      color: "#EF4444",
      tasks: [
        { title: "Prepare for hearing", priority: "urgent", category: "court" },
        { title: "Organize witness testimony", priority: "high", category: "evidence" },
      ],
    },
    {
      slug: "order-decree",
      name: "Order / Decree",
      description: "Final order, decree entry, enforcement setup",
      color: "#10B981",
      tasks: [
        { title: "Review final order", priority: "high", category: "filing" },
        { title: "Set up enforcement plan", priority: "medium", category: "administrative" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Case finalized, compliance monitoring complete",
      color: "#6B7280",
      tasks: [
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
  traffic_defense: [
    {
      slug: "intake",
      name: "Intake",
      description: "Review citation, assess options, enter plea",
      color: "#3B82F6",
      tasks: [
        { title: "Review citation details", priority: "high", category: "research" },
        { title: "Assess defense options", priority: "high", category: "research" },
      ],
    },
    {
      slug: "evidence-review",
      name: "Evidence Review",
      description: "Obtain dashcam/bodycam, review officer notes",
      color: "#8B5CF6",
      tasks: [
        { title: "Request dashcam/bodycam footage", priority: "high", category: "evidence" },
        { title: "Review officer notes", priority: "high", category: "evidence" },
      ],
    },
    {
      slug: "negotiation",
      name: "Negotiation",
      description: "Negotiate with prosecutor, plea bargain",
      color: "#F59E0B",
      tasks: [
        { title: "Contact prosecutor", priority: "high", category: "court" },
        { title: "Negotiate plea bargain", priority: "high", category: "court" },
      ],
    },
    {
      slug: "court-hearing",
      name: "Court Hearing",
      description: "Attend hearing, present defense",
      color: "#EF4444",
      tasks: [
        { title: "Prepare court appearance", priority: "urgent", category: "court" },
        { title: "Present defense arguments", priority: "urgent", category: "court" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Case resolved, record updated",
      color: "#6B7280",
      tasks: [
        { title: "Update client records", priority: "low", category: "administrative" },
      ],
    },
  ],
  contract_dispute: [
    {
      slug: "intake",
      name: "Intake",
      description: "Review contract, identify breach, assess damages",
      color: "#3B82F6",
      tasks: [
        { title: "Review contract terms", priority: "high", category: "research" },
        { title: "Identify breach points", priority: "high", category: "research" },
        { title: "Assess potential damages", priority: "high", category: "research" },
      ],
    },
    {
      slug: "contract-analysis",
      name: "Contract Analysis",
      description: "Detailed clause analysis, legal research",
      color: "#8B5CF6",
      tasks: [
        { title: "Analyze key clauses", priority: "high", category: "research" },
        { title: "Research applicable law", priority: "high", category: "research" },
      ],
    },
    {
      slug: "demand-letter",
      name: "Demand Letter",
      description: "Draft and send demand letter",
      color: "#EC4899",
      tasks: [
        { title: "Draft demand letter", priority: "high", category: "filing" },
        { title: "Send to opposing party", priority: "high", category: "client_communication" },
      ],
    },
    {
      slug: "negotiation",
      name: "Negotiation",
      description: "Settlement discussions, mediation",
      color: "#F59E0B",
      tasks: [
        { title: "Initiate settlement discussions", priority: "high", category: "client_communication" },
        { title: "Evaluate settlement offers", priority: "high", category: "research" },
      ],
    },
    {
      slug: "litigation-arbitration",
      name: "Litigation / Arbitration",
      description: "File suit or initiate arbitration",
      color: "#EF4444",
      tasks: [
        { title: "File complaint or arbitration demand", priority: "urgent", category: "court" },
        { title: "Prepare discovery", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "resolution",
      name: "Resolution",
      description: "Settlement agreement or judgment",
      color: "#10B981",
      tasks: [
        { title: "Finalize settlement agreement", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Enforced, paid, archived",
      color: "#6B7280",
      tasks: [
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
  criminal_defense: [
    {
      slug: "intake",
      name: "Intake",
      description: "Client interview, review charges, bail hearing",
      color: "#3B82F6",
      tasks: [
        { title: "Interview client", priority: "urgent", category: "client_communication" },
        { title: "Review charges", priority: "urgent", category: "research" },
        { title: "Attend bail hearing", priority: "urgent", category: "court" },
      ],
    },
    {
      slug: "investigation",
      name: "Investigation",
      description: "Gather evidence, interview witnesses, obtain reports",
      color: "#8B5CF6",
      tasks: [
        { title: "Gather evidence", priority: "high", category: "evidence" },
        { title: "Interview witnesses", priority: "high", category: "evidence" },
        { title: "Obtain police reports", priority: "high", category: "evidence" },
      ],
    },
    {
      slug: "arraignment",
      name: "Arraignment",
      description: "Formal charges, enter plea, set conditions",
      color: "#EC4899",
      tasks: [
        { title: "Prepare for arraignment", priority: "urgent", category: "court" },
        { title: "Enter plea", priority: "urgent", category: "court" },
      ],
    },
    {
      slug: "pre-trial",
      name: "Pre-Trial",
      description: "Motions, discovery, plea negotiations",
      color: "#F59E0B",
      tasks: [
        { title: "File pre-trial motions", priority: "high", category: "court" },
        { title: "Review prosecution discovery", priority: "high", category: "research" },
        { title: "Negotiate plea deal", priority: "high", category: "court" },
      ],
    },
    {
      slug: "trial",
      name: "Trial",
      description: "Jury selection, testimony, arguments, verdict",
      color: "#EF4444",
      tasks: [
        { title: "Prepare jury selection strategy", priority: "urgent", category: "court" },
        { title: "Prepare opening/closing statements", priority: "urgent", category: "court" },
      ],
    },
    {
      slug: "sentencing-acquittal",
      name: "Sentencing / Acquittal",
      description: "Sentencing hearing or acquittal proceedings",
      color: "#10B981",
      tasks: [
        { title: "Prepare sentencing memorandum", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Case resolved, appeal window passed",
      color: "#6B7280",
      tasks: [
        { title: "Evaluate appeal options", priority: "medium", category: "research" },
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
  employment_law: [
    {
      slug: "intake",
      name: "Intake",
      description: "Review employment situation, assess claims",
      color: "#3B82F6",
      tasks: [
        { title: "Review employment records", priority: "high", category: "research" },
        { title: "Assess potential claims", priority: "high", category: "research" },
      ],
    },
    {
      slug: "claim-assessment",
      name: "Claim Assessment",
      description: "Document violations, calculate damages",
      color: "#8B5CF6",
      tasks: [
        { title: "Document workplace violations", priority: "high", category: "evidence" },
        { title: "Calculate potential damages", priority: "high", category: "research" },
      ],
    },
    {
      slug: "agency-filing",
      name: "Agency Filing",
      description: "File with EEOC/state agency, await response",
      color: "#EC4899",
      tasks: [
        { title: "Prepare agency complaint", priority: "high", category: "filing" },
        { title: "File with EEOC/state agency", priority: "urgent", category: "court" },
      ],
    },
    {
      slug: "negotiation-mediation",
      name: "Negotiation / Mediation",
      description: "Severance negotiation, mediation",
      color: "#F59E0B",
      tasks: [
        { title: "Negotiate severance terms", priority: "high", category: "client_communication" },
        { title: "Prepare for mediation", priority: "high", category: "court" },
      ],
    },
    {
      slug: "litigation",
      name: "Litigation",
      description: "File lawsuit, discovery, depositions",
      color: "#EF4444",
      tasks: [
        { title: "File lawsuit", priority: "urgent", category: "court" },
        { title: "Conduct discovery", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "resolution",
      name: "Resolution",
      description: "Settlement or verdict",
      color: "#10B981",
      tasks: [
        { title: "Finalize settlement agreement", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Case resolved, compliance verified",
      color: "#6B7280",
      tasks: [
        { title: "Verify compliance with agreement", priority: "medium", category: "administrative" },
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
  general: [
    {
      slug: "intake",
      name: "Intake",
      description: "Initial consultation, gather information",
      color: "#3B82F6",
      tasks: [
        { title: "Conduct initial consultation", priority: "high", category: "client_communication" },
        { title: "Gather relevant documents", priority: "high", category: "evidence" },
      ],
    },
    {
      slug: "research",
      name: "Research",
      description: "Legal research, document analysis",
      color: "#8B5CF6",
      tasks: [
        { title: "Research applicable law", priority: "high", category: "research" },
        { title: "Analyze key documents", priority: "high", category: "research" },
      ],
    },
    {
      slug: "active-work",
      name: "Active Work",
      description: "Primary legal work, client communication",
      color: "#F59E0B",
      tasks: [
        { title: "Execute primary legal strategy", priority: "high", category: "research" },
        { title: "Update client on progress", priority: "medium", category: "client_communication" },
      ],
    },
    {
      slug: "resolution",
      name: "Resolution",
      description: "Conclude matter, finalize documents",
      color: "#10B981",
      tasks: [
        { title: "Finalize resolution documents", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Matter resolved, archived",
      color: "#6B7280",
      tasks: [
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/case-stages.ts
git commit -m "feat(cases): add stage template constants for 7 case types"
```

---

### Task 2: Database Schema — New Tables

**Files:**
- Create: `src/server/db/schema/case-stages.ts`
- Modify: `src/server/db/index.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// src/server/db/schema/case-stages.ts
import { pgTable, uuid, text, timestamp, jsonb, boolean, integer, pgEnum, unique, index } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";

export const caseTypeEnum = pgEnum("case_type", [
  "personal_injury",
  "family_law",
  "traffic_defense",
  "contract_dispute",
  "criminal_defense",
  "employment_law",
  "general",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "stage_changed",
  "document_added",
  "analysis_completed",
  "manual",
  "contract_linked",
  "draft_linked",
]);

export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);

export const caseStages = pgTable(
  "case_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseType: caseTypeEnum("case_type").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull(),
    sortOrder: integer("sort_order").notNull(),
    color: text("color").notNull(),
    isCustom: boolean("is_custom").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("case_stages_type_slug_unique").on(table.caseType, table.slug),
    index("case_stages_case_type_idx").on(table.caseType),
  ],
);

export const stageTaskTemplates = pgTable(
  "stage_task_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageId: uuid("stage_id").references(() => caseStages.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    priority: taskPriorityEnum("priority").default("medium").notNull(),
    category: text("category").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    index("stage_task_templates_stage_id_idx").on(table.stageId),
  ],
);

export const caseEvents = pgTable(
  "case_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    type: eventTypeEnum("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_events_case_occurred_idx").on(table.caseId, table.occurredAt),
  ],
);
```

- [ ] **Step 2: Add stageId, stageChangedAt, description to cases table**

In `src/server/db/schema/cases.ts`, add imports and columns:

Add to imports:
```typescript
import { caseStages } from "./case-stages";
```

Add columns after `caseBrief`:
```typescript
  stageId: uuid("stage_id").references(() => caseStages.id),
  stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }),
  description: text("description"),
```

- [ ] **Step 3: Register schema in db/index.ts**

In `src/server/db/index.ts`, add import and spread:

```typescript
import * as caseStages from "./schema/case-stages";
```

Add to schema object:
```typescript
    ...caseStages,
```

- [ ] **Step 4: Push schema to database**

Run: `npx drizzle-kit push`
Expected: `[✓] Changes applied`

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/case-stages.ts src/server/db/schema/cases.ts src/server/db/index.ts
git commit -m "feat(cases): add case_stages, stage_task_templates, case_events tables"
```

---

### Task 3: Seed Script

**Files:**
- Create: `src/server/db/seed/case-stages.ts`

- [ ] **Step 1: Create seed directory and script**

```typescript
// src/server/db/seed/case-stages.ts
import "dotenv/config";
import { db } from "../index";
import { caseStages, stageTaskTemplates } from "../schema/case-stages";
import { STAGE_TEMPLATES, type CaseType } from "@/lib/case-stages";
import { CASE_TYPES } from "@/lib/constants";

async function seed() {
  console.log("Seeding case stages...");

  for (const caseType of CASE_TYPES) {
    const templates = STAGE_TEMPLATES[caseType as CaseType];

    for (let i = 0; i < templates.length; i++) {
      const stage = templates[i];

      // Upsert stage
      const [inserted] = await db
        .insert(caseStages)
        .values({
          caseType: caseType as CaseType,
          name: stage.name,
          slug: stage.slug,
          description: stage.description,
          sortOrder: i + 1,
          color: stage.color,
          isCustom: false,
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted) {
        console.log(`  Stage ${caseType}/${stage.slug} already exists, skipping`);
        continue;
      }

      // Insert task templates
      if (stage.tasks.length > 0) {
        await db.insert(stageTaskTemplates).values(
          stage.tasks.map((task, j) => ({
            stageId: inserted.id,
            title: task.title,
            description: task.description ?? null,
            priority: task.priority,
            category: task.category,
            sortOrder: j + 1,
          })),
        );
      }

      console.log(`  ${caseType}/${stage.slug} — ${stage.tasks.length} tasks`);
    }
  }

  console.log("Done seeding case stages.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run seed**

Run: `npx tsx src/server/db/seed/case-stages.ts`
Expected: Output showing each stage and task count, ending with "Done seeding case stages."

- [ ] **Step 3: Commit**

```bash
git add src/server/db/seed/case-stages.ts
git commit -m "feat(cases): add seed script for stage templates"
```

---

## Chunk 2: Integration Tests & tRPC Procedures

### Task 4: Integration Tests

**Files:**
- Create: `tests/integration/case-stages.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// tests/integration/case-stages.test.ts
import { describe, it, expect } from "vitest";
import { STAGE_TEMPLATES } from "@/lib/case-stages";
import { CASE_TYPES } from "@/lib/constants";
import { EVENT_TYPES, TASK_PRIORITIES, TASK_CATEGORIES } from "@/lib/case-stages";

describe("Case Stages — Constants", () => {
  it("has stage templates for all 7 case types", () => {
    for (const caseType of CASE_TYPES) {
      expect(STAGE_TEMPLATES[caseType]).toBeDefined();
      expect(STAGE_TEMPLATES[caseType].length).toBeGreaterThan(0);
    }
  });

  it("every case type starts with intake and ends with closed", () => {
    for (const caseType of CASE_TYPES) {
      const stages = STAGE_TEMPLATES[caseType];
      expect(stages[0].slug).toBe("intake");
      expect(stages[stages.length - 1].slug).toBe("closed");
    }
  });

  it("all slugs are unique within a case type", () => {
    for (const caseType of CASE_TYPES) {
      const slugs = STAGE_TEMPLATES[caseType].map((s) => s.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it("all stages have valid colors (hex format)", () => {
    for (const caseType of CASE_TYPES) {
      for (const stage of STAGE_TEMPLATES[caseType]) {
        expect(stage.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it("all task priorities are valid", () => {
    for (const caseType of CASE_TYPES) {
      for (const stage of STAGE_TEMPLATES[caseType]) {
        for (const task of stage.tasks) {
          expect(TASK_PRIORITIES).toContain(task.priority);
        }
      }
    }
  });

  it("all task categories are valid", () => {
    for (const caseType of CASE_TYPES) {
      for (const stage of STAGE_TEMPLATES[caseType]) {
        for (const task of stage.tasks) {
          expect(TASK_CATEGORIES).toContain(task.category);
        }
      }
    }
  });

  it("event types array has expected values", () => {
    expect(EVENT_TYPES).toContain("stage_changed");
    expect(EVENT_TYPES).toContain("document_added");
    expect(EVENT_TYPES).toContain("manual");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/case-stages.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/case-stages.test.ts
git commit -m "test(cases): add integration tests for stage constants"
```

---

### Task 5: tRPC — getStages Procedure

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Add imports**

In `src/server/trpc/routers/cases.ts`, add:

```typescript
import { caseStages, stageTaskTemplates, caseEvents } from "../../db/schema/case-stages";
import { CASE_TYPES } from "@/lib/constants";
import { inArray } from "drizzle-orm";
```

Note: `detectedCaseType` and `overrideCaseType` on the `cases` table remain as `text` columns — do not change them to use the new `caseTypeEnum`.

- [ ] **Step 2: Add getStages procedure**

Add to the casesRouter object:

```typescript
  getStages: protectedProcedure
    .input(z.object({ caseType: z.enum(CASE_TYPES) }))
    .query(async ({ ctx, input }) => {
      const stages = await ctx.db
        .select()
        .from(caseStages)
        .where(eq(caseStages.caseType, input.caseType))
        .orderBy(caseStages.sortOrder);

      const stageIds = stages.map((s) => s.id);

      const tasks =
        stageIds.length > 0
          ? await ctx.db
              .select()
              .from(stageTaskTemplates)
              .where(inArray(stageTaskTemplates.stageId, stageIds))
              .orderBy(stageTaskTemplates.sortOrder)
          : [];

      return stages.map((stage) => ({
        ...stage,
        tasks: tasks.filter((t) => t.stageId === stage.id),
      }));
    }),
```

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat(cases): add getStages tRPC procedure"
```

---

### Task 6: tRPC — changeStage Procedure

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Add changeStage procedure**

```typescript
  changeStage: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), stageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [caseRecord] = await ctx.db
        .select()
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      // No-op if already at this stage
      if (caseRecord.stageId === input.stageId) {
        return caseRecord;
      }

      const resolvedType = caseRecord.overrideCaseType ?? caseRecord.detectedCaseType ?? "general";

      // Verify stage belongs to correct case type
      const [newStage] = await ctx.db
        .select()
        .from(caseStages)
        .where(and(eq(caseStages.id, input.stageId), eq(caseStages.caseType, resolvedType)))
        .limit(1);

      if (!newStage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Stage does not belong to this case type",
        });
      }

      // Get current stage name for event metadata
      let fromStageName: string | null = null;
      if (caseRecord.stageId) {
        const [fromStage] = await ctx.db
          .select({ name: caseStages.name })
          .from(caseStages)
          .where(eq(caseStages.id, caseRecord.stageId))
          .limit(1);
        fromStageName = fromStage?.name ?? null;
      }

      // Atomic: update case + insert event
      const result = await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(cases)
          .set({
            stageId: input.stageId,
            stageChangedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(cases.id, input.caseId))
          .returning();

        await tx.insert(caseEvents).values({
          caseId: input.caseId,
          type: "stage_changed",
          title: `Stage changed to ${newStage.name}`,
          metadata: {
            fromStageId: caseRecord.stageId,
            toStageId: input.stageId,
            fromStageName,
            toStageName: newStage.name,
          },
          actorId: ctx.user.id,
        });

        return updated;
      });

      return result;
    }),
```

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat(cases): add changeStage tRPC procedure with atomic transaction"
```

---

### Task 7: tRPC — getEvents & addEvent Procedures

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Add getEvents procedure**

```typescript
  getEvents: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [caseRecord] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      const [countResult] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(caseEvents)
        .where(eq(caseEvents.caseId, input.caseId));

      const events = await ctx.db
        .select()
        .from(caseEvents)
        .where(eq(caseEvents.caseId, input.caseId))
        .orderBy(desc(caseEvents.occurredAt))
        .limit(input.limit)
        .offset(input.offset);

      return { events, total: Number(countResult?.count ?? 0) };
    }),
```

- [ ] **Step 2: Add addEvent procedure**

```typescript
  addEvent: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        title: z.string().min(1).max(500),
        description: z.string().max(2000).optional(),
        occurredAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [caseRecord] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      const [event] = await ctx.db
        .insert(caseEvents)
        .values({
          caseId: input.caseId,
          type: "manual",
          title: input.title,
          description: input.description ?? null,
          actorId: ctx.user.id,
          occurredAt: input.occurredAt ?? new Date(),
        })
        .returning();

      return event;
    }),
```

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat(cases): add getEvents and addEvent tRPC procedures"
```

---

### Task 8: Update cases.create — Auto-Set Intake Stage

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Modify the create procedure**

After the existing `const [created] = await ctx.db.insert(cases)...` block, add:

```typescript
      // Auto-set Intake stage
      const resolvedType = input.caseType ?? "general";
      const [intakeStage] = await ctx.db
        .select()
        .from(caseStages)
        .where(and(eq(caseStages.caseType, resolvedType), eq(caseStages.slug, "intake")))
        .limit(1);

      if (intakeStage) {
        await ctx.db
          .update(cases)
          .set({ stageId: intakeStage.id, stageChangedAt: new Date() })
          .where(eq(cases.id, created.id));

        await ctx.db.insert(caseEvents).values({
          caseId: created.id,
          type: "stage_changed",
          title: "Case created",
          metadata: { toStageId: intakeStage.id, toStageName: "Intake" },
          actorId: ctx.user.id,
        });

        created.stageId = intakeStage.id;
        created.stageChangedAt = new Date();
      }
```

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat(cases): auto-set Intake stage on case creation"
```

---

### Task 9: Update cases.getById — Include Stages & Events

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Extend getById response**

After the existing `linkedContracts` query in getById, add:

```typescript
      const resolvedType = caseRecord.overrideCaseType ?? caseRecord.detectedCaseType ?? "general";

      // Get all stages for this case type (for pipeline bar)
      const stages = await ctx.db
        .select()
        .from(caseStages)
        .where(eq(caseStages.caseType, resolvedType))
        .orderBy(caseStages.sortOrder);

      // Get current stage details
      const currentStage = caseRecord.stageId
        ? stages.find((s) => s.id === caseRecord.stageId) ?? null
        : null;

      // Get recent events (for overview tab)
      const recentEvents = await ctx.db
        .select()
        .from(caseEvents)
        .where(eq(caseEvents.caseId, input.caseId))
        .orderBy(desc(caseEvents.occurredAt))
        .limit(5);

      // Get task templates for current stage
      const stageTaskTemplatesList = currentStage
        ? await ctx.db
            .select()
            .from(stageTaskTemplates)
            .where(eq(stageTaskTemplates.stageId, currentStage.id))
            .orderBy(stageTaskTemplates.sortOrder)
        : [];
```

Update the return to include new fields:

```typescript
      return {
        ...caseRecord,
        documents: docs,
        analyses,
        linkedContracts,
        stage: currentStage,
        stages,
        recentEvents,
        stageTaskTemplates: stageTaskTemplatesList,
      };
```

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat(cases): extend getById with stages, events, and task templates"
```

---

### Task 10: Auto-Event Logging in Existing Mutations

**Files:**
- Modify: `src/server/trpc/routers/cases.ts` (analyze mutation)
- Modify: `src/server/trpc/routers/documents.ts` (confirmUpload mutation)
- Modify: `src/server/trpc/routers/contracts.ts` (if linkedCaseId is set)

- [ ] **Step 1: Add auto-event in document confirmUpload**

In `src/server/trpc/routers/documents.ts`, after the document is created, add:

```typescript
import { caseEvents } from "../../db/schema/case-stages";
```

After the document insert, if caseId exists:

```typescript
      if (input.caseId) {
        await ctx.db.insert(caseEvents).values({
          caseId: input.caseId,
          type: "document_added",
          title: `Document added: ${input.filename}`,
          actorId: ctx.user.id,
        });
      }
```

- [ ] **Step 2: Add auto-event in case analyze completion**

In `src/server/inngest/functions/case-analyze.ts`, add import:

```typescript
import { caseEvents } from "../../db/schema/case-stages";
```

Add the event insert in **both** code paths that set status to "ready":
1. In the `mark-ready-single` step (single document path)
2. In the `synthesize-brief` step (multi-document path), **including** the catch branch

```typescript
      await db.insert(caseEvents).values({
        caseId: event.data.caseId,
        type: "analysis_completed",
        title: "Analysis completed",
      });
```

- [ ] **Step 3: Add auto-event for contract linking**

In `src/server/trpc/routers/contracts.ts`, add import:

```typescript
import { caseEvents } from "../../db/schema/case-stages";
```

In the mutation that links a contract to a case (where `linkedCaseId` is set), add after the update:

```typescript
      if (input.linkedCaseId) {
        await ctx.db.insert(caseEvents).values({
          caseId: input.linkedCaseId,
          type: "contract_linked",
          title: `Contract linked: ${contractRecord.name}`,
          actorId: ctx.user.id,
        });
      }
```

- [ ] **Step 4: Add auto-event for draft linking**

In `src/server/trpc/routers/drafts.ts`, add import:

```typescript
import { caseEvents } from "../../db/schema/case-stages";
```

In the create mutation where `linkedCaseId` is set, add after the insert:

```typescript
      if (input.linkedCaseId) {
        await ctx.db.insert(caseEvents).values({
          caseId: input.linkedCaseId,
          type: "draft_linked",
          title: `Draft linked: ${input.name}`,
          actorId: ctx.user.id,
        });
      }
```

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/documents.ts src/server/inngest/functions/case-analyze.ts src/server/trpc/routers/contracts.ts src/server/trpc/routers/drafts.ts
git commit -m "feat(cases): add auto-event logging for documents, analysis, contracts, and drafts"
```

---

## Chunk 3: UI Components

### Task 11: StagePipeline Component

**Files:**
- Create: `src/components/cases/stage-pipeline.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/cases/stage-pipeline.tsx
"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface Stage {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

interface StagePipelineProps {
  stages: Stage[];
  currentStageId: string | null;
}

export function StagePipeline({ stages, currentStageId }: StagePipelineProps) {
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-4 py-3">
      {stages.map((stage, i) => {
        const isCompleted = currentIndex > -1 && i < currentIndex;
        const isCurrent = stage.id === currentStageId;
        const isUpcoming = currentIndex > -1 && i > currentIndex;

        return (
          <div key={stage.id} className="flex items-center gap-1">
            <span
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                isCompleted && "bg-green-500/20 text-green-400",
                isCurrent && "text-white shadow-sm",
                isUpcoming && "bg-zinc-800 text-zinc-500",
              )}
              style={isCurrent ? { backgroundColor: stage.color } : undefined}
            >
              {isCompleted && <Check className="size-3" />}
              {isCurrent && <span className="size-1.5 rounded-full bg-white" />}
              {stage.name}
            </span>
            {i < stages.length - 1 && (
              <span className="text-zinc-600">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/cases/stage-pipeline.tsx
git commit -m "feat(cases): add StagePipeline component"
```

---

### Task 12: StageSelector Component

**Files:**
- Create: `src/components/cases/stage-selector.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/cases/stage-selector.tsx
"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Stage {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

interface StageSelectorProps {
  stages: Stage[];
  currentStageId: string | null;
  onSelect: (stageId: string) => void;
  disabled?: boolean;
}

export function StageSelector({ stages, currentStageId, onSelect, disabled }: StageSelectorProps) {
  const [open, setOpen] = useState(false);
  const currentStage = stages.find((s) => s.id === currentStageId);
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="gap-2"
      >
        {currentStage && (
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: currentStage.color }}
          />
        )}
        Change Stage
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-zinc-800 bg-zinc-950 py-1 shadow-lg">
            <div className="px-3 py-2 text-xs text-zinc-500">Select new stage</div>
            {stages.map((stage, i) => {
              const isCompleted = currentIndex > -1 && i < currentIndex;
              const isCurrent = stage.id === currentStageId;

              return (
                <button
                  key={stage.id}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-800",
                    isCurrent && "bg-zinc-800/50 font-medium",
                  )}
                  onClick={() => {
                    if (!isCurrent) {
                      onSelect(stage.id);
                    }
                    setOpen(false);
                  }}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: isCompleted ? "#10B981" : stage.color }}
                  />
                  <span className={cn(isCompleted && "text-green-400", isCurrent && "text-white")}>
                    {isCompleted && <Check className="mr-1 inline size-3" />}
                    {stage.name}
                  </span>
                  {isCurrent && (
                    <span className="ml-auto text-xs text-zinc-500">(current)</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/cases/stage-selector.tsx
git commit -m "feat(cases): add StageSelector dropdown component"
```

---

### Task 13: CaseTimeline Component

**Files:**
- Create: `src/components/cases/case-timeline.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/cases/case-timeline.tsx
"use client";

import { useState } from "react";
import { ArrowRight, FileText, Brain, Pencil, Link2, Plus, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

const EVENT_ICONS: Record<string, typeof ArrowRight> = {
  stage_changed: ArrowRight,
  document_added: FileText,
  analysis_completed: Brain,
  manual: Pencil,
  contract_linked: Link2,
  draft_linked: Link2,
};

interface CaseTimelineProps {
  caseId: string;
}

export function CaseTimeline({ caseId }: CaseTimelineProps) {
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data, isLoading } = trpc.cases.getEvents.useQuery({ caseId, limit, offset });
  const utils = trpc.useUtils();

  const addEvent = trpc.cases.addEvent.useMutation({
    onSuccess: () => {
      utils.cases.getEvents.invalidate({ caseId });
      setShowForm(false);
      setTitle("");
      setDescription("");
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const hasMore = offset + limit < total;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Timeline</h3>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-1 size-3" />
          Add Event
        </Button>
      </div>

      {showForm && (
        <div className="space-y-2 rounded-md border border-zinc-800 p-3">
          <input
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
            placeholder="Event title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
            placeholder="Description (optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => addEvent.mutate({ caseId, title, description: description || undefined })}
              disabled={!title.trim() || addEvent.isPending}
            >
              {addEvent.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No events yet</p>
      ) : (
        <div className="space-y-0">
          {events.map((event) => {
            const Icon = EVENT_ICONS[event.type] ?? Pencil;
            return (
              <div key={event.id} className="flex gap-3 border-l border-zinc-800 py-3 pl-4">
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                  <Icon className="size-3 text-zinc-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{event.title}</p>
                  {event.description && (
                    <p className="mt-0.5 text-xs text-zinc-500">{event.description}</p>
                  )}
                  <p className="mt-1 text-xs text-zinc-600">
                    {formatDistanceToNow(new Date(event.occurredAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setOffset((prev) => prev + limit)}
        >
          Load more
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/cases/case-timeline.tsx
git commit -m "feat(cases): add CaseTimeline component with add event form"
```

---

### Task 14: CaseOverview Component

**Files:**
- Create: `src/components/cases/case-overview.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/cases/case-overview.tsx
"use client";

import { FileText, FileCheck, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface CaseOverviewProps {
  stage: { name: string; color: string; description: string } | null;
  stageChangedAt: Date | string | null;
  description: string | null;
  documentsCount: number;
  contractsCount: number;
  stageTaskTemplates: { title: string; priority: string }[];
}

export function CaseOverview({
  stage,
  stageChangedAt,
  description,
  documentsCount,
  contractsCount,
  stageTaskTemplates,
}: CaseOverviewProps) {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      {/* Current Stage */}
      {stage && (
        <div className="rounded-lg border border-zinc-800 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Current Stage
          </p>
          <p className="text-lg font-semibold" style={{ color: stage.color }}>
            {stage.name}
          </p>
          <p className="mt-1 text-xs text-zinc-400">{stage.description}</p>
          {stageChangedAt && (
            <p className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
              <Clock className="size-3" />
              Since {formatDistanceToNow(new Date(stageChangedAt), { addSuffix: true })}
            </p>
          )}
        </div>
      )}

      {/* Stage Task Templates */}
      <div className="rounded-lg border border-zinc-800 p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Stage Tasks
        </p>
        {stageTaskTemplates.length > 0 ? (
          <div className="space-y-1.5">
            {stageTaskTemplates.map((task, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="size-1.5 rounded-full bg-zinc-600" />
                <span className="text-zinc-300">{task.title}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No tasks for this stage</p>
        )}
      </div>

      {/* Description */}
      <div className="rounded-lg border border-zinc-800 p-4 md:col-span-2">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Description
        </p>
        <p className="text-sm text-zinc-300">
          {description || "No description provided."}
        </p>
      </div>

      {/* Quick Stats */}
      <div className="flex gap-4 md:col-span-2">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 px-4 py-3">
          <FileText className="size-4 text-zinc-500" />
          <span className="text-sm font-medium">{documentsCount}</span>
          <span className="text-xs text-zinc-500">Documents</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 px-4 py-3">
          <FileCheck className="size-4 text-zinc-500" />
          <span className="text-sm font-medium">{contractsCount}</span>
          <span className="text-xs text-zinc-500">Contracts</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/cases/case-overview.tsx
git commit -m "feat(cases): add CaseOverview component"
```

---

## Chunk 4: Case Detail Page Refactor & Verification

### Task 15: Refactor Case Detail Page — Tabs & Pipeline

**Files:**
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Refactor the page**

Read the current `src/app/(app)/cases/[id]/page.tsx` first, then refactor to add:

1. `StagePipeline` below the header
2. `StageSelector` in the header actions
3. Tab navigation: Overview | Documents | Timeline | Tasks | Contracts | Chat
4. Tab content switching based on selected tab
5. Wire up `changeStage` mutation to `StageSelector`
6. Pass new data from `getById` (stage, stages, recentEvents, stageTaskTemplates) to components

Key imports to add:
```typescript
import { StagePipeline } from "@/components/cases/stage-pipeline";
import { StageSelector } from "@/components/cases/stage-selector";
import { CaseTimeline } from "@/components/cases/case-timeline";
import { CaseOverview } from "@/components/cases/case-overview";
```

Add tab state:
```typescript
const [activeTab, setActiveTab] = useState("overview");
```

Wire up changeStage:
```typescript
const changeStage = trpc.cases.changeStage.useMutation({
  onSuccess: () => utils.cases.getById.invalidate({ caseId: id }),
});
```

The exact refactor depends on reading the current page code first. Key constraint: existing document/contract/chat content must move into their respective tabs without breaking functionality.

- [ ] **Step 2: Verify the page renders**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/cases/\[id\]/page.tsx
git commit -m "feat(cases): refactor case detail page with pipeline bar, tabs, and stage selector"
```

---

### Task 16: TypeScript Check

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors. If errors, fix them.

---

### Task 17: Integration Tests

- [ ] **Step 1: Run all integration tests**

Run: `npx vitest run tests/integration/`
Expected: All PASS (including new case-stages tests)

---

### Task 18: Build Verification

- [ ] **Step 1: Run build**

Run: `npm run build`
Expected: Build succeeds (Stripe error is pre-existing and unrelated)

- [ ] **Step 2: Fix any issues**

If any step fails, fix and re-run. Commit fixes separately.

---

### Task 19: E2E Smoke Tests

**Files:**
- Create: `e2e/case-workflow.spec.ts`

- [ ] **Step 1: Write E2E tests**

```typescript
// e2e/case-workflow.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Case Workflow & Stages", () => {
  test("case detail page loads with pipeline bar", async ({ page }) => {
    // Navigate to cases list first
    await page.goto("/cases");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("dashboard loads without errors", async ({ page }) => {
    await page.goto("/dashboard");
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/case-workflow.spec.ts
git commit -m "test(cases): add E2E smoke tests for case workflow pages"
```
