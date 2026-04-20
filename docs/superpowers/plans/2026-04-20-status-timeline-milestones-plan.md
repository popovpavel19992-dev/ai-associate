# 2.3.4 Status Timeline / Milestones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lawyer publishes client-facing status milestones on a case (draft → published → retracted lifecycle); client sees a chronological vertical-rail timeline on the portal.

**Architecture:** One new `case_milestones` table (separate from internal `case_events`). One service enforcing the 3-status lifecycle. Two tRPC routers (lawyer/portal). Two Inngest broadcast fns + 2 notification consumers. Lawyer UI = new `updates` tab on case detail with draft/published/retracted views. Portal UI = vertical-rail timeline mounted at top of `/portal/cases/[id]`.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (postgres driver), tRPC v11 (client: `trpc` from `@/lib/trpc`), Inngest v4 (two-arg `createFunction`), Zod v4 (`zod/v4`), Vitest with mock-db pattern, Playwright, shadcn/ui + Tailwind.

**Spec:** `docs/superpowers/specs/2026-04-20-status-timeline-milestones-design.md`

**Reference implementations on this branch stack:** 2.3.1 messaging, 2.3.2 document requests, 2.3.3 intake forms. Exact files to mirror are called out per task.

**Branch setup (before Task 1):**

```bash
# Currently on feature/2.3.3-intake-forms (stacked on 2.3.2, stacked on 2.3.1).
git checkout -b feature/2.3.4-status-timeline
```

---

## File Structure

**Create:**
- `src/server/db/schema/case-milestones.ts`
- `src/server/db/migrations/0015_case_milestones.sql`
- `src/server/services/case-milestones/service.ts`
- `tests/integration/case-milestones-service.test.ts`
- `src/server/trpc/routers/milestones.ts`
- `src/server/trpc/routers/portal-milestones.ts`
- `src/server/inngest/functions/milestone-broadcast.ts`
- `src/server/inngest/functions/milestone-notifications.ts`
- `src/components/cases/updates/new-milestone-modal.tsx`
- `src/components/cases/updates/milestone-editor.tsx`
- `src/components/cases/updates/milestone-detail.tsx`
- `src/components/cases/updates/retract-milestone-modal.tsx`
- `src/components/cases/updates/updates-tab.tsx`
- `src/components/portal/case-updates-timeline.tsx`
- `e2e/milestones-smoke.spec.ts`

**Modify:**
- `src/lib/notification-types.ts` — add 2 types + metadata + TYPE_LABELS
- `src/server/inngest/index.ts` — register 4 fns (2 broadcast + 2 consumers)
- `src/server/trpc/root.ts` — register 2 routers
- `src/app/(app)/cases/[id]/page.tsx` — add `updates` tab + mount
- `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx` — mount `<CaseUpdatesTimeline>` above existing cards

**Not touched:** sidebar (`src/components/layout/sidebar.tsx`) — milestones do not produce lawyer action items.

---

### Task 1: Drizzle schema

**Files:**
- Create: `src/server/db/schema/case-milestones.ts`

- [ ] **Step 1: Write schema file**

```ts
// src/server/db/schema/case-milestones.ts
import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { documents } from "./documents";

export const caseMilestones = pgTable(
  "case_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("draft"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    retractedReason: text("retracted_reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    retractedBy: uuid("retracted_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    retractedAt: timestamp("retracted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_milestones_case_status_idx").on(table.caseId, table.status),
    index("case_milestones_case_occurred_idx").on(table.caseId, table.occurredAt),
    check(
      "case_milestones_status_check",
      sql`${table.status} IN ('draft','published','retracted')`,
    ),
    check(
      "case_milestones_category_check",
      sql`${table.category} IN ('filing','discovery','hearing','settlement','communication','other')`,
    ),
  ],
);

export type CaseMilestone = typeof caseMilestones.$inferSelect;
export type NewCaseMilestone = typeof caseMilestones.$inferInsert;
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/case-milestones.ts
git commit -m "feat(2.3.4): drizzle schema for case_milestones"
```

---

### Task 2: Migration 0015 + apply to dev DB

**Files:**
- Create: `src/server/db/migrations/0015_case_milestones.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- 0015_case_milestones.sql
-- Phase 2.3.4: client-facing status timeline / milestones.

CREATE TABLE "case_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "category" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "document_id" uuid,
  "retracted_reason" text,
  "created_by" uuid,
  "retracted_by" uuid,
  "published_at" timestamp with time zone,
  "retracted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_milestones_status_check" CHECK ("status" IN ('draft','published','retracted')),
  CONSTRAINT "case_milestones_category_check" CHECK ("category" IN ('filing','discovery','hearing','settlement','communication','other'))
);

ALTER TABLE "case_milestones"
  ADD CONSTRAINT "case_milestones_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_milestones_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null,
  ADD CONSTRAINT "case_milestones_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null,
  ADD CONSTRAINT "case_milestones_retracted_by_fk" FOREIGN KEY ("retracted_by") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "case_milestones_case_status_idx" ON "case_milestones" USING btree ("case_id","status");
CREATE INDEX "case_milestones_case_occurred_idx" ON "case_milestones" USING btree ("case_id","occurred_at");
```

- [ ] **Step 2: Apply migration**

```bash
node -e "
const fs = require('fs');
const env = fs.readFileSync('.env.local','utf8')
  .split('\n').filter(l => l && !l.startsWith('#'))
  .map(l => l.split('='));
env.forEach(([k,v]) => { if (k && v) process.env[k.trim()] = v.trim(); });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);
(async () => {
  const ddl = fs.readFileSync('src/server/db/migrations/0015_case_milestones.sql','utf8');
  await sql.unsafe(ddl);
  const [a] = await sql\`SELECT COUNT(*)::int AS c FROM case_milestones\`;
  console.log('case_milestones rows:', a.c);
  await sql.end();
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected: `case_milestones rows: 0`.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/migrations/0015_case_milestones.sql
git commit -m "feat(2.3.4): migration 0015 — case_milestones table"
```

---

### Task 3: Notification types

**Files:**
- Modify: `src/lib/notification-types.ts`
- Modify: `src/components/notifications/notification-preferences-matrix.tsx`

- [ ] **Step 1: Extend `src/lib/notification-types.ts`**

Read the current file. Three edits:

**1a.** In `NOTIFICATION_TYPES` array, append after `"intake_form_cancelled"`:

```ts
  "milestone_published",
  "milestone_retracted",
```

**1b.** In `NOTIFICATION_CATEGORIES.cases` array, append:

```ts
    "milestone_published",
    "milestone_retracted",
```

**1c.** In `NotificationMetadata` type, before the closing `};`:

```ts
  milestone_published: {
    caseId: string;
    caseName: string;
    milestoneId: string;
    title: string;
    category: string;
    occurredAt: string;
    recipientPortalUserId: string;
  };
  milestone_retracted: {
    caseId: string;
    caseName: string;
    milestoneId: string;
    title: string;
    recipientPortalUserId: string;
  };
```

- [ ] **Step 2: Extend `TYPE_LABELS`**

In `src/components/notifications/notification-preferences-matrix.tsx`, append to the `TYPE_LABELS` object (after the intake entries):

```ts
  milestone_published: "Case update published",
  milestone_retracted: "Case update retracted",
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/notification-types.ts src/components/notifications/notification-preferences-matrix.tsx
git commit -m "feat(2.3.4): notification type definitions for milestones"
```

---

### Task 4: `CaseMilestonesService` + smoke tests

**Files:**
- Create: `src/server/services/case-milestones/service.ts`
- Create: `tests/integration/case-milestones-service.test.ts`

- [ ] **Step 1: Write service**

```ts
// src/server/services/case-milestones/service.ts
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseMilestones } from "@/server/db/schema/case-milestones";
import { documents } from "@/server/db/schema/documents";
import { users } from "@/server/db/schema/users";
import { inngest as defaultInngest } from "@/server/inngest/client";

const VALID_CATEGORIES = ["filing", "discovery", "hearing", "settlement", "communication", "other"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

export interface CaseMilestonesServiceDeps {
  db?: typeof defaultDb;
  inngest?: { send: (e: any) => Promise<unknown> | unknown };
}

export class CaseMilestonesService {
  private readonly db: typeof defaultDb;
  private readonly inngest: { send: (e: any) => Promise<unknown> | unknown };

  constructor(deps: CaseMilestonesServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.inngest = deps.inngest ?? defaultInngest;
  }

  private validateCategory(category: string): Category {
    if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid category: ${category}` });
    }
    return category as Category;
  }

  private async assertDocumentBelongsToCase(documentId: string, caseId: string) {
    const [doc] = await this.db
      .select({ caseId: documents.caseId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
    if (doc.caseId !== caseId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Document does not belong to this case" });
    }
  }

  async createDraft(input: {
    caseId: string;
    title: string;
    description?: string | null;
    category: string;
    occurredAt: Date;
    documentId?: string | null;
    createdBy: string;
  }): Promise<{ milestoneId: string }> {
    this.validateCategory(input.category);
    if (!input.title.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Title required" });
    if (input.documentId) {
      await this.assertDocumentBelongsToCase(input.documentId, input.caseId);
    }
    const [row] = await this.db
      .insert(caseMilestones)
      .values({
        caseId: input.caseId,
        title: input.title.trim(),
        description: input.description ?? null,
        category: input.category,
        occurredAt: input.occurredAt,
        status: "draft",
        documentId: input.documentId ?? null,
        createdBy: input.createdBy,
      })
      .returning();
    return { milestoneId: row.id };
  }

  async updateDraft(input: {
    milestoneId: string;
    title?: string;
    description?: string | null;
    category?: string;
    occurredAt?: Date;
    documentId?: string | null;
  }): Promise<void> {
    const [existing] = await this.db
      .select({ caseId: caseMilestones.caseId, status: caseMilestones.status })
      .from(caseMilestones)
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
    if (existing.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft milestones can be updated via updateDraft" });
    }
    if (input.category !== undefined) this.validateCategory(input.category);
    if (input.documentId) {
      await this.assertDocumentBelongsToCase(input.documentId, existing.caseId);
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.category !== undefined) patch.category = input.category;
    if (input.occurredAt !== undefined) patch.occurredAt = input.occurredAt;
    if (input.documentId !== undefined) patch.documentId = input.documentId;
    await this.db.update(caseMilestones).set(patch).where(eq(caseMilestones.id, input.milestoneId));
  }

  async deleteDraft(input: { milestoneId: string }): Promise<void> {
    const [existing] = await this.db
      .select({ status: caseMilestones.status })
      .from(caseMilestones)
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!existing) return;
    if (existing.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft milestones can be hard-deleted" });
    }
    await this.db.delete(caseMilestones).where(eq(caseMilestones.id, input.milestoneId));
  }

  async publish(input: { milestoneId: string }): Promise<void> {
    const [existing] = await this.db
      .select({
        id: caseMilestones.id,
        caseId: caseMilestones.caseId,
        status: caseMilestones.status,
        title: caseMilestones.title,
      })
      .from(caseMilestones)
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
    if (existing.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft milestones can be published" });
    }
    await this.db
      .update(caseMilestones)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(caseMilestones.id, input.milestoneId));
    await this.inngest.send({
      name: "messaging/milestone.published",
      data: { milestoneId: input.milestoneId, caseId: existing.caseId },
    });
  }

  async editPublished(input: {
    milestoneId: string;
    title?: string;
    description?: string | null;
    category?: string;
    occurredAt?: Date;
    documentId?: string | null;
  }): Promise<void> {
    const [existing] = await this.db
      .select({ caseId: caseMilestones.caseId, status: caseMilestones.status })
      .from(caseMilestones)
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
    if (existing.status !== "published") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only published milestones can be edited this way" });
    }
    if (input.category !== undefined) this.validateCategory(input.category);
    if (input.documentId) {
      await this.assertDocumentBelongsToCase(input.documentId, existing.caseId);
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.category !== undefined) patch.category = input.category;
    if (input.occurredAt !== undefined) patch.occurredAt = input.occurredAt;
    if (input.documentId !== undefined) patch.documentId = input.documentId;
    await this.db.update(caseMilestones).set(patch).where(eq(caseMilestones.id, input.milestoneId));
    // No notification event fired — edits are silent by spec.
  }

  async retract(input: {
    milestoneId: string;
    reason?: string;
    retractedBy: string;
  }): Promise<void> {
    const [existing] = await this.db
      .select({
        caseId: caseMilestones.caseId,
        status: caseMilestones.status,
        title: caseMilestones.title,
      })
      .from(caseMilestones)
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
    if (existing.status === "retracted") return;
    if (existing.status !== "published") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only published milestones can be retracted" });
    }
    await this.db
      .update(caseMilestones)
      .set({
        status: "retracted",
        retractedAt: new Date(),
        retractedBy: input.retractedBy,
        retractedReason: input.reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(caseMilestones.id, input.milestoneId));
    await this.inngest.send({
      name: "messaging/milestone.retracted",
      data: { milestoneId: input.milestoneId, caseId: existing.caseId },
    });
  }

  async listForCase(input: { caseId: string; viewerType: "lawyer" | "portal" }) {
    const rows = await this.db
      .select()
      .from(caseMilestones)
      .where(eq(caseMilestones.caseId, input.caseId))
      .orderBy(desc(caseMilestones.occurredAt));
    const visible = input.viewerType === "portal"
      ? rows.filter((r) => r.status === "published" || r.status === "retracted")
      : rows;
    return { milestones: visible };
  }

  async getMilestone(input: { milestoneId: string }) {
    const [row] = await this.db
      .select({
        id: caseMilestones.id,
        caseId: caseMilestones.caseId,
        title: caseMilestones.title,
        description: caseMilestones.description,
        category: caseMilestones.category,
        occurredAt: caseMilestones.occurredAt,
        status: caseMilestones.status,
        documentId: caseMilestones.documentId,
        documentFilename: documents.filename,
        retractedReason: caseMilestones.retractedReason,
        createdBy: caseMilestones.createdBy,
        createdByName: users.name,
        retractedBy: caseMilestones.retractedBy,
        publishedAt: caseMilestones.publishedAt,
        retractedAt: caseMilestones.retractedAt,
        createdAt: caseMilestones.createdAt,
        updatedAt: caseMilestones.updatedAt,
      })
      .from(caseMilestones)
      .leftJoin(documents, eq(documents.id, caseMilestones.documentId))
      .leftJoin(users, eq(users.id, caseMilestones.createdBy))
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
    return row;
  }
}
```

- [ ] **Step 2: Write smoke tests**

Use the mock-db pattern from `tests/integration/intake-forms-service.test.ts` (2.3.3 reference — read first if unclear).

```ts
// tests/integration/case-milestones-service.test.ts
import { describe, it, expect } from "vitest";
import { CaseMilestonesService } from "@/server/services/case-milestones/service";

function makeMockDb() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  const deletes: Array<{ table: unknown }> = [];
  const selectQueue: unknown[][] = [];
  let idCounter = 0;
  const nextId = () => `row-${++idCounter}`;
  const db = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        const row = { id: nextId(), ...(v as Record<string, unknown>) };
        return { returning: async () => [row] };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => {
        updates.push({ table: t, set: s });
        return { where: () => Promise.resolve() };
      },
    }),
    delete: (t: unknown) => ({
      where: () => { deletes.push({ table: t }); return Promise.resolve(); },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
        }),
        orderBy: () => ({ limit: async () => selectQueue.shift() ?? [] }),
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({ limit: async () => selectQueue.shift() ?? [] }),
          }),
        }),
      }),
    }),
    enqueue: (rows: unknown[]) => selectQueue.push(rows),
  } as any;
  return { db, inserts, updates, deletes };
}

describe("CaseMilestonesService.createDraft", () => {
  it("inserts milestone with status='draft' and trimmed title", async () => {
    const { db, inserts } = makeMockDb();
    const svc = new CaseMilestonesService({ db, inngest: { send: async () => {} } });
    const res = await svc.createDraft({
      caseId: "c1",
      title: "  Filed complaint  ",
      category: "filing",
      occurredAt: new Date("2026-04-18"),
      createdBy: "u1",
    });
    expect(res.milestoneId).toBeTruthy();
    const values = inserts[0]?.values as Record<string, unknown>;
    expect(values.status).toBe("draft");
    expect(values.title).toBe("Filed complaint");
    expect(values.category).toBe("filing");
  });

  it("rejects invalid category", async () => {
    const { db } = makeMockDb();
    const svc = new CaseMilestonesService({ db, inngest: { send: async () => {} } });
    await expect(
      svc.createDraft({
        caseId: "c1",
        title: "X",
        category: "not_a_category",
        occurredAt: new Date(),
        createdBy: "u1",
      }),
    ).rejects.toThrow(/Invalid category/);
  });
});

describe("CaseMilestonesService.publish", () => {
  it("transitions draft → published and fires event", async () => {
    const { db, updates } = makeMockDb();
    db.enqueue([{ id: "m1", caseId: "c1", status: "draft", title: "X" }]);
    const events: any[] = [];
    const svc = new CaseMilestonesService({ db, inngest: { send: async (e) => events.push(e) } });
    await svc.publish({ milestoneId: "m1" });
    const set = updates[0]?.set as Record<string, unknown>;
    expect(set.status).toBe("published");
    expect(events.find((e) => e.name === "messaging/milestone.published")).toBeTruthy();
  });

  it("rejects publish on non-draft", async () => {
    const { db } = makeMockDb();
    db.enqueue([{ id: "m1", caseId: "c1", status: "published", title: "X" }]);
    const svc = new CaseMilestonesService({ db, inngest: { send: async () => {} } });
    await expect(svc.publish({ milestoneId: "m1" })).rejects.toThrow(/Only draft milestones/);
  });
});

describe("CaseMilestonesService.retract", () => {
  it("fires retracted event", async () => {
    const { db } = makeMockDb();
    db.enqueue([{ caseId: "c1", status: "published", title: "X" }]);
    const events: any[] = [];
    const svc = new CaseMilestonesService({ db, inngest: { send: async (e) => events.push(e) } });
    await svc.retract({ milestoneId: "m1", retractedBy: "u1", reason: "typo" });
    expect(events.find((e) => e.name === "messaging/milestone.retracted")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/integration/case-milestones-service.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 4: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/case-milestones/service.ts tests/integration/case-milestones-service.test.ts
git commit -m "feat(2.3.4): CaseMilestonesService + lifecycle smoke tests"
```

---

### Task 5: tRPC routers — lawyer + portal

**Files:**
- Create: `src/server/trpc/routers/milestones.ts`
- Create: `src/server/trpc/routers/portal-milestones.ts`
- Modify: `src/server/trpc/root.ts`

Reference: `src/server/trpc/routers/intake-forms.ts` + `portal-intake-forms.ts` (2.3.3, shipped).

- [ ] **Step 1: Write lawyer router**

```ts
// src/server/trpc/routers/milestones.ts
import { z } from "zod/v4";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { CaseMilestonesService } from "@/server/services/case-milestones/service";

const categorySchema = z.enum([
  "filing",
  "discovery",
  "hearing",
  "settlement",
  "communication",
  "other",
]);

export const milestonesRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new CaseMilestonesService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId, viewerType: "lawyer" });
    }),

  get: protectedProcedure
    .input(z.object({ milestoneId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      return row;
    }),

  createDraft: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      description: z.string().max(5000).nullable().optional(),
      category: categorySchema,
      occurredAt: z.date(),
      documentId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new CaseMilestonesService({ db: ctx.db });
      return svc.createDraft({ ...input, createdBy: ctx.user.id });
    }),

  updateDraft: protectedProcedure
    .input(z.object({
      milestoneId: z.string().uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      category: categorySchema.optional(),
      occurredAt: z.date().optional(),
      documentId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      await svc.updateDraft(input);
      return { ok: true as const };
    }),

  deleteDraft: protectedProcedure
    .input(z.object({ milestoneId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      await svc.deleteDraft(input);
      return { ok: true as const };
    }),

  publish: protectedProcedure
    .input(z.object({ milestoneId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      await svc.publish(input);
      return { ok: true as const };
    }),

  editPublished: protectedProcedure
    .input(z.object({
      milestoneId: z.string().uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      category: categorySchema.optional(),
      occurredAt: z.date().optional(),
      documentId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      await svc.editPublished(input);
      return { ok: true as const };
    }),

  retract: protectedProcedure
    .input(z.object({
      milestoneId: z.string().uuid(),
      reason: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      await svc.retract({ ...input, retractedBy: ctx.user.id });
      return { ok: true as const };
    }),
});
```

- [ ] **Step 2: Write portal router**

```ts
// src/server/trpc/routers/portal-milestones.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { portalProcedure, router } from "@/server/trpc/trpc";
import { CaseMilestonesService } from "@/server/services/case-milestones/service";
import { cases } from "@/server/db/schema/cases";

async function assertPortalCaseAccess(ctx: any, caseId: string) {
  const [row] = await ctx.db
    .select({ clientId: cases.clientId })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  if (!row || row.clientId !== ctx.portalUser.clientId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
  }
}

export const portalMilestonesRouter = router({
  list: portalProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPortalCaseAccess(ctx, input.caseId);
      const svc = new CaseMilestonesService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId, viewerType: "portal" });
    }),

  get: portalProcedure
    .input(z.object({ milestoneId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertPortalCaseAccess(ctx, row.caseId);
      if (row.status === "draft") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Draft milestones are not visible" });
      }
      return row;
    }),
});
```

- [ ] **Step 3: Register in `src/server/trpc/root.ts`**

Add imports:
```ts
import { milestonesRouter } from "./routers/milestones";
import { portalMilestonesRouter } from "./routers/portal-milestones";
```

Inside the `router({ ... })` call:
```ts
  milestones: milestonesRouter,
  portalMilestones: portalMilestonesRouter,
```

- [ ] **Step 4: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/milestones.ts src/server/trpc/routers/portal-milestones.ts src/server/trpc/root.ts
git commit -m "feat(2.3.4): lawyer + portal milestones tRPC routers"
```

---

### Task 6: Inngest broadcast + consumers

**Files:**
- Create: `src/server/inngest/functions/milestone-broadcast.ts`
- Create: `src/server/inngest/functions/milestone-notifications.ts`
- Modify: `src/server/inngest/index.ts`

Reference: `intake-form-broadcast.ts` + `intake-form-notifications.ts` (2.3.3 shipped). Mirror exact dispatch event names (`portal-notification/send`).

- [ ] **Step 1: Write broadcast**

```ts
// src/server/inngest/functions/milestone-broadcast.ts
//
// Fans out 2 notification events from canonical messaging/milestone.* events.
// Mirror of intake-form-broadcast.ts.

import { inngest } from "@/server/inngest/client";
import { db as defaultDb } from "@/server/db";
import { eq } from "drizzle-orm";
import { caseMilestones } from "@/server/db/schema/case-milestones";
import { cases } from "@/server/db/schema/cases";
import { portalRecipients } from "@/server/services/messaging/recipients";

async function loadContext(milestoneId: string) {
  const [m] = await defaultDb
    .select({
      id: caseMilestones.id,
      caseId: caseMilestones.caseId,
      title: caseMilestones.title,
      category: caseMilestones.category,
      occurredAt: caseMilestones.occurredAt,
    })
    .from(caseMilestones)
    .where(eq(caseMilestones.id, milestoneId))
    .limit(1);
  if (!m) return null;
  const [c] = await defaultDb
    .select({ id: cases.id, name: cases.name, clientId: cases.clientId })
    .from(cases)
    .where(eq(cases.id, m.caseId))
    .limit(1);
  if (!c) return null;
  return { m, c };
}

export const milestonePublishedBroadcast = inngest.createFunction(
  { id: "milestone-published-broadcast", retries: 1, triggers: [{ event: "messaging/milestone.published" }] },
  async ({ event }) => {
    const { milestoneId } = event.data as { milestoneId: string };
    const ctx = await loadContext(milestoneId);
    if (!ctx) return { skipped: true };
    const portals = await portalRecipients(ctx.c.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.milestone_published",
        data: {
          caseId: ctx.c.id,
          caseName: ctx.c.name ?? "Case",
          milestoneId,
          title: ctx.m.title,
          category: ctx.m.category,
          occurredAt: ctx.m.occurredAt.toISOString(),
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);

export const milestoneRetractedBroadcast = inngest.createFunction(
  { id: "milestone-retracted-broadcast", retries: 1, triggers: [{ event: "messaging/milestone.retracted" }] },
  async ({ event }) => {
    const { milestoneId } = event.data as { milestoneId: string };
    const ctx = await loadContext(milestoneId);
    if (!ctx) return { skipped: true };
    const portals = await portalRecipients(ctx.c.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.milestone_retracted",
        data: {
          caseId: ctx.c.id,
          caseName: ctx.c.name ?? "Case",
          milestoneId,
          title: ctx.m.title,
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);
```

- [ ] **Step 2: Write consumers**

```ts
// src/server/inngest/functions/milestone-notifications.ts
//
// Consumes notification.milestone_* events and dispatches via the portal
// notification pipeline. Email matrix: published → email+in_app+push,
// retracted → in_app only.

import { inngest } from "@/server/inngest/client";

export const milestonePublishedNotify = inngest.createFunction(
  { id: "milestone-published-notify", retries: 1, triggers: [{ event: "notification.milestone_published" }] },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      milestoneId: string;
      title: string;
      category: string;
      occurredAt: string;
      recipientPortalUserId: string;
    };
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "milestone_published",
        title: `Case update: ${d.title}`,
        body: `Your lawyer posted a new update on ${d.caseName}.`,
        caseId: d.caseId,
        actionUrl: `/portal/cases/${d.caseId}`,
        metadata: d,
      },
    });
    return { dispatched: true };
  },
);

export const milestoneRetractedNotify = inngest.createFunction(
  { id: "milestone-retracted-notify", retries: 1, triggers: [{ event: "notification.milestone_retracted" }] },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      milestoneId: string;
      title: string;
      recipientPortalUserId: string;
    };
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "milestone_retracted",
        title: `Update retracted: ${d.title}`,
        body: `A previous case update was retracted.`,
        caseId: d.caseId,
        actionUrl: `/portal/cases/${d.caseId}`,
        metadata: d,
      },
    });
    return { dispatched: true };
  },
);
```

**Verify during implementation:** the dispatch event name `portal-notification/send` is what 2.3.3's `intake-form-notifications.ts` uses. If 2.3.3 chose a different name, mirror that one. Do not invent.

- [ ] **Step 3: Register in `src/server/inngest/index.ts`**

Add imports:
```ts
import {
  milestonePublishedBroadcast,
  milestoneRetractedBroadcast,
} from "./functions/milestone-broadcast";
import {
  milestonePublishedNotify,
  milestoneRetractedNotify,
} from "./functions/milestone-notifications";
```

Append 4 symbols to the `functions` array (after 2.3.3 entries):
```ts
  milestonePublishedBroadcast,
  milestoneRetractedBroadcast,
  milestonePublishedNotify,
  milestoneRetractedNotify,
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

Run: `npx next build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/server/inngest/functions/milestone-broadcast.ts src/server/inngest/functions/milestone-notifications.ts src/server/inngest/index.ts
git commit -m "feat(2.3.4): Inngest broadcast + consumers for milestones"
```

---

### Task 7: UI — NewMilestoneModal + MilestoneEditor + RetractMilestoneModal

**Files:**
- Create: `src/components/cases/updates/new-milestone-modal.tsx`
- Create: `src/components/cases/updates/milestone-editor.tsx`
- Create: `src/components/cases/updates/retract-milestone-modal.tsx`

Reminders:
- tRPC React import: `trpc` from `@/lib/trpc`.
- No `@/components/ui/checkbox` — not needed here.

- [ ] **Step 1: Write `NewMilestoneModal`**

```tsx
// src/components/cases/updates/new-milestone-modal.tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "filing", label: "Filing" },
  { value: "discovery", label: "Discovery" },
  { value: "hearing", label: "Hearing" },
  { value: "settlement", label: "Settlement" },
  { value: "communication", label: "Communication" },
  { value: "other", label: "Other" },
];

function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

interface Props {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (milestoneId: string) => void;
}

export function NewMilestoneModal({ caseId, open, onOpenChange, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("filing");
  const [dateStr, setDateStr] = useState<string>(todayISO());
  const utils = trpc.useUtils();

  const create = trpc.milestones.createDraft.useMutation({
    onSuccess: async (res) => {
      toast.success("Draft created");
      await utils.milestones.list.invalidate({ caseId });
      onCreated?.(res.milestoneId);
      setTitle(""); setCategory("filing"); setDateStr(todayISO());
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function submit() {
    if (!title.trim()) { toast.error("Title required"); return; }
    create.mutate({
      caseId,
      title: title.trim(),
      category: category as any,
      occurredAt: new Date(dateStr),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Milestone</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Filed complaint" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write `MilestoneEditor`**

```tsx
// src/components/cases/updates/milestone-editor.tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "filing", label: "Filing" },
  { value: "discovery", label: "Discovery" },
  { value: "hearing", label: "Hearing" },
  { value: "settlement", label: "Settlement" },
  { value: "communication", label: "Communication" },
  { value: "other", label: "Other" },
];

interface Props {
  milestoneId: string;
  caseId: string;
  initial: {
    title: string;
    description: string | null;
    category: string;
    occurredAt: string | Date;
    documentId: string | null;
  };
}

export function MilestoneEditor({ milestoneId, caseId, initial }: Props) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [category, setCategory] = useState(initial.category);
  const [dateStr, setDateStr] = useState(
    typeof initial.occurredAt === "string"
      ? initial.occurredAt.slice(0, 10)
      : new Date(initial.occurredAt).toISOString().slice(0, 10),
  );

  const update = trpc.milestones.updateDraft.useMutation({
    onSuccess: async () => {
      await utils.milestones.get.invalidate({ milestoneId });
      await utils.milestones.list.invalidate({ caseId });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const publish = trpc.milestones.publish.useMutation({
    onSuccess: async () => {
      await utils.milestones.get.invalidate({ milestoneId });
      await utils.milestones.list.invalidate({ caseId });
      toast.success("Published");
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.milestones.deleteDraft.useMutation({
    onSuccess: async () => {
      await utils.milestones.list.invalidate({ caseId });
      toast.success("Deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  function saveDraft() {
    update.mutate({
      milestoneId,
      title: title.trim(),
      description: description.trim() || null,
      category: category as any,
      occurredAt: new Date(dateStr),
    });
  }

  function handlePublish() {
    if (!title.trim()) { toast.error("Title required"); return; }
    update.mutate(
      {
        milestoneId,
        title: title.trim(),
        description: description.trim() || null,
        category: category as any,
        occurredAt: new Date(dateStr),
      },
      { onSuccess: () => publish.mutate({ milestoneId }) },
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label>Description</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What happened and why it matters to the client" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Date</Label>
          <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-between pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={() => del.mutate({ milestoneId })} disabled={del.isPending}>
          <Trash2 className="w-4 h-4 mr-1" /> Delete draft
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={saveDraft} disabled={update.isPending}>Save draft</Button>
          <Button onClick={handlePublish} disabled={update.isPending || publish.isPending}>
            <Send className="w-4 h-4 mr-1" /> Publish
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `RetractMilestoneModal`**

```tsx
// src/components/cases/updates/retract-milestone-modal.tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Props {
  milestoneId: string;
  caseId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RetractMilestoneModal({ milestoneId, caseId, title, open, onOpenChange }: Props) {
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const retract = trpc.milestones.retract.useMutation({
    onSuccess: async () => {
      await utils.milestones.get.invalidate({ milestoneId });
      await utils.milestones.list.invalidate({ caseId });
      toast.success("Retracted");
      setReason("");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Retract: {title}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Reason (optional, shown to client)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why is this being retracted?" />
          <p className="text-xs text-muted-foreground">
            The client will see a retracted marker and any reason you provide. This cannot be undone.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => retract.mutate({ milestoneId, reason: reason.trim() || undefined })}
            disabled={retract.isPending}
          >
            {retract.isPending ? "Retracting…" : "Retract"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/cases/updates/new-milestone-modal.tsx src/components/cases/updates/milestone-editor.tsx src/components/cases/updates/retract-milestone-modal.tsx
git commit -m "feat(2.3.4): NewMilestoneModal + MilestoneEditor + RetractMilestoneModal"
```

---

### Task 8: UI — MilestoneDetail (4-mode) + UpdatesTab

**Files:**
- Create: `src/components/cases/updates/milestone-detail.tsx`
- Create: `src/components/cases/updates/updates-tab.tsx`

- [ ] **Step 1: Write `MilestoneDetail`**

```tsx
// src/components/cases/updates/milestone-detail.tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Undo2, FileText } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { MilestoneEditor } from "./milestone-editor";
import { RetractMilestoneModal } from "./retract-milestone-modal";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  published: "bg-green-100 text-green-800",
  retracted: "bg-muted text-muted-foreground",
};

const CATEGORY_STYLES: Record<string, string> = {
  filing: "bg-blue-100 text-blue-800",
  discovery: "bg-purple-100 text-purple-800",
  hearing: "bg-amber-100 text-amber-800",
  settlement: "bg-green-100 text-green-800",
  communication: "bg-gray-100 text-gray-700",
  other: "bg-slate-100 text-slate-700",
};

export function MilestoneDetail({ milestoneId, caseId }: { milestoneId: string; caseId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.milestones.get.useQuery({ milestoneId });
  const [editingPublished, setEditingPublished] = useState(false);
  const [retractOpen, setRetractOpen] = useState(false);

  const editMut = trpc.milestones.editPublished.useMutation({
    onSuccess: async () => {
      await utils.milestones.get.invalidate({ milestoneId });
      await utils.milestones.list.invalidate({ caseId });
      toast.success("Saved (client not re-notified)");
      setEditingPublished(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-4 text-sm text-muted-foreground">Milestone not found</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{data.title}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>{format(new Date(data.occurredAt), "PP")}</span>
            <Badge className={CATEGORY_STYLES[data.category] ?? ""}>{data.category}</Badge>
            {data.createdByName && <span>· by {data.createdByName}</span>}
          </div>
        </div>
        <Badge className={STATUS_STYLES[data.status] ?? ""}>{data.status}</Badge>
      </div>

      {data.status === "draft" && (
        <MilestoneEditor
          milestoneId={milestoneId}
          caseId={caseId}
          initial={{
            title: data.title,
            description: data.description,
            category: data.category,
            occurredAt: data.occurredAt as unknown as string,
            documentId: data.documentId,
          }}
        />
      )}

      {data.status === "published" && !editingPublished && (
        <div className="space-y-3">
          {data.description && (
            <p className="text-sm whitespace-pre-wrap">{data.description}</p>
          )}
          {data.documentFilename && (
            <div className="text-sm inline-flex items-center gap-1 text-muted-foreground">
              <FileText className="w-4 h-4" /> {data.documentFilename}
            </div>
          )}
          <div className="flex gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => {
              if (confirm("Edits to a published milestone will not re-notify the client. Proceed?")) {
                setEditingPublished(true);
              }
            }}>
              <Pencil className="w-4 h-4 mr-1" /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRetractOpen(true)}>
              <Undo2 className="w-4 h-4 mr-1" /> Retract
            </Button>
          </div>
        </div>
      )}

      {data.status === "published" && editingPublished && (
        <PublishedEditor
          initial={{
            title: data.title,
            description: data.description,
            category: data.category,
            occurredAt: data.occurredAt as unknown as string,
            documentId: data.documentId,
          }}
          onCancel={() => setEditingPublished(false)}
          onSave={(patch) => editMut.mutate({ milestoneId, ...patch })}
          pending={editMut.isPending}
        />
      )}

      {data.status === "retracted" && (
        <div className="space-y-2 opacity-70">
          {data.description && <p className="text-sm line-through whitespace-pre-wrap">{data.description}</p>}
          <p className="text-sm text-red-700">
            This update was retracted{data.retractedReason ? `: ${data.retractedReason}` : "."}
          </p>
        </div>
      )}

      <RetractMilestoneModal
        milestoneId={milestoneId}
        caseId={caseId}
        title={data.title}
        open={retractOpen}
        onOpenChange={setRetractOpen}
      />
    </div>
  );
}

function PublishedEditor({
  initial,
  onCancel,
  onSave,
  pending,
}: {
  initial: { title: string; description: string | null; category: string; occurredAt: string; documentId: string | null };
  onCancel: () => void;
  onSave: (patch: { title: string; description: string | null; category: string; occurredAt: Date }) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [category, setCategory] = useState(initial.category);
  const [dateStr, setDateStr] = useState(
    typeof initial.occurredAt === "string"
      ? initial.occurredAt.slice(0, 10)
      : new Date(initial.occurredAt).toISOString().slice(0, 10),
  );

  return (
    <div className="space-y-2">
      <input className="w-full border rounded px-2 py-1 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="w-full border rounded px-2 py-1 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      <div className="flex gap-2">
        <select className="border rounded px-2 py-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          {["filing","discovery","hearing","settlement","communication","other"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" className="border rounded px-2 py-1 text-sm" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
      </div>
      <div className="flex gap-2 pt-2 border-t">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={pending} onClick={() => onSave({
          title: title.trim(),
          description: description.trim() || null,
          category,
          occurredAt: new Date(dateStr),
        })}>Save</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `UpdatesTab`**

```tsx
// src/components/cases/updates/updates-tab.tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { NewMilestoneModal } from "./new-milestone-modal";
import { MilestoneDetail } from "./milestone-detail";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  published: "bg-green-100 text-green-800",
  retracted: "bg-muted text-muted-foreground",
};

const CATEGORY_STYLES: Record<string, string> = {
  filing: "bg-blue-100 text-blue-800",
  discovery: "bg-purple-100 text-purple-800",
  hearing: "bg-amber-100 text-amber-800",
  settlement: "bg-green-100 text-green-800",
  communication: "bg-gray-100 text-gray-700",
  other: "bg-slate-100 text-slate-700",
};

export function UpdatesTab({ caseId }: { caseId: string }) {
  const { data } = trpc.milestones.list.useQuery({ caseId });
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const milestones = data?.milestones ?? [];
  const active = selectedId ?? milestones[0]?.id ?? null;

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-80 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Updates</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {milestones.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No updates yet. Create one to keep the client informed.</p>
          ) : (
            <ul>
              {milestones.map((m) => {
                const isActive = m.id === active;
                return (
                  <li
                    key={m.id}
                    className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{m.title}</span>
                      <Badge className={STATUS_STYLES[m.status] ?? ""}>{m.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                      <Badge className={CATEGORY_STYLES[m.category] ?? ""}>{m.category}</Badge>
                      <span>{format(new Date(m.occurredAt), "MMM d, yyyy")}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
      <section className="flex-1 overflow-y-auto">
        {active ? (
          <MilestoneDetail milestoneId={active} caseId={caseId} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Select a milestone or create a new one.</p>
        )}
      </section>
      <NewMilestoneModal
        caseId={caseId}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}
```

- [ ] **Step 3: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/updates/milestone-detail.tsx src/components/cases/updates/updates-tab.tsx
git commit -m "feat(2.3.4): MilestoneDetail (4-mode) + UpdatesTab"
```

---

### Task 9: Mount tab in case detail

**Files:**
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Extend TABS + mount**

Read the file. Make three edits:

**1a.** In TABS array, after `{ key: "intake", label: "Intake" }`:
```ts
{ key: "updates", label: "Updates" },
```

**1b.** Add import at top:
```ts
import { UpdatesTab } from "@/components/cases/updates/updates-tab";
```

**1c.** In the conditional block (after intake conditional), add:
```tsx
{activeTab === "updates" && <UpdatesTab caseId={caseData.id} />}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — EXIT 0.
Run: `npx next build 2>&1 | tail -10` — success.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/cases/[id]/page.tsx"
git commit -m "feat(2.3.4): mount Updates tab on case detail"
```

---

### Task 10: Portal `<CaseUpdatesTimeline>` + mount on case page

**Files:**
- Create: `src/components/portal/case-updates-timeline.tsx`
- Modify: `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx`

- [ ] **Step 1: Write component**

```tsx
// src/components/portal/case-updates-timeline.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { FileText } from "lucide-react";
import { format } from "date-fns";

const CATEGORY_DOT: Record<string, string> = {
  filing: "bg-blue-500",
  discovery: "bg-purple-500",
  hearing: "bg-amber-500",
  settlement: "bg-green-500",
  communication: "bg-gray-400",
  other: "bg-slate-400",
};

const CATEGORY_LABEL: Record<string, string> = {
  filing: "Filing",
  discovery: "Discovery",
  hearing: "Hearing",
  settlement: "Settlement",
  communication: "Communication",
  other: "Other",
};

export function CaseUpdatesTimeline({ caseId }: { caseId: string }) {
  const { data } = trpc.portalMilestones.list.useQuery({ caseId });
  const milestones = data?.milestones ?? [];

  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold mb-3">Case Updates</h2>
      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Updates from your lawyer will appear here.
        </p>
      ) : (
        <ol className="relative border-l-2 border-muted pl-6 space-y-4">
          {milestones.map((m) => {
            const isRetracted = m.status === "retracted";
            return (
              <li key={m.id} className="relative">
                <span
                  className={`absolute -left-[31px] top-1 w-4 h-4 rounded-full border-2 border-background ${CATEGORY_DOT[m.category] ?? "bg-slate-400"}`}
                  aria-hidden
                />
                <div className={`border rounded p-3 ${isRetracted ? "opacity-60" : ""}`}>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="uppercase tracking-wide">{format(new Date(m.occurredAt), "MMM d, yyyy")}</span>
                    <span>·</span>
                    <span>{CATEGORY_LABEL[m.category] ?? m.category}</span>
                  </div>
                  <h3 className={`text-base font-medium mt-1 ${isRetracted ? "line-through" : ""}`}>
                    {m.title}
                  </h3>
                  {!isRetracted && m.description && (
                    <p className="text-sm mt-1 whitespace-pre-wrap">{m.description}</p>
                  )}
                  {isRetracted && (
                    <p className="text-sm text-red-700 mt-1">
                      This update was retracted{m.retractedReason ? `: ${m.retractedReason}` : "."}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
```

Note: `portalMilestones.list` returns rows from the service's basic select (no document join). If the attached-document chip is desired on the portal render, the service's `listForCase` would need to left-join documents. **Skip on MVP** — the chip is a nice-to-have, portal can navigate to documents tab for full context. If you want it, extend `listForCase` to include the filename column the same way `getMilestone` does, and render the `<FileText>` chip.

- [ ] **Step 2: Mount on portal case page**

In `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx`:
- Add import: `import { CaseUpdatesTimeline } from "@/components/portal/case-updates-timeline";`
- Insert `<CaseUpdatesTimeline caseId={caseData.id} />` **above** `<IntakeFormsCard>` (first in the section stack). Use the same case id variable the other cards use.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — EXIT 0.
Run: `npx next build 2>&1 | tail -10` — success.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/case-updates-timeline.tsx "src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx"
git commit -m "feat(2.3.4): portal CaseUpdatesTimeline + mount on case page"
```

---

### Task 11: E2E smoke + final verification

**Files:**
- Create: `e2e/milestones-smoke.spec.ts`

- [ ] **Step 1: Write smoke**

```ts
// e2e/milestones-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.4 milestones smoke", () => {
  test("/cases/[id]?tab=updates returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=updates`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/portal/cases/[id] still returns <500 with timeline", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/portal/cases/${FAKE_UUID}`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run smoke**

```bash
npx playwright test e2e/milestones-smoke.spec.ts 2>&1 | tail -10
```

Expected: lawyer route passes. Portal route may hit the pre-existing Turbopack CSS issue in dev — report if it happens but don't block.

- [ ] **Step 3: Final verification**

```bash
npx vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -3
npx next build 2>&1 | tail -20
```

Expected:
- Vitest: 532 baseline + 5 from Task 4 = 537+ tests pass.
- tsc: EXIT 0.
- Build: success; new routes `/cases/[id]` (with tab) registered.

- [ ] **Step 4: Commit**

```bash
git add e2e/milestones-smoke.spec.ts
git commit -m "test(2.3.4): E2E smoke for milestones routes"
```

- [ ] **Step 5: Branch summary**

```bash
git log --oneline main..HEAD | wc -l
git log --oneline feature/2.3.3-intake-forms..HEAD
git diff feature/2.3.3-intake-forms..HEAD --stat | tail -5
```

Capture for reporting.

---

## Self-Review

**Spec coverage:**
- §3 decisions 1–8 mapped: (1) separate table → T1/T2; (2) shape → T1/T4; (3) lifecycle → T4; (4) surface → T9/T10; (5) render → T10; (6) 2 notifications → T3/T6; (7) empty placeholder → T10; (8) no backfill/unread → out of scope by omission. ✓
- §4 data model → T1 + T2. ✓
- §5 backend → T4–T6. ✓
- §6 lawyer UI → T7–T9. ✓
- §7 portal UI → T10. ✓
- §8 UAT → implementation covers; manual UAT happens after T11.
- §9 testing → T4 has 5 smoke tests; integration behavior validated via live UAT. E2E in T11.
- §11 open questions resolved inline: attached-doc chip on portal skipped on MVP (T10 note), NewMilestoneModal redirects into detail via `onCreated` callback pattern (T7), no URL linkify (out of scope). ✓

**Placeholder scan:** No TBDs or hand-waves. One intentional "Skip on MVP" note in T10 about document chip on portal render, which is a decision not a placeholder.

**Type consistency:**
- Status literals (`draft`, `published`, `retracted`) match across T1 CHECK, T4 service guards, T7/T8 UI.
- Category literals match across T1 CHECK, T4 `VALID_CATEGORIES`, T5 `z.enum`, T7/T8/T10 UI maps.
- Event names `messaging/milestone.published` / `.retracted` consistent between T4 service emits and T6 broadcast triggers.
- Notification names `notification.milestone_published` / `.retracted` consistent between T6 broadcast emits and T6 consumer triggers.
- Metadata shapes in T3 match data passed in T6 broadcast functions.
- Dispatch event name `portal-notification/send` matches T6 consumer output and 2.3.3's consumer pattern (verify at implementation time per §10 of spec).
