# 2.3.3 Intake Forms / Questionnaires Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lawyer builds structured intake forms on a case (8 field types), sends to client, client fills with auto-save on portal, submits; lawyer views and prints to PDF.

**Architecture:** Two new tables — `intake_forms` with JSONB `schema` column, `intake_form_answers` normalized (one row per field answer, polymorphic value columns). One service enforcing lifecycle + schema/answer validation. Two tRPC routers (lawyer/portal). Three Inngest broadcast fns mirroring 2.3.2 pattern. Lawyer UI = new `intake` tab on case detail with builder/view modes. Portal UI = card on case page + full-screen fill page with debounced auto-save. PDF = print-styled HTML route + browser Save-as-PDF.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (postgres driver), tRPC v11 (React client `trpc` from `@/lib/trpc`), Inngest v4 (two-arg `createFunction`), Zod v4 (`zod/v4`), Vitest with mock-db pattern (`tests/integration/collections-service.test.ts`), Playwright, shadcn/ui + Tailwind.

**Spec:** `docs/superpowers/specs/2026-04-20-intake-forms-design.md`

**Reference implementations to mirror:** 2.3.1 Lawyer-Side Messaging and 2.3.2 Document Request Workflow (both shipped on this branch). Exact reference files called out per task.

**Branch setup (do before Task 1):**

```bash
# Current branch feature/2.3.2-document-request-workflow is stacked on 2.3.1 (PR #14).
# Cut a new branch for 2.3.3 on top so each phase has its own PR.
git checkout -b feature/2.3.3-intake-forms
```

---

## File Structure

**Create:**
- `src/server/db/schema/intake-forms.ts`
- `src/server/db/schema/intake-form-answers.ts`
- `src/server/db/migrations/0014_intake_forms.sql`
- `src/server/services/intake-forms/service.ts`
- `src/server/services/intake-forms/schema-validation.ts`
- `tests/integration/intake-forms-service.test.ts`
- `src/server/services/messaging/recipients.ts` (extracted helpers, shared)
- `src/server/trpc/routers/intake-forms.ts`
- `src/server/trpc/routers/portal-intake-forms.ts`
- `src/server/inngest/functions/intake-form-broadcast.ts`
- `src/server/inngest/functions/intake-form-notifications.ts`
- `src/components/cases/intake/new-intake-form-modal.tsx`
- `src/components/cases/intake/form-builder.tsx`
- `src/components/cases/intake/intake-form-detail.tsx`
- `src/components/cases/intake/intake-tab.tsx`
- `src/components/portal/intake-forms-card.tsx`
- `src/components/portal/intake/intake-page.tsx`
- `src/components/portal/intake/fields.tsx`
- `src/app/(portal)/portal/(authenticated)/intake/[formId]/page.tsx`
- `src/app/(app)/cases/[id]/intake/[formId]/print/page.tsx`
- `e2e/intake-forms-smoke.spec.ts`

**Modify:**
- `src/lib/notification-types.ts` — 3 new types + metadata
- `src/server/inngest/functions/handle-notification.ts` — lawyer `intake_form_submitted` email case
- `src/server/inngest/index.ts` — register 6 new fns (3 broadcast + 3 consumers)
- `src/server/trpc/root.ts` — register 2 routers
- `src/app/(app)/cases/[id]/page.tsx` — add `intake` tab
- `src/components/layout/sidebar.tsx` — add 3rd badge source (`intakeForms.submittedCount`)
- `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx` — mount `<IntakeFormsCard>`
- `src/components/notifications/notification-preferences-matrix.tsx` — TYPE_LABELS for 3 new types

---

### Task 1: Drizzle schema — two new tables

**Files:**
- Create: `src/server/db/schema/intake-forms.ts`
- Create: `src/server/db/schema/intake-form-answers.ts`

- [ ] **Step 1: Write `intake-forms.ts`**

```ts
// src/server/db/schema/intake-forms.ts
import { pgTable, uuid, text, timestamp, jsonb, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";

export const intakeForms = pgTable(
  "intake_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    description: text("description"),
    schema: jsonb("schema").notNull().default(sql`'{"fields":[]}'::jsonb`),
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("intake_forms_case_status_idx").on(table.caseId, table.status),
    index("intake_forms_case_created_idx").on(table.caseId, table.createdAt),
    check(
      "intake_forms_status_check",
      sql`${table.status} IN ('draft','sent','in_progress','submitted','cancelled')`,
    ),
  ],
);

export type IntakeForm = typeof intakeForms.$inferSelect;
export type NewIntakeForm = typeof intakeForms.$inferInsert;
```

- [ ] **Step 2: Write `intake-form-answers.ts`**

```ts
// src/server/db/schema/intake-form-answers.ts
import { pgTable, uuid, text, numeric, date, boolean, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { intakeForms } from "./intake-forms";
import { documents } from "./documents";

export const intakeFormAnswers = pgTable(
  "intake_form_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formId: uuid("form_id")
      .references(() => intakeForms.id, { onDelete: "cascade" })
      .notNull(),
    fieldId: text("field_id").notNull(),
    valueText: text("value_text"),
    valueNumber: numeric("value_number"),
    valueDate: date("value_date"),
    valueBool: boolean("value_bool"),
    valueJson: jsonb("value_json"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("intake_form_answers_form_field_unique").on(table.formId, table.fieldId),
    index("intake_form_answers_form_idx").on(table.formId),
  ],
);

export type IntakeFormAnswer = typeof intakeFormAnswers.$inferSelect;
export type NewIntakeFormAnswer = typeof intakeFormAnswers.$inferInsert;
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema/intake-forms.ts src/server/db/schema/intake-form-answers.ts
git commit -m "feat(2.3.3): drizzle schema for intake forms + answers"
```

---

### Task 2: Migration 0014 + apply to dev DB

**Files:**
- Create: `src/server/db/migrations/0014_intake_forms.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- 0014_intake_forms.sql
-- Phase 2.3.3: intake forms / questionnaires.

CREATE TABLE "intake_forms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "schema" jsonb NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" uuid,
  "sent_at" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "intake_forms_status_check" CHECK ("status" IN ('draft','sent','in_progress','submitted','cancelled'))
);

ALTER TABLE "intake_forms"
  ADD CONSTRAINT "intake_forms_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "intake_forms_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "intake_forms_case_status_idx" ON "intake_forms" USING btree ("case_id","status");
CREATE INDEX "intake_forms_case_created_idx" ON "intake_forms" USING btree ("case_id","created_at");

CREATE TABLE "intake_form_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "form_id" uuid NOT NULL,
  "field_id" text NOT NULL,
  "value_text" text,
  "value_number" numeric,
  "value_date" date,
  "value_bool" boolean,
  "value_json" jsonb,
  "document_id" uuid,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "intake_form_answers"
  ADD CONSTRAINT "intake_form_answers_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."intake_forms"("id") ON DELETE cascade,
  ADD CONSTRAINT "intake_form_answers_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict;

CREATE UNIQUE INDEX "intake_form_answers_form_field_unique" ON "intake_form_answers" USING btree ("form_id","field_id");
CREATE INDEX "intake_form_answers_form_idx" ON "intake_form_answers" USING btree ("form_id");
```

- [ ] **Step 2: Apply to dev DB**

Use a Node one-liner that reads `DATABASE_URL` from `.env.local` (the 2.3.2 migration used `psql`; this project doesn't have `psql` on PATH, so use the same postgres driver as the app):

```bash
node -e "
const fs = require('fs');
const env = fs.readFileSync('.env.local','utf8')
  .split('\n').filter(l => l && !l.startsWith('#'))
  .map(l => l.split('=')); env.forEach(([k,v]) => { if (k && v) process.env[k.trim()] = v.trim(); });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);
(async () => {
  const ddl = fs.readFileSync('src/server/db/migrations/0014_intake_forms.sql','utf8');
  await sql.unsafe(ddl);
  const [a] = await sql\`SELECT COUNT(*)::int AS c FROM intake_forms\`;
  const [b] = await sql\`SELECT COUNT(*)::int AS c FROM intake_form_answers\`;
  console.log('intake_forms rows:', a.c, '| intake_form_answers rows:', b.c);
  await sql.end();
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected: `intake_forms rows: 0 | intake_form_answers rows: 0`.

If migration already applied (e.g. re-running), `DROP TABLE IF EXISTS intake_form_answers, intake_forms CASCADE;` at top, then re-run — but only if safe to discard rows.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/migrations/0014_intake_forms.sql
git commit -m "feat(2.3.3): migration 0014 — intake forms + answers tables"
```

---

### Task 3: Notification types — 3 new types

**Files:**
- Modify: `src/lib/notification-types.ts`
- Modify: `src/components/notifications/notification-preferences-matrix.tsx`

- [ ] **Step 1: Append to `NOTIFICATION_TYPES` array in `src/lib/notification-types.ts`**

After the last 2.3.2 entry `"document_request_cancelled"`, add:

```ts
  "intake_form_sent",
  "intake_form_submitted",
  "intake_form_cancelled",
```

- [ ] **Step 2: Extend `NOTIFICATION_CATEGORIES.cases`**

Append the three types to the `cases` array:

```ts
    "intake_form_sent",
    "intake_form_submitted",
    "intake_form_cancelled",
```

- [ ] **Step 3: Append metadata shapes to `NotificationMetadata` type**

Before the closing `};`:

```ts
  intake_form_sent: {
    caseId: string;
    caseName: string;
    formId: string;
    formTitle: string;
    fieldCount: number;
    recipientPortalUserId: string;
  };
  intake_form_submitted: {
    caseId: string;
    caseName: string;
    formId: string;
    formTitle: string;
    recipientUserId: string;
  };
  intake_form_cancelled: {
    caseId: string;
    caseName: string;
    formId: string;
    formTitle: string;
    recipientPortalUserId: string;
  };
```

- [ ] **Step 4: Add TYPE_LABELS entries**

In `src/components/notifications/notification-preferences-matrix.tsx`, append to the `TYPE_LABELS` object:

```ts
  intake_form_sent: "Intake form received",
  intake_form_submitted: "Intake form submitted",
  intake_form_cancelled: "Intake form cancelled",
```

- [ ] **Step 5: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notification-types.ts src/components/notifications/notification-preferences-matrix.tsx
git commit -m "feat(2.3.3): notification type definitions for intake forms"
```

---

### Task 4: Schema validation helper + extract shared recipient helpers

**Files:**
- Create: `src/server/services/intake-forms/schema-validation.ts`
- Create: `src/server/services/messaging/recipients.ts`

- [ ] **Step 1: Write schema validation**

```ts
// src/server/services/intake-forms/schema-validation.ts
import { z } from "zod/v4";

export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "date",
  "select",
  "multi_select",
  "yes_no",
  "file_upload",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const optionSchema = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
});

export const fieldSpecSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(FIELD_TYPES),
    label: z.string().trim().min(1).max(200),
    description: z.string().max(1000).optional(),
    required: z.boolean(),
    options: z.array(optionSchema).min(2).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    maxDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .superRefine((field, ctx) => {
    if ((field.type === "select" || field.type === "multi_select") && (!field.options || field.options.length < 2)) {
      ctx.addIssue({ code: "custom", message: `${field.type} requires at least 2 options` });
    }
    if (field.type === "number" && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      ctx.addIssue({ code: "custom", message: "number min cannot exceed max" });
    }
  });

export type FieldSpec = z.infer<typeof fieldSpecSchema>;

export const formSchemaSchema = z
  .object({
    fields: z.array(fieldSpecSchema).max(100),
  })
  .superRefine((schema, ctx) => {
    const ids = new Set<string>();
    for (const f of schema.fields) {
      if (ids.has(f.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate field id: ${f.id}` });
      }
      ids.add(f.id);
    }
  });

export type FormSchema = z.infer<typeof formSchemaSchema>;

/**
 * Validate a submitted value matches a field's type.
 * Returns the value routed to the correct answer column, or throws.
 */
export function routeAnswerValue(
  field: FieldSpec,
  value: unknown,
): {
  valueText: string | null;
  valueNumber: string | null; // numeric stored as string in drizzle postgres
  valueDate: string | null;
  valueBool: boolean | null;
  valueJson: unknown | null;
  documentId: string | null;
} {
  const empty = {
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueBool: null,
    valueJson: null,
    documentId: null,
  };
  if (value === null || value === undefined || value === "") return empty;

  switch (field.type) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") throw new Error(`${field.type} expects string`);
      const max = field.type === "short_text" ? 500 : 5000;
      if (value.length > max) throw new Error(`value too long for ${field.type}`);
      return { ...empty, valueText: value };
    }
    case "select": {
      if (typeof value !== "string") throw new Error("select expects string");
      if (!field.options?.some((o) => o.value === value)) throw new Error("value not in options");
      return { ...empty, valueText: value };
    }
    case "multi_select": {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        throw new Error("multi_select expects string[]");
      }
      const valid = new Set(field.options?.map((o) => o.value) ?? []);
      for (const v of value as string[]) {
        if (!valid.has(v)) throw new Error(`value "${v}" not in options`);
      }
      return { ...empty, valueJson: value };
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) throw new Error("number expects finite number");
      if (field.min !== undefined && value < field.min) throw new Error(`below min`);
      if (field.max !== undefined && value > field.max) throw new Error(`above max`);
      return { ...empty, valueNumber: String(value) };
    }
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("date expects ISO YYYY-MM-DD string");
      }
      if (field.minDate && value < field.minDate) throw new Error("before minDate");
      if (field.maxDate && value > field.maxDate) throw new Error("after maxDate");
      return { ...empty, valueDate: value };
    }
    case "yes_no": {
      if (typeof value !== "boolean") throw new Error("yes_no expects boolean");
      return { ...empty, valueBool: value };
    }
    case "file_upload": {
      if (typeof value !== "object" || value === null || typeof (value as { documentId?: unknown }).documentId !== "string") {
        throw new Error("file_upload expects { documentId: string }");
      }
      return { ...empty, documentId: (value as { documentId: string }).documentId };
    }
  }
}
```

- [ ] **Step 2: Extract shared recipient helpers**

```ts
// src/server/services/messaging/recipients.ts
//
// Shared recipient-resolution helpers used by 2.3.2 document-request-broadcast,
// 2.3.3 intake-form-broadcast, and future broadcast fns.

import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseMembers } from "@/server/db/schema/case-members";
import { portalUsers } from "@/server/db/schema/portal-users";

export async function portalRecipients(clientId: string | null): Promise<string[]> {
  if (!clientId) return [];
  const rows = await defaultDb
    .select({ id: portalUsers.id })
    .from(portalUsers)
    .where(eq(portalUsers.clientId, clientId));
  return rows.map((r) => r.id);
}

export async function lawyerRecipients(caseId: string, ownerId: string | null): Promise<string[]> {
  const members = await defaultDb
    .select({ userId: caseMembers.userId })
    .from(caseMembers)
    .where(eq(caseMembers.caseId, caseId));
  const set = new Set<string>(members.map((m) => m.userId));
  if (ownerId) set.add(ownerId);
  return [...set];
}
```

Note: do **not** refactor 2.3.2's existing `document-request-broadcast.ts` to consume these helpers in this task. Leave its inlined copies; future phase can deduplicate. The goal now is not to churn merged code.

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/intake-forms/schema-validation.ts src/server/services/messaging/recipients.ts
git commit -m "feat(2.3.3): intake form schema validation + shared recipient helpers"
```

---

### Task 5: `IntakeFormsService` — draft CRUD + 3 smoke tests

**Files:**
- Create: `src/server/services/intake-forms/service.ts`
- Create: `tests/integration/intake-forms-service.test.ts`

Reference the mock-db pattern from `tests/integration/collections-service.test.ts` and the 2.3.2 service at `src/server/services/document-requests/service.ts`.

- [ ] **Step 1: Write service**

```ts
// src/server/services/intake-forms/service.ts
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { intakeForms } from "@/server/db/schema/intake-forms";
import { intakeFormAnswers } from "@/server/db/schema/intake-form-answers";
import { cases } from "@/server/db/schema/cases";
import { documents } from "@/server/db/schema/documents";
import { inngest as defaultInngest } from "@/server/inngest/client";
import { formSchemaSchema, routeAnswerValue, type FieldSpec, type FormSchema } from "./schema-validation";

export interface IntakeFormsServiceDeps {
  db?: typeof defaultDb;
  inngest?: { send: (e: any) => Promise<unknown> | unknown };
}

export class IntakeFormsService {
  private readonly db: typeof defaultDb;
  private readonly inngest: { send: (e: any) => Promise<unknown> | unknown };

  constructor(deps: IntakeFormsServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.inngest = deps.inngest ?? defaultInngest;
  }

  async createDraft(input: {
    caseId: string;
    title: string;
    description?: string;
    createdBy: string;
  }): Promise<{ formId: string }> {
    const [row] = await this.db
      .insert(intakeForms)
      .values({
        caseId: input.caseId,
        title: input.title,
        description: input.description ?? null,
        schema: { fields: [] } as unknown,
        status: "draft",
        createdBy: input.createdBy,
      })
      .returning();
    return { formId: row.id };
  }

  async updateDraft(input: {
    formId: string;
    title?: string;
    description?: string | null;
    schema?: FormSchema;
  }): Promise<void> {
    const [existing] = await this.db
      .select({ status: intakeForms.status })
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    if (existing.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Form can only be edited while in draft" });
    }
    if (input.schema !== undefined) {
      formSchemaSchema.parse(input.schema);
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.schema !== undefined) patch.schema = input.schema;
    await this.db.update(intakeForms).set(patch).where(eq(intakeForms.id, input.formId));
  }

  async getForm(input: { formId: string }): Promise<{
    form: typeof intakeForms.$inferSelect;
    answers: Array<typeof intakeFormAnswers.$inferSelect & { documentFilename: string | null }>;
  }> {
    const [form] = await this.db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    const answers = await this.db
      .select({
        id: intakeFormAnswers.id,
        formId: intakeFormAnswers.formId,
        fieldId: intakeFormAnswers.fieldId,
        valueText: intakeFormAnswers.valueText,
        valueNumber: intakeFormAnswers.valueNumber,
        valueDate: intakeFormAnswers.valueDate,
        valueBool: intakeFormAnswers.valueBool,
        valueJson: intakeFormAnswers.valueJson,
        documentId: intakeFormAnswers.documentId,
        updatedAt: intakeFormAnswers.updatedAt,
        documentFilename: documents.filename,
      })
      .from(intakeFormAnswers)
      .leftJoin(documents, eq(documents.id, intakeFormAnswers.documentId))
      .where(eq(intakeFormAnswers.formId, input.formId));
    return { form, answers };
  }

  async listForCase(input: { caseId: string; viewerType: "lawyer" | "portal" }) {
    const rows = await this.db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.caseId, input.caseId))
      .orderBy(desc(intakeForms.updatedAt));
    const visible = input.viewerType === "portal"
      ? rows.filter((r) => r.status !== "draft" && r.status !== "cancelled")
      : rows;
    if (visible.length === 0) {
      return { forms: [] as Array<(typeof visible)[number] & { answeredCount: number; requiredCount: number }> };
    }
    const counts = await this.db
      .select({
        formId: intakeFormAnswers.formId,
        total: sql<number>`count(*)::int`,
      })
      .from(intakeFormAnswers)
      .where(inArray(intakeFormAnswers.formId, visible.map((r) => r.id)))
      .groupBy(intakeFormAnswers.formId);
    const answeredMap = new Map(counts.map((c) => [c.formId, c.total]));
    return {
      forms: visible.map((r) => {
        const schema = (r.schema as FormSchema) ?? { fields: [] };
        const requiredCount = schema.fields.filter((f) => f.required).length;
        return {
          ...r,
          answeredCount: Number(answeredMap.get(r.id) ?? 0),
          requiredCount,
        };
      }),
    };
  }
}
```

- [ ] **Step 2: Write three smoke tests**

```ts
// tests/integration/intake-forms-service.test.ts
import { describe, it, expect } from "vitest";
import { IntakeFormsService } from "@/server/services/intake-forms/service";

/**
 * Mock-db pattern adapted from tests/integration/collections-service.test.ts
 * and tests/integration/document-requests-service.test.ts.
 */
function makeMockDb() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  const selectQueue: unknown[][] = [];
  let idCounter = 0;
  const nextId = () => `row-${++idCounter}`;
  const db = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        const rows = Array.isArray(v)
          ? (v as Array<Record<string, unknown>>).map((r) => ({ id: nextId(), ...r }))
          : [{ id: nextId(), ...(v as Record<string, unknown>) }];
        return { returning: async () => rows };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => {
        updates.push({ table: t, set: s });
        return { where: () => Promise.resolve() };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
          orderBy: () => ({ limit: async () => selectQueue.shift() ?? [] }),
        }),
        orderBy: () => ({ limit: async () => selectQueue.shift() ?? [] }),
        leftJoin: () => ({
          where: async () => selectQueue.shift() ?? [],
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    enqueue: (rows: unknown[]) => selectQueue.push(rows),
  } as any;
  return { db, inserts, updates };
}

describe("IntakeFormsService.createDraft", () => {
  it("inserts a form with empty schema in 'draft' status", async () => {
    const { db, inserts } = makeMockDb();
    const svc = new IntakeFormsService({ db, inngest: { send: async () => {} } });
    const res = await svc.createDraft({
      caseId: "c1",
      title: "Intake",
      description: "Please fill",
      createdBy: "u1",
    });
    expect(res.formId).toBeTruthy();
    const values = inserts[0]?.values as Record<string, unknown>;
    expect(values.status).toBe("draft");
    expect(values.title).toBe("Intake");
    expect(values.schema).toEqual({ fields: [] });
  });
});

describe("IntakeFormsService.updateDraft", () => {
  it("rejects edits when status is not draft", async () => {
    const { db } = makeMockDb();
    db.enqueue([{ status: "sent" }]);
    const svc = new IntakeFormsService({ db, inngest: { send: async () => {} } });
    await expect(
      svc.updateDraft({ formId: "f1", title: "New" }),
    ).rejects.toThrow(/only be edited while in draft/);
  });

  it("accepts a valid schema on a draft form", async () => {
    const { db, updates } = makeMockDb();
    db.enqueue([{ status: "draft" }]);
    const svc = new IntakeFormsService({ db, inngest: { send: async () => {} } });
    await svc.updateDraft({
      formId: "f1",
      schema: {
        fields: [
          {
            id: "00000000-0000-0000-0000-000000000001",
            type: "short_text",
            label: "Full name",
            required: true,
          },
        ],
      },
    });
    const set = updates[0]?.set as Record<string, unknown>;
    expect(set.schema).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/integration/intake-forms-service.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 4: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/intake-forms/service.ts tests/integration/intake-forms-service.test.ts
git commit -m "feat(2.3.3): IntakeFormsService — draft CRUD + smoke tests"
```

---

### Task 6: Service — send / cancel / saveAnswer / lifecycle transitions

**Files:**
- Modify: `src/server/services/intake-forms/service.ts`

- [ ] **Step 1: Append methods to the class**

Read the current file, then append **before the class closing `}`**:

```ts
  async sendForm(input: { formId: string }): Promise<void> {
    const [form] = await this.db
      .select({ id: intakeForms.id, status: intakeForms.status, schema: intakeForms.schema, caseId: intakeForms.caseId })
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    if (form.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft forms can be sent" });
    }
    const schema = (form.schema as FormSchema) ?? { fields: [] };
    if (schema.fields.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Form must have at least one field before sending" });
    }
    await this.db
      .update(intakeForms)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(intakeForms.id, input.formId));
    await this.inngest.send({
      name: "messaging/intake_form.sent",
      data: { formId: input.formId, caseId: form.caseId },
    });
  }

  async cancelForm(input: { formId: string; cancelledBy: string }): Promise<void> {
    const [form] = await this.db
      .select({ id: intakeForms.id, status: intakeForms.status, caseId: intakeForms.caseId })
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    if (form.status === "submitted" || form.status === "cancelled") return;

    const priorStatus = form.status;
    await this.db
      .update(intakeForms)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(intakeForms.id, input.formId));

    // Only notify portal if the form had been sent (drafts never reached the client)
    if (priorStatus !== "draft") {
      await this.inngest.send({
        name: "messaging/intake_form.cancelled",
        data: { formId: input.formId, caseId: form.caseId, cancelledBy: input.cancelledBy },
      });
    }
  }

  async saveAnswer(input: {
    formId: string;
    fieldId: string;
    value: unknown;
  }): Promise<{ status: string }> {
    const [form] = await this.db
      .select({ id: intakeForms.id, status: intakeForms.status, schema: intakeForms.schema })
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    if (form.status !== "sent" && form.status !== "in_progress") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot save answers on a ${form.status} form` });
    }
    const schema = (form.schema as FormSchema) ?? { fields: [] };
    const field = schema.fields.find((f) => f.id === input.fieldId);
    if (!field) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown field" });

    let routed: ReturnType<typeof routeAnswerValue>;
    try {
      routed = routeAnswerValue(field, input.value);
    } catch (err) {
      throw new TRPCError({ code: "BAD_REQUEST", message: (err as Error).message });
    }

    await this.db
      .insert(intakeFormAnswers)
      .values({
        formId: input.formId,
        fieldId: input.fieldId,
        valueText: routed.valueText,
        valueNumber: routed.valueNumber,
        valueDate: routed.valueDate,
        valueBool: routed.valueBool,
        valueJson: routed.valueJson as any,
        documentId: routed.documentId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [intakeFormAnswers.formId, intakeFormAnswers.fieldId],
        set: {
          valueText: routed.valueText,
          valueNumber: routed.valueNumber,
          valueDate: routed.valueDate,
          valueBool: routed.valueBool,
          valueJson: routed.valueJson as any,
          documentId: routed.documentId,
          updatedAt: new Date(),
        },
      });

    let nextStatus = form.status;
    if (form.status === "sent") {
      await this.db
        .update(intakeForms)
        .set({ status: "in_progress", updatedAt: new Date() })
        .where(eq(intakeForms.id, input.formId));
      nextStatus = "in_progress";
    }
    return { status: nextStatus };
  }

  async submitForm(input: { formId: string }): Promise<void> {
    const [form] = await this.db
      .select({ id: intakeForms.id, status: intakeForms.status, schema: intakeForms.schema, caseId: intakeForms.caseId })
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    if (form.status === "submitted") return;
    if (form.status !== "sent" && form.status !== "in_progress") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot submit a ${form.status} form` });
    }

    const schema = (form.schema as FormSchema) ?? { fields: [] };
    const requiredIds = schema.fields.filter((f) => f.required).map((f) => f.id);
    if (requiredIds.length > 0) {
      const answered = await this.db
        .select({ fieldId: intakeFormAnswers.fieldId })
        .from(intakeFormAnswers)
        .where(
          and(
            eq(intakeFormAnswers.formId, input.formId),
            inArray(intakeFormAnswers.fieldId, requiredIds),
          ),
        );
      const answeredIds = new Set(answered.map((a) => a.fieldId));
      const missing = requiredIds.filter((id) => !answeredIds.has(id));
      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Required fields not answered: ${missing.length}`,
        });
      }
    }

    await this.db
      .update(intakeForms)
      .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(intakeForms.id, input.formId));
    await this.inngest.send({
      name: "messaging/intake_form.submitted",
      data: { formId: input.formId, caseId: form.caseId },
    });
  }

  /** Used by sidebar badge. Counts forms in submitted status across accessible cases. */
  async submittedCount(input: { userId: string; orgId: string | null }): Promise<{ count: number }> {
    const orgClause = input.orgId
      ? sql`${cases.orgId} = ${input.orgId}`
      : sql`${cases.userId} = ${input.userId}`;
    const rows = await this.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${intakeForms} f
      JOIN ${cases} c ON c.id = f.case_id
      WHERE ${orgClause} AND f.status = 'submitted'
    `);
    const list = ((rows as any).rows ?? rows) as Array<{ count: number }>;
    return { count: Number(list[0]?.count ?? 0) };
  }
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run tests/integration/intake-forms-service.test.ts`
Expected: 3/3 still pass (new methods not covered by tests — state-transition behavior best validated by live UAT).

- [ ] **Step 4: Commit**

```bash
git add src/server/services/intake-forms/service.ts
git commit -m "feat(2.3.3): lifecycle transitions — send, cancel, saveAnswer, submit, submittedCount"
```

---

### Task 7: tRPC router — lawyer

**Files:**
- Create: `src/server/trpc/routers/intake-forms.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Read 2.3.2 reference**

Read `src/server/trpc/routers/document-requests.ts` (mirrors the exact patterns: `protectedProcedure`, `assertCaseAccess(ctx, caseId)`, `ctx.user.id` / `ctx.user.orgId`, zod v4).

- [ ] **Step 2: Write router**

```ts
// src/server/trpc/routers/intake-forms.ts
import { z } from "zod/v4";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { IntakeFormsService } from "@/server/services/intake-forms/service";
import { formSchemaSchema } from "@/server/services/intake-forms/schema-validation";

export const intakeFormsRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new IntakeFormsService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId, viewerType: "lawyer" });
    }),

  get: protectedProcedure
    .input(z.object({ formId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form, answers } = await svc.getForm({ formId: input.formId });
      await assertCaseAccess(ctx, form.caseId);
      return { form, answers };
    }),

  createDraft: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      description: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new IntakeFormsService({ db: ctx.db });
      return svc.createDraft({ ...input, createdBy: ctx.user.id });
    }),

  updateDraft: protectedProcedure
    .input(z.object({
      formId: z.string().uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      schema: formSchemaSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form } = await svc.getForm({ formId: input.formId });
      await assertCaseAccess(ctx, form.caseId);
      await svc.updateDraft(input);
      return { ok: true as const };
    }),

  send: protectedProcedure
    .input(z.object({ formId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form } = await svc.getForm({ formId: input.formId });
      await assertCaseAccess(ctx, form.caseId);
      await svc.sendForm({ formId: input.formId });
      return { ok: true as const };
    }),

  cancel: protectedProcedure
    .input(z.object({ formId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form } = await svc.getForm({ formId: input.formId });
      await assertCaseAccess(ctx, form.caseId);
      await svc.cancelForm({ formId: input.formId, cancelledBy: ctx.user.id });
      return { ok: true as const };
    }),

  submittedCount: protectedProcedure.query(async ({ ctx }) => {
    const svc = new IntakeFormsService({ db: ctx.db });
    return svc.submittedCount({ userId: ctx.user.id, orgId: ctx.user.orgId ?? null });
  }),
});
```

- [ ] **Step 3: Register in root**

In `src/server/trpc/root.ts`:
- Add import: `import { intakeFormsRouter } from "./routers/intake-forms";`
- Inside the `router({ ... })` call: `intakeForms: intakeFormsRouter,`

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/intake-forms.ts src/server/trpc/root.ts
git commit -m "feat(2.3.3): lawyer-side intakeForms tRPC router"
```

---

### Task 8: tRPC router — portal

**Files:**
- Create: `src/server/trpc/routers/portal-intake-forms.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Read 2.3.2 portal reference**

Read `src/server/trpc/routers/portal-document-requests.ts` to verify the exact pattern (`portalProcedure` builder, inlined `assertPortalCaseAccess`, ctx shape).

- [ ] **Step 2: Write router**

```ts
// src/server/trpc/routers/portal-intake-forms.ts
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { portalProcedure, router } from "@/server/trpc/trpc";
import { IntakeFormsService } from "@/server/services/intake-forms/service";
import { cases } from "@/server/db/schema/cases";

async function assertPortalCaseAccess(ctx: any, caseId: string) {
  const [row] = await ctx.db
    .select({ clientId: cases.clientId })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  if (!row || row.clientId !== ctx.portalUser.clientId) {
    throw new Error("Forbidden");
  }
}

export const portalIntakeFormsRouter = router({
  list: portalProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPortalCaseAccess(ctx, input.caseId);
      const svc = new IntakeFormsService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId, viewerType: "portal" });
    }),

  get: portalProcedure
    .input(z.object({ formId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form, answers } = await svc.getForm({ formId: input.formId });
      await assertPortalCaseAccess(ctx, form.caseId);
      // portal never sees drafts / cancelled
      if (form.status === "draft" || form.status === "cancelled") {
        throw new Error("Forbidden");
      }
      return { form, answers };
    }),

  saveAnswer: portalProcedure
    .input(z.object({
      formId: z.string().uuid(),
      fieldId: z.string().min(1).max(100),
      // value is unknown at the zod level — the service routes per field type
      value: z.unknown(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form } = await svc.getForm({ formId: input.formId });
      await assertPortalCaseAccess(ctx, form.caseId);
      return svc.saveAnswer(input);
    }),

  submit: portalProcedure
    .input(z.object({ formId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form } = await svc.getForm({ formId: input.formId });
      await assertPortalCaseAccess(ctx, form.caseId);
      await svc.submitForm({ formId: input.formId });
      return { ok: true as const };
    }),
});
```

- [ ] **Step 3: Register in root**

In `src/server/trpc/root.ts`:
- Add import: `import { portalIntakeFormsRouter } from "./routers/portal-intake-forms";`
- Inside the `router({ ... })` call: `portalIntakeForms: portalIntakeFormsRouter,`

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/portal-intake-forms.ts src/server/trpc/root.ts
git commit -m "feat(2.3.3): portal-side intakeForms tRPC router"
```

---

### Task 9: Inngest broadcast + notification consumers

**Files:**
- Create: `src/server/inngest/functions/intake-form-broadcast.ts`
- Create: `src/server/inngest/functions/intake-form-notifications.ts`
- Modify: `src/server/inngest/index.ts`
- Modify: `src/server/inngest/functions/handle-notification.ts`

Reference: `src/server/inngest/functions/document-request-broadcast.ts` + `document-request-notifications.ts` (2.3.2 shipped).

- [ ] **Step 1: Write broadcast functions**

```ts
// src/server/inngest/functions/intake-form-broadcast.ts
//
// Fans out 3 notification events from canonical messaging/intake_form.* events.
// Mirror of document-request-broadcast.ts (Inngest v4 two-arg createFunction).

import { inngest } from "@/server/inngest/client";
import { db as defaultDb } from "@/server/db";
import { eq } from "drizzle-orm";
import { intakeForms } from "@/server/db/schema/intake-forms";
import { cases } from "@/server/db/schema/cases";
import { portalRecipients, lawyerRecipients } from "@/server/services/messaging/recipients";

async function loadContext(formId: string) {
  const [form] = await defaultDb
    .select({ id: intakeForms.id, caseId: intakeForms.caseId, title: intakeForms.title, schema: intakeForms.schema })
    .from(intakeForms)
    .where(eq(intakeForms.id, formId))
    .limit(1);
  if (!form) return null;
  const [caseRow] = await defaultDb
    .select({ id: cases.id, name: cases.name, clientId: cases.clientId, orgId: cases.orgId, ownerId: cases.userId })
    .from(cases)
    .where(eq(cases.id, form.caseId))
    .limit(1);
  if (!caseRow) return null;
  const fieldCount = Array.isArray((form.schema as any)?.fields) ? (form.schema as any).fields.length : 0;
  return { form, caseRow, fieldCount };
}

export const intakeFormSentBroadcast = inngest.createFunction(
  { id: "intake-form-sent-broadcast", retries: 1, triggers: [{ event: "messaging/intake_form.sent" }] },
  async ({ event }) => {
    const { formId } = event.data as { formId: string };
    const ctx = await loadContext(formId);
    if (!ctx) return { skipped: true };
    const portals = await portalRecipients(ctx.caseRow.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.intake_form_sent",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          formId,
          formTitle: ctx.form.title,
          fieldCount: ctx.fieldCount,
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);

export const intakeFormSubmittedBroadcast = inngest.createFunction(
  { id: "intake-form-submitted-broadcast", retries: 1, triggers: [{ event: "messaging/intake_form.submitted" }] },
  async ({ event }) => {
    const { formId } = event.data as { formId: string };
    const ctx = await loadContext(formId);
    if (!ctx) return { skipped: true };
    const lawyers = await lawyerRecipients(ctx.caseRow.id, ctx.caseRow.ownerId);
    for (const userId of lawyers) {
      await inngest.send({
        name: "notification.intake_form_submitted",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          formId,
          formTitle: ctx.form.title,
          recipientUserId: userId,
        },
      });
    }
    return { lawyers: lawyers.length };
  },
);

export const intakeFormCancelledBroadcast = inngest.createFunction(
  { id: "intake-form-cancelled-broadcast", retries: 1, triggers: [{ event: "messaging/intake_form.cancelled" }] },
  async ({ event }) => {
    const { formId } = event.data as { formId: string };
    const ctx = await loadContext(formId);
    if (!ctx) return { skipped: true };
    const portals = await portalRecipients(ctx.caseRow.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.intake_form_cancelled",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          formId,
          formTitle: ctx.form.title,
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);
```

- [ ] **Step 2: Write notification consumer functions**

Follow the shape of `src/server/inngest/functions/document-request-notifications.ts` (2.3.2 reference). Open that file first to match its handler signature, its dispatch helpers (`sendPortalNotificationEmail` / the portal+lawyer dispatch flow), and its Inngest `createFunction` shape.

```ts
// src/server/inngest/functions/intake-form-notifications.ts
//
// Consumes notification.intake_form_* events and dispatches per the matrix in
// docs/superpowers/specs/2026-04-20-intake-forms-design.md §5.4.
//
// Mirrors document-request-notifications.ts. In-app and email are delivered
// through the existing pipelines; portal push remains unsupported (architectural
// gap flagged across 2.3.1/2.3.2/2.3.3).

import { inngest } from "@/server/inngest/client";

export const intakeFormSentConsumer = inngest.createFunction(
  { id: "intake-form-sent-consumer", retries: 1, triggers: [{ event: "notification.intake_form_sent" }] },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      formId: string;
      formTitle: string;
      fieldCount: number;
      recipientPortalUserId: string;
    };
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "intake_form_sent",
        title: `New intake form: ${d.formTitle}`,
        body: `Your lawyer has sent a form with ${d.fieldCount} question${d.fieldCount === 1 ? "" : "s"} for ${d.caseName}.`,
        caseId: d.caseId,
        actionUrl: `/portal/intake/${d.formId}`,
        metadata: d,
      },
    });
    return { dispatched: true };
  },
);

export const intakeFormSubmittedConsumer = inngest.createFunction(
  { id: "intake-form-submitted-consumer", retries: 1, triggers: [{ event: "notification.intake_form_submitted" }] },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      formId: string;
      formTitle: string;
      recipientUserId: string;
    };
    await inngest.send({
      name: "notification/send",
      data: {
        userId: d.recipientUserId,
        type: "intake_form_submitted",
        title: `Client submitted: ${d.formTitle}`,
        body: `The client has submitted the intake form for ${d.caseName}.`,
        caseId: d.caseId,
        actionUrl: `/cases/${d.caseId}?tab=intake`,
        metadata: d,
      },
    });
    return { dispatched: true };
  },
);

export const intakeFormCancelledConsumer = inngest.createFunction(
  { id: "intake-form-cancelled-consumer", retries: 1, triggers: [{ event: "notification.intake_form_cancelled" }] },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      formId: string;
      formTitle: string;
      recipientPortalUserId: string;
    };
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "intake_form_cancelled",
        title: `Form cancelled: ${d.formTitle}`,
        body: `The intake form for ${d.caseName} is no longer needed.`,
        caseId: d.caseId,
        actionUrl: `/portal/cases/${d.caseId}`,
        metadata: d,
      },
    });
    return { dispatched: true };
  },
);
```

**If the event names `portal-notification/send` / `notification/send` differ** in the codebase's actual 2.3.2 consumers, mirror whatever name those use — verify during implementation by reading `document-request-notifications.ts`. Do **not** invent new event names.

- [ ] **Step 3: Add lawyer email case in handler**

Open `src/server/inngest/functions/handle-notification.ts` and find the switch/case where 2.3.2 `document_request_submitted` adds an email case. Add analogous case for `intake_form_submitted`:

```ts
case "intake_form_submitted": {
  const d = event.data.metadata as any;
  await sendEmail({
    to: event.data.recipientEmail,
    subject: `Intake form submitted: ${d.formTitle}`,
    html: `<p>The client has submitted the intake form <strong>${d.formTitle}</strong> for case ${d.caseName}.</p>
           <p><a href="${process.env.APP_URL}/cases/${d.caseId}?tab=intake">Review answers</a></p>`,
  });
  break;
}
```

The exact `sendEmail` helper + variable names must match the 2.3.2 cases already in the file — mirror them.

- [ ] **Step 4: Register 6 functions**

In `src/server/inngest/index.ts`:

Add import:
```ts
import {
  intakeFormSentBroadcast,
  intakeFormSubmittedBroadcast,
  intakeFormCancelledBroadcast,
} from "./functions/intake-form-broadcast";
import {
  intakeFormSentConsumer,
  intakeFormSubmittedConsumer,
  intakeFormCancelledConsumer,
} from "./functions/intake-form-notifications";
```

Append to the `functions` array (after the 2.3.2 entries):
```ts
  intakeFormSentBroadcast,
  intakeFormSubmittedBroadcast,
  intakeFormCancelledBroadcast,
  intakeFormSentConsumer,
  intakeFormSubmittedConsumer,
  intakeFormCancelledConsumer,
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

Run: `npx next build 2>&1 | tail -10`
Expected: build success.

- [ ] **Step 6: Commit**

```bash
git add src/server/inngest/functions/intake-form-broadcast.ts src/server/inngest/functions/intake-form-notifications.ts src/server/inngest/functions/handle-notification.ts src/server/inngest/index.ts
git commit -m "feat(2.3.3): Inngest broadcast + notification consumers for intake forms"
```

---

### Task 10: Lawyer UI — NewIntakeFormModal + FormBuilder

**Files:**
- Create: `src/components/cases/intake/new-intake-form-modal.tsx`
- Create: `src/components/cases/intake/form-builder.tsx`

- [ ] **Step 1: Write `NewIntakeFormModal`**

```tsx
// src/components/cases/intake/new-intake-form-modal.tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface NewIntakeFormModalProps {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (formId: string) => void;
}

export function NewIntakeFormModal({ caseId, open, onOpenChange, onCreated }: NewIntakeFormModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const utils = trpc.useUtils();

  const create = trpc.intakeForms.createDraft.useMutation({
    onSuccess: async (res) => {
      toast.success("Form created");
      await utils.intakeForms.list.invalidate({ caseId });
      onCreated?.(res.formId);
      setTitle(""); setDescription("");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function submit() {
    if (!title.trim()) { toast.error("Title required"); return; }
    create.mutate({
      caseId,
      title: title.trim(),
      description: description.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Intake Form</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Initial Intake" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              placeholder="Brief context for the client" />
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

- [ ] **Step 2: Write `FormBuilder`**

```tsx
// src/components/cases/intake/form-builder.tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowUp, ArrowDown, Trash2, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { FIELD_TYPES, type FieldSpec, type FormSchema } from "@/server/services/intake-forms/schema-validation";

const FIELD_TYPE_LABELS: Record<string, string> = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  date: "Date",
  select: "Single choice",
  multi_select: "Multiple choice",
  yes_no: "Yes / No",
  file_upload: "File upload",
};

function newField(type: FieldSpec["type"]): FieldSpec {
  const id = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const base: FieldSpec = { id, type, label: FIELD_TYPE_LABELS[type], required: false };
  if (type === "select" || type === "multi_select") {
    return {
      ...base,
      options: [
        { value: "option_1", label: "Option 1" },
        { value: "option_2", label: "Option 2" },
      ],
    };
  }
  return base;
}

interface FormBuilderProps {
  formId: string;
  caseId: string;
  initialTitle: string;
  initialDescription: string | null;
  initialSchema: FormSchema;
}

export function FormBuilder({ formId, caseId, initialTitle, initialDescription, initialSchema }: FormBuilderProps) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [fields, setFields] = useState<FieldSpec[]>(initialSchema.fields);

  const save = trpc.intakeForms.updateDraft.useMutation({
    onSuccess: async () => {
      await utils.intakeForms.get.invalidate({ formId });
      await utils.intakeForms.list.invalidate({ caseId });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const send = trpc.intakeForms.send.useMutation({
    onSuccess: async () => {
      await utils.intakeForms.get.invalidate({ formId });
      await utils.intakeForms.list.invalidate({ caseId });
      toast.success("Sent to client");
    },
    onError: (e) => toast.error(e.message),
  });

  function updateField(id: string, patch: Partial<FieldSpec>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function moveField(id: string, delta: -1 | 1) {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      if (idx < 0) return prev;
      const target = idx + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }
  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }
  function addField(type: FieldSpec["type"]) {
    setFields((prev) => [...prev, newField(type)]);
  }

  function handleSave() {
    save.mutate({
      formId,
      title: title.trim(),
      description: description.trim() || null,
      schema: { fields },
    });
  }

  function handleSend() {
    if (fields.length === 0) { toast.error("Add at least one field"); return; }
    // Save first, then send — simpler than chaining onSuccess
    save.mutate(
      { formId, title: title.trim(), description: description.trim() || null, schema: { fields } },
      { onSuccess: () => send.mutate({ formId }) },
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
      </div>

      <div className="space-y-2">
        {fields.map((field, idx) => (
          <div key={field.id} className="border rounded p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-6">{idx + 1}.</span>
              <Input
                className="flex-1"
                value={field.label}
                onChange={(e) => updateField(field.id, { label: e.target.value })}
                placeholder="Field label"
              />
              <Select
                value={field.type}
                onValueChange={(v) => updateField(field.id, { type: v as FieldSpec["type"] })}
              >
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{FIELD_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="icon" variant="ghost" onClick={() => moveField(field.id, -1)} disabled={idx === 0}>
                <ArrowUp className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => moveField(field.id, 1)} disabled={idx === fields.length - 1}>
                <ArrowDown className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => removeField(field.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            <Input
              value={field.description ?? ""}
              onChange={(e) => updateField(field.id, { description: e.target.value || undefined })}
              placeholder="Description (optional)"
            />
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`req-${field.id}`}
                checked={field.required}
                onCheckedChange={(v) => updateField(field.id, { required: v === true })}
              />
              <label htmlFor={`req-${field.id}`}>Required</label>
            </div>
            {(field.type === "select" || field.type === "multi_select") && (
              <OptionsEditor
                options={field.options ?? []}
                onChange={(options) => updateField(field.id, { options })}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {FIELD_TYPES.map((t) => (
          <Button key={t} size="sm" variant="outline" onClick={() => addField(t)}>
            <Plus className="w-4 h-4 mr-1" /> {FIELD_TYPE_LABELS[t]}
          </Button>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="outline" onClick={handleSave} disabled={save.isPending}>Save draft</Button>
        <Button onClick={handleSend} disabled={save.isPending || send.isPending}>
          <Send className="w-4 h-4 mr-1" /> Send to client
        </Button>
      </div>
    </div>
  );
}

function OptionsEditor({ options, onChange }: {
  options: Array<{ value: string; label: string }>;
  onChange: (o: Array<{ value: string; label: string }>) => void;
}) {
  return (
    <div className="space-y-1 ml-8">
      {options.map((opt, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            value={opt.label}
            onChange={(e) => onChange(options.map((o, j) => j === i ? { ...o, label: e.target.value, value: e.target.value.toLowerCase().replace(/\s+/g, "_") } : o))}
            placeholder="Option label"
          />
          <Button size="icon" variant="ghost" onClick={() => onChange(options.filter((_, j) => j !== i))} disabled={options.length <= 2}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...options, { value: `option_${options.length + 1}`, label: `Option ${options.length + 1}` }])}>
        <Plus className="w-4 h-4 mr-1" /> Add option
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

If missing `@/components/ui/select` or `@/components/ui/checkbox`, verify they exist (they should; shadcn/ui is already used elsewhere — check `src/components/ui/`). If not present, **do not** add new packages; ask the user which shadcn primitives to generate before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/intake/new-intake-form-modal.tsx src/components/cases/intake/form-builder.tsx
git commit -m "feat(2.3.3): NewIntakeFormModal + FormBuilder (lawyer draft UI)"
```

---

### Task 11: Lawyer UI — IntakeFormDetail + IntakeTab

**Files:**
- Create: `src/components/cases/intake/intake-form-detail.tsx`
- Create: `src/components/cases/intake/intake-tab.tsx`

- [ ] **Step 1: Write `IntakeFormDetail`**

```tsx
// src/components/cases/intake/intake-form-detail.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Printer, FileText } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { FormBuilder } from "./form-builder";
import type { FormSchema } from "@/server/services/intake-forms/schema-validation";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  submitted: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function IntakeFormDetail({ formId, caseId }: { formId: string; caseId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.intakeForms.get.useQuery({ formId });
  const cancel = trpc.intakeForms.cancel.useMutation({
    onSuccess: async () => {
      await utils.intakeForms.get.invalidate({ formId });
      await utils.intakeForms.list.invalidate({ caseId });
      toast.success("Cancelled");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-4 text-sm text-muted-foreground">Form not found</div>;

  const { form, answers } = data;
  const schema = (form.schema as FormSchema) ?? { fields: [] };
  const answerMap = new Map(answers.map((a) => [a.fieldId, a]));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{form.title}</h3>
          {form.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{form.description}</p>}
          <div className="text-xs text-muted-foreground mt-1">
            {form.submittedAt
              ? `Submitted ${format(new Date(form.submittedAt), "PP p")}`
              : form.sentAt
              ? `Sent ${formatDistanceToNow(new Date(form.sentAt), { addSuffix: true })}`
              : `Created ${formatDistanceToNow(new Date(form.createdAt), { addSuffix: true })}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={STATUS_STYLES[form.status]}>{form.status}</Badge>
          {form.status === "submitted" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(`/cases/${caseId}/intake/${formId}/print`, "_blank")}
            >
              <Printer className="w-4 h-4 mr-1" /> PDF
            </Button>
          )}
          {form.status !== "submitted" && form.status !== "cancelled" && (
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ formId })}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {form.status === "draft" && (
        <FormBuilder
          formId={formId}
          caseId={caseId}
          initialTitle={form.title}
          initialDescription={form.description}
          initialSchema={schema}
        />
      )}

      {(form.status === "sent" || form.status === "in_progress") && (
        <div className="border rounded p-3 text-sm">
          <p className="text-muted-foreground">
            Waiting for client to fill out the form. You'll see answers once submitted.
          </p>
          <ul className="mt-3 space-y-1 text-muted-foreground">
            {schema.fields.map((f, i) => (
              <li key={f.id}>{i + 1}. {f.label}{f.required ? " *" : ""}</li>
            ))}
          </ul>
        </div>
      )}

      {form.status === "submitted" && (
        <ul className="space-y-3">
          {schema.fields.map((f) => {
            const ans = answerMap.get(f.id);
            return (
              <li key={f.id} className="border-b pb-2">
                <div className="text-sm font-medium">{f.label}{f.required ? " *" : ""}</div>
                {f.description && <div className="text-xs text-muted-foreground">{f.description}</div>}
                <div className="text-sm mt-1">{renderAnswer(f.type, ans)}</div>
              </li>
            );
          })}
        </ul>
      )}

      {form.status === "cancelled" && (
        <p className="text-sm text-muted-foreground italic">This form was cancelled.</p>
      )}
    </div>
  );
}

function renderAnswer(type: string, ans: any): React.ReactNode {
  if (!ans) return <span className="text-muted-foreground italic">No answer</span>;
  switch (type) {
    case "short_text":
    case "long_text":
    case "select":
      return ans.valueText ?? "";
    case "number":
      return ans.valueNumber ?? "";
    case "date":
      return ans.valueDate ?? "";
    case "yes_no":
      return ans.valueBool === true ? "Yes" : ans.valueBool === false ? "No" : "";
    case "multi_select":
      return Array.isArray(ans.valueJson) ? ans.valueJson.join(", ") : "";
    case "file_upload":
      return <span className="inline-flex items-center gap-1"><FileText className="w-4 h-4" />{ans.documentFilename ?? "(file)"}</span>;
    default:
      return "";
  }
}
```

- [ ] **Step 2: Write `IntakeTab`**

```tsx
// src/components/cases/intake/intake-tab.tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { NewIntakeFormModal } from "./new-intake-form-modal";
import { IntakeFormDetail } from "./intake-form-detail";

const REQ_STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  submitted: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground",
};

export function IntakeTab({ caseId }: { caseId: string }) {
  const { data } = trpc.intakeForms.list.useQuery({ caseId });
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const forms = data?.forms ?? [];
  const active = selectedId ?? forms[0]?.id ?? null;

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-80 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Intake Forms</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {forms.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No forms yet. Create one to ask the client structured questions.</p>
          ) : (
            <ul>
              {forms.map((f) => {
                const isActive = f.id === active;
                return (
                  <li
                    key={f.id}
                    className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
                    onClick={() => setSelectedId(f.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{f.title}</span>
                      <Badge className={REQ_STATUS_STYLES[f.status]}>{f.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                      <span>{f.answeredCount}/{f.requiredCount} required answered</span>
                      <span>{formatDistanceToNow(new Date(f.updatedAt), { addSuffix: true })}</span>
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
          <IntakeFormDetail formId={active} caseId={caseId} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Select a form or create a new one.</p>
        )}
      </section>
      <NewIntakeFormModal
        caseId={caseId}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/intake/intake-form-detail.tsx src/components/cases/intake/intake-tab.tsx
git commit -m "feat(2.3.3): IntakeFormDetail + IntakeTab (lawyer UI)"
```

---

### Task 12: Mount `intake` tab + extend sidebar badge

**Files:**
- Modify: `src/app/(app)/cases/[id]/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add tab**

In `src/app/(app)/cases/[id]/page.tsx`:

- Extend `TABS` array — after `{ key: "requests", label: "Requests" }` append:
  ```ts
  { key: "intake", label: "Intake" },
  ```
- Add import:
  ```ts
  import { IntakeTab } from "@/components/cases/intake/intake-tab";
  ```
- In the tab conditional block, after the requests conditional, add:
  ```tsx
  {activeTab === "intake" && <IntakeTab caseId={caseData.id} />}
  ```

- [ ] **Step 2: Extend sidebar badge**

In `src/components/layout/sidebar.tsx`, find the 2-source composite used by 2.3.2 (sums `unreadByCase` + `pendingReviewCount`). Add a third source:

```ts
const { data: submittedForms } = trpc.intakeForms.submittedCount.useQuery(undefined, { refetchInterval: 30_000 });
const totalBadge = (unreadCases?.count ?? 0) + (pendingReview?.count ?? 0) + (submittedForms?.count ?? 0);
```

Update the `title` tooltip:
```ts
title={`${unreadCases?.count ?? 0} unread · ${pendingReview?.count ?? 0} awaiting review · ${submittedForms?.count ?? 0} submitted`}
```

Keep the existing cap-at-"9+" logic.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx next build 2>&1 | tail -10` — success, `/cases/[id]` route present.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/cases/\[id\]/page.tsx src/components/layout/sidebar.tsx
git commit -m "feat(2.3.3): mount Intake tab + extend sidebar badge"
```

---

### Task 13: Portal UI — IntakeFormsCard + mount on case page

**Files:**
- Create: `src/components/portal/intake-forms-card.tsx`
- Modify: `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx`

- [ ] **Step 1: Write card**

```tsx
// src/components/portal/intake-forms-card.tsx
"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  submitted: "bg-green-100 text-green-800",
};

export function IntakeFormsCard({ caseId }: { caseId: string }) {
  const { data } = trpc.portalIntakeForms.list.useQuery({ caseId });

  const active = (data?.forms ?? []).filter((f) => f.status === "sent" || f.status === "in_progress");
  const closed = (data?.forms ?? []).filter((f) => f.status === "submitted");
  if (active.length === 0 && closed.length === 0) return null;

  return (
    <section className="mb-6 space-y-3">
      <h2 className="text-lg font-semibold">Intake Forms</h2>
      {active.map((f) => (
        <Card key={f.id}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{f.title}</span>
                <Badge className={STATUS_STYLES[f.status]}>{f.status}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {f.answeredCount}/{f.requiredCount} required answered
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Link href={`/portal/intake/${f.id}`}>
              <Button size="sm">{f.status === "sent" ? "Start" : "Continue"}</Button>
            </Link>
          </CardContent>
        </Card>
      ))}
      {closed.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Submitted ({closed.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {closed.map((f) => (
              <li key={f.id} className="text-sm flex items-center gap-2">
                <Badge className={STATUS_STYLES[f.status]}>submitted</Badge>
                <span>{f.title}</span>
                <span className="text-muted-foreground ml-auto">
                  {formatDistanceToNow(new Date(f.updatedAt), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Mount on portal case page**

In `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx`:
- Add import: `import { IntakeFormsCard } from "@/components/portal/intake-forms-card";`
- Insert `<IntakeFormsCard caseId={caseData.id} />` directly above the existing `<DocumentRequestsSection />` mount. Use whatever variable the file uses for the case id.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx next build 2>&1 | tail -10` — success.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/intake-forms-card.tsx src/app/\(portal\)/portal/\(authenticated\)/cases/\[id\]/page.tsx
git commit -m "feat(2.3.3): portal IntakeFormsCard + mount on case page"
```

---

### Task 14: Portal full-screen fill page

**Files:**
- Create: `src/components/portal/intake/fields.tsx`
- Create: `src/components/portal/intake/intake-page.tsx`
- Create: `src/app/(portal)/portal/(authenticated)/intake/[formId]/page.tsx`

- [ ] **Step 1: Write field components**

```tsx
// src/components/portal/intake/fields.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Upload, FileText } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { FieldSpec } from "@/server/services/intake-forms/schema-validation";

export interface FieldRendererProps {
  field: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
}

export function FieldRenderer({ field, value, onChange, disabled }: FieldRendererProps) {
  switch (field.type) {
    case "short_text":
      return (
        <Input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={500}
        />
      );
    case "long_text":
      return (
        <Textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={5000}
          rows={4}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          disabled={disabled}
          min={field.min}
          max={field.max}
        />
      );
    case "date":
      return (
        <Input
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          min={field.minDate}
          max={field.maxDate}
        />
      );
    case "yes_no":
      return (
        <RadioGroup
          value={value === true ? "yes" : value === false ? "no" : ""}
          onValueChange={(v) => onChange(v === "yes")}
          disabled={disabled}
        >
          <div className="flex items-center gap-2"><RadioGroupItem value="yes" id={`${field.id}-y`} /><label htmlFor={`${field.id}-y`}>Yes</label></div>
          <div className="flex items-center gap-2"><RadioGroupItem value="no" id={`${field.id}-n`} /><label htmlFor={`${field.id}-n`}>No</label></div>
        </RadioGroup>
      );
    case "select":
      return (
        <Select value={(value as string) ?? ""} onValueChange={(v) => onChange(v)} disabled={disabled}>
          <SelectTrigger><SelectValue placeholder="Choose one…" /></SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "multi_select": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1">
          {field.options?.map((o) => (
            <div key={o.value} className="flex items-center gap-2">
              <Checkbox
                id={`${field.id}-${o.value}`}
                checked={arr.includes(o.value)}
                onCheckedChange={(c) => {
                  if (c === true) onChange([...arr, o.value]);
                  else onChange(arr.filter((x) => x !== o.value));
                }}
                disabled={disabled}
              />
              <label htmlFor={`${field.id}-${o.value}`}>{o.label}</label>
            </div>
          ))}
        </div>
      );
    }
    case "file_upload":
      return <FileUploadField field={field} value={value} onChange={onChange} disabled={disabled} />;
  }
}

function FileUploadField({ field, value, onChange, disabled }: FieldRendererProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const upload = trpc.portalDocuments.upload.useMutation();
  const confirm = trpc.portalDocuments.confirmUpload.useMutation();

  const currentDocId = (value as { documentId?: string } | null)?.documentId ?? null;

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const fileType = ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : "image";
      const contentType =
        fileType === "pdf" ? "application/pdf" :
        fileType === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
        "image/jpeg";
      const { uploadUrl, documentId } = await upload.mutateAsync({
        filename: file.name,
        fileType,
        contentType,
      });
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
      await confirm.mutateAsync({ documentId });
      setFilename(file.name);
      onChange({ documentId });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {currentDocId || filename ? (
        <span className="text-sm inline-flex items-center gap-1 text-muted-foreground">
          <FileText className="w-4 h-4" /> {filename ?? "File attached"}
        </span>
      ) : null}
      <Button size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={disabled || uploading}>
        <Upload className="w-4 h-4 mr-1" /> {uploading ? "Uploading…" : currentDocId ? "Replace" : "Upload"}
      </Button>
      <input
        type="file"
        ref={ref}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          if (ref.current) ref.current.value = "";
        }}
      />
    </div>
  );
}
```

**Import check:** `@/components/ui/radio-group` may not exist. If `npx tsc --noEmit` errors on that import, replace with two `<Button>`s toggling state (simple):

```tsx
<div className="flex gap-2">
  <Button type="button" size="sm" variant={value === true ? "default" : "outline"} onClick={() => onChange(true)} disabled={disabled}>Yes</Button>
  <Button type="button" size="sm" variant={value === false ? "default" : "outline"} onClick={() => onChange(false)} disabled={disabled}>No</Button>
</div>
```

Use whichever compiles without adding deps.

The exact `portalDocuments.upload` / `confirmUpload` mutation names must match what 2.3.2 used (check `src/components/portal/case-documents-tab.tsx` if signatures differ). Mirror exactly.

- [ ] **Step 2: Write `IntakePage` orchestrator**

```tsx
// src/components/portal/intake/intake-page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FieldRenderer } from "./fields";
import type { FormSchema, FieldSpec } from "@/server/services/intake-forms/schema-validation";

export function IntakePage({ formId }: { formId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.portalIntakeForms.get.useQuery({ formId });

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const initedRef = useRef(false);

  const save = trpc.portalIntakeForms.saveAnswer.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const submit = trpc.portalIntakeForms.submit.useMutation({
    onSuccess: async () => {
      toast.success("Form submitted");
      await utils.portalIntakeForms.list.invalidate();
      const caseId = data?.form.caseId;
      router.push(caseId ? `/portal/cases/${caseId}` : "/portal");
    },
    onError: (e) => toast.error(e.message),
  });

  // Seed from existing answers on first load
  useEffect(() => {
    if (initedRef.current || !data) return;
    const initial: Record<string, unknown> = {};
    for (const ans of data.answers) {
      if (ans.valueText !== null) initial[ans.fieldId] = ans.valueText;
      else if (ans.valueNumber !== null) initial[ans.fieldId] = Number(ans.valueNumber);
      else if (ans.valueDate !== null) initial[ans.fieldId] = ans.valueDate;
      else if (ans.valueBool !== null) initial[ans.fieldId] = ans.valueBool;
      else if (ans.valueJson !== null) initial[ans.fieldId] = ans.valueJson;
      else if (ans.documentId !== null) initial[ans.fieldId] = { documentId: ans.documentId };
    }
    setValues(initial);
    initedRef.current = true;
  }, [data]);

  // Debounced per-field auto-save
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function scheduleSave(fieldId: string, value: unknown) {
    clearTimeout(timers.current[fieldId]);
    setSavingIds((prev) => {
      const n = new Set(prev);
      n.add(fieldId);
      return n;
    });
    timers.current[fieldId] = setTimeout(async () => {
      try {
        await save.mutateAsync({ formId, fieldId, value });
        setSavedAt(new Date());
      } finally {
        setSavingIds((prev) => {
          const n = new Set(prev);
          n.delete(fieldId);
          return n;
        });
      }
    }, 800);
  }

  function onChangeField(field: FieldSpec, next: unknown) {
    setValues((prev) => ({ ...prev, [field.id]: next }));
    scheduleSave(field.id, next);
  }

  const schema = (data?.form.schema as FormSchema) ?? { fields: [] };
  const requiredFields = useMemo(() => schema.fields.filter((f) => f.required), [schema]);
  const allRequiredAnswered = useMemo(
    () => requiredFields.every((f) => {
      const v = values[f.id];
      if (v === null || v === undefined || v === "") return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    }),
    [requiredFields, values],
  );

  async function handleSubmit() {
    if (!allRequiredAnswered) {
      toast.error("Please complete all required fields");
      return;
    }
    // Flush any pending saves
    await Promise.all(Object.values(timers.current).map((t) => { clearTimeout(t); return Promise.resolve(); }));
    submit.mutate({ formId });
  }

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-8 text-center text-muted-foreground">Form not found</div>;

  const readOnly = data.form.status === "submitted" || data.form.status === "cancelled";

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{data.form.title}</h1>
        {data.form.description && <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{data.form.description}</p>}
      </header>

      <ol className="space-y-6">
        {schema.fields.map((f, i) => (
          <li key={f.id}>
            <Label>
              {i + 1}. {f.label}{f.required ? " *" : ""}
            </Label>
            {f.description && <p className="text-xs text-muted-foreground mt-1 mb-2">{f.description}</p>}
            <div className="mt-2">
              <FieldRenderer
                field={f}
                value={values[f.id]}
                onChange={(v) => onChangeField(f, v)}
                disabled={readOnly}
              />
            </div>
            {savingIds.has(f.id) && (
              <p className="text-xs text-muted-foreground mt-1">Saving…</p>
            )}
          </li>
        ))}
      </ol>

      {!readOnly && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {savingIds.size > 0 ? "Saving…" : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : "Unsaved"}
          </div>
          <Button onClick={handleSubmit} disabled={!allRequiredAnswered || submit.isPending}>
            {submit.isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the route**

```tsx
// src/app/(portal)/portal/(authenticated)/intake/[formId]/page.tsx
import { IntakePage } from "@/components/portal/intake/intake-page";

export default async function Page({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  return <IntakePage formId={formId} />;
}
```

(`params` is a Promise in Next.js 16 App Router — match the pattern used by the existing portal routes; if other portal pages use sync `params`, follow those.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx next build 2>&1 | tail -10` — success. Route `/portal/intake/[formId]` must appear.

- [ ] **Step 5: Commit**

```bash
git add src/components/portal/intake/fields.tsx src/components/portal/intake/intake-page.tsx src/app/\(portal\)/portal/\(authenticated\)/intake/\[formId\]/page.tsx
git commit -m "feat(2.3.3): portal full-screen intake fill page + auto-save"
```

---

### Task 15: PDF print route

**Files:**
- Create: `src/app/(app)/cases/[id]/intake/[formId]/print/page.tsx`

- [ ] **Step 1: Write route**

```tsx
// src/app/(app)/cases/[id]/intake/[formId]/print/page.tsx
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/server/db";
import { eq } from "drizzle-orm";
import { intakeForms } from "@/server/db/schema/intake-forms";
import { intakeFormAnswers } from "@/server/db/schema/intake-form-answers";
import { cases } from "@/server/db/schema/cases";
import { documents } from "@/server/db/schema/documents";
import { users } from "@/server/db/schema/users";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import type { FormSchema } from "@/server/services/intake-forms/schema-validation";

export default async function Page({ params }: { params: Promise<{ id: string; formId: string }> }) {
  const { id: caseId, formId } = await params;

  const { userId } = await auth();
  if (!userId) notFound();
  const [u] = await db.select().from(users).where(eq(users.clerkId, userId)).limit(1);
  if (!u) notFound();

  // Permission check — mirror assertCaseAccess input
  await assertCaseAccess({ db, user: u } as any, caseId);

  const [form] = await db.select().from(intakeForms).where(eq(intakeForms.id, formId)).limit(1);
  if (!form || form.caseId !== caseId) notFound();
  const [caseRow] = await db.select({ name: cases.name }).from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!caseRow) notFound();
  const answers = await db
    .select({
      fieldId: intakeFormAnswers.fieldId,
      valueText: intakeFormAnswers.valueText,
      valueNumber: intakeFormAnswers.valueNumber,
      valueDate: intakeFormAnswers.valueDate,
      valueBool: intakeFormAnswers.valueBool,
      valueJson: intakeFormAnswers.valueJson,
      documentId: intakeFormAnswers.documentId,
      filename: documents.filename,
    })
    .from(intakeFormAnswers)
    .leftJoin(documents, eq(documents.id, intakeFormAnswers.documentId))
    .where(eq(intakeFormAnswers.formId, formId));
  const answerMap = new Map(answers.map((a) => [a.fieldId, a]));

  const schema = (form.schema as FormSchema) ?? { fields: [] };

  return (
    <html lang="en">
      <head>
        <title>{form.title}</title>
        <style>{`
          @media print { @page { margin: 0.5in; } }
          body { font-family: Georgia, serif; font-size: 11pt; color: #111; max-width: 7in; margin: 0 auto; padding: 1in 0.5in; }
          h1 { font-size: 18pt; margin: 0 0 0.2in; }
          .meta { color: #555; font-size: 10pt; margin-bottom: 0.5in; }
          section { margin-bottom: 0.25in; page-break-inside: avoid; }
          h3 { font-size: 11pt; margin: 0 0 2pt; font-weight: bold; }
          .ans { margin: 0; }
          .empty { color: #888; font-style: italic; }
        `}</style>
      </head>
      <body>
        <article>
          <h1>{form.title}</h1>
          <p className="meta">
            Case: {caseRow.name ?? "—"}
            {form.submittedAt ? ` · Submitted ${new Date(form.submittedAt).toLocaleString()}` : ""}
          </p>
          {schema.fields.map((f) => {
            const a = answerMap.get(f.id) ?? null;
            return (
              <section key={f.id}>
                <h3>{f.label}{f.required ? " *" : ""}</h3>
                <p className="ans">{renderAnswerText(f.type, a)}</p>
              </section>
            );
          })}
        </article>
      </body>
    </html>
  );
}

function renderAnswerText(type: string, a: any): string | JSX.Element {
  if (!a) return <span className="empty">— no answer —</span>;
  switch (type) {
    case "short_text":
    case "long_text":
    case "select":
      return a.valueText ?? "";
    case "number":
      return a.valueNumber ?? "";
    case "date":
      return a.valueDate ?? "";
    case "yes_no":
      return a.valueBool === true ? "Yes" : a.valueBool === false ? "No" : "";
    case "multi_select":
      return Array.isArray(a.valueJson) ? a.valueJson.join(", ") : "";
    case "file_upload":
      return `Attached: ${a.filename ?? "(file)"}`;
    default:
      return "";
  }
}
```

**Adapt auth pattern if `@clerk/nextjs/server`'s `auth()` import differs** — check another server component in the app (e.g., an existing `/cases/[id]/...` page) and mirror exactly. The `users.clerkId` field name also varies across projects — verify.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — exit 0.

Open in browser while logged in (requires dev server running): `http://localhost:3000/cases/<caseId>/intake/<formId>/print` with a submitted form. Expect a print-styled page. `Cmd+P` → Save as PDF.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/cases/\[id\]/intake/\[formId\]/print/page.tsx
git commit -m "feat(2.3.3): print-styled route for PDF export"
```

---

### Task 16: E2E smoke + final verification

**Files:**
- Create: `e2e/intake-forms-smoke.spec.ts`

- [ ] **Step 1: Find existing E2E pattern**

Run: `cat e2e/document-requests-smoke.spec.ts`

Mirror that file's structure (`FAKE_UUID`, `expect(resp?.status()).toBeLessThan(500)`).

- [ ] **Step 2: Write smoke**

```ts
// e2e/intake-forms-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.3 intake forms smoke", () => {
  test("/cases/[id]?tab=intake returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=intake`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/portal/cases/[id] still returns <500 with new intake card", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/portal/cases/${FAKE_UUID}`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/portal/intake/[formId] returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/portal/intake/${FAKE_UUID}`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 3: Run smoke**

Run: `npx playwright test e2e/intake-forms-smoke.spec.ts`
Expected: 3 tests run. 2.3.2's portal-route Turbopack CSS flake is pre-existing — tests that exercise `/portal/*` may fail in dev for the same reason. Report the specific failure but do not block on it if prod build + tsc + vitest all pass.

- [ ] **Step 4: Final full-repo verification**

```bash
npx vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -5
npx next build 2>&1 | tail -30
```

Expected:
- Vitest: all tests pass (baseline 529 + T5's 3 = 532+).
- tsc: EXIT 0.
- Build: success.

- [ ] **Step 5: Branch summary**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat | tail -10
```

Capture output for reporting.

- [ ] **Step 6: Commit**

```bash
git add e2e/intake-forms-smoke.spec.ts
git commit -m "test(2.3.3): E2E smoke for intake routes"
```

---

## Self-Review

**Spec coverage:**

- §3 decisions — each mapped: (1) ad-hoc + JSONB schema → T1/T5; (2) 8 field types → T4 `FIELD_TYPES`; (3) auto-save drafts → T6 `saveAnswer`, T14 `scheduleSave`; (4) required + basic validation → T4 `fieldSpecSchema` + T6 `submitForm`; (5) surfaces → T12 lawyer tab + T13/T14 portal; (6) lifecycle + frozen-after-send → T5 `updateDraft` guard + T6 `sendForm`; (7) 3 notifications → T9; (8) print-to-PDF → T15. ✓
- §4 data model → T1 + T2. ✓
- §5 backend → T4–T9. ✓
- §6 lawyer UI → T10–T12. ✓
- §7 portal UI → T13–T14. ✓
- §8 PDF → T15. ✓
- §9 UAT → covered by implementation; manual UAT happens after T16.
- §10 testing — unit smoke in T5; `writeAnswerValue` (T4) correctness tested implicitly via T6 `saveAnswer` integration; status transitions unit-tested via mock-db only for createDraft/updateDraft (other transitions reserved for live UAT). Integration tRPC + E2E covered in T16.
- §11 deviations — listed in plan body per task.
- §12 open questions — resolved inline: (a) submittedCount MVP is count-all-submitted; (b) extracted helpers are new shared `recipients.ts` (T4), 2.3.2 not refactored in this phase; (c) file download stays non-clickable; (d) `cases.orgId` fallback mirror 2.3.2. ✓

**Placeholder scan:** No TBDs, TODOs, or "handle edge cases" placeholders. Three "verify actual pattern before implementing" instructions in T9 (event names), T14 (portal upload mutation names, radio-group fallback), T15 (Clerk auth import) — these are verification pointers, not placeholders.

**Type consistency:**
- `FormSchema`, `FieldSpec`, `FIELD_TYPES` defined in T4 → used consistently in T5, T6, T7, T10, T11, T14, T15.
- `saveAnswer` signature `{ formId, fieldId, value }` matches between T6 (service), T8 (portal router), T14 (portal client).
- Event names `messaging/intake_form.sent|submitted|cancelled` consistent between T6 emits and T9 triggers.
- Notification type strings `intake_form_sent|submitted|cancelled` consistent between T3 enum, T9 consumers, T3 TYPE_LABELS.
- Status literals match the CHECK constraint in T2, the zod `status` usage is implicit (drizzle infers), transition guards in T5/T6 use the same literals.
