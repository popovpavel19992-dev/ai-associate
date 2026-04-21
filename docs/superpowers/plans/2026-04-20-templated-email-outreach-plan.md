# 2.3.5 Templated Email Outreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lawyer saves reusable email templates with variable substitution, composes and sends client emails from the app with case-document attachments, and keeps a per-case audit log.

**Architecture:** Three tables — `email_templates` (org-scoped library), `case_email_outreach` (per-case send log with snapshot columns), `case_email_outreach_attachments` (join with filename/size snapshots). Service pipeline: variable substitution → markdown render → DOMPurify sanitize → Resend send → write log. Lawyer UI: new `"emails"` tab on case detail + `/settings/email-templates` library. No Inngest (synchronous single-recipient send).

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, tRPC v11 (client `trpc` from `@/lib/trpc`), Resend v6 SDK (already installed), Zod v4, Vitest with mock-db pattern, Playwright. New deps: `marked` (markdown → HTML), `isomorphic-dompurify` (sanitize).

**Spec:** `docs/superpowers/specs/2026-04-20-templated-email-outreach-design.md`

**Reference implementations on branch stack:** 2.3.1 messaging, 2.3.2 document requests, 2.3.3 intake forms, 2.3.4 milestones (all shipped on current branch `feature/2.3.4-status-timeline`).

**Key existing files (recon output, do NOT re-grep — trust these):**
- `src/components/cases/attach-document-modal.tsx` — current single-select radio UI; extend with `multiple` prop.
- `src/server/services/s3.ts` — exports `getObject(s3Key)` returning `{ body: ReadableStream, contentType }`.
- `src/server/services/email.ts` — exports `sendEmail({ to, subject, html })`; extend additively.
- `src/server/db/schema/documents.ts` — columns: `id, filename, s3Key, fileType (enum), fileSize, caseId, …`.
- `src/components/layout/sidebar.tsx` — existing "Templates" nav item at line ~42 points to `/settings/templates` (contract templates). New item for email templates goes near it.
- Settings subpages pattern: `src/app/(app)/settings/{rates,integrations,team,templates,notifications,billing}/page.tsx`.

**Branch setup (before Task 1):**

```bash
# Currently on feature/2.3.4-status-timeline.
git checkout -b feature/2.3.5-templated-email-outreach
```

---

## File Structure

**Create:**
- `src/server/db/schema/email-templates.ts`
- `src/server/db/schema/case-email-outreach.ts`
- `src/server/db/schema/case-email-outreach-attachments.ts`
- `src/server/db/migrations/0016_email_outreach.sql`
- `src/server/services/email-outreach/service.ts`
- `src/server/services/email-outreach/render.ts`
- `tests/integration/email-outreach-service.test.ts`
- `src/server/trpc/routers/email-templates.ts`
- `src/server/trpc/routers/case-emails.ts`
- `src/components/common/sanitized-html.tsx`
- `src/components/cases/emails/new-email-modal.tsx`
- `src/components/cases/emails/emails-list.tsx`
- `src/components/cases/emails/email-detail.tsx`
- `src/components/cases/emails/emails-tab.tsx`
- `src/app/(app)/settings/email-templates/page.tsx`
- `src/components/settings/email-templates/templates-list.tsx`
- `src/components/settings/email-templates/template-editor.tsx`
- `e2e/email-outreach-smoke.spec.ts`

**Modify:**
- `package.json` — add `marked`, `isomorphic-dompurify`.
- `src/server/services/email.ts` — extend `SendEmailOptions`.
- `src/components/cases/attach-document-modal.tsx` — add optional `multiple` prop.
- `src/server/trpc/root.ts` — register 2 routers.
- `src/app/(app)/cases/[id]/page.tsx` — add `"emails"` tab + mount.
- `src/components/layout/sidebar.tsx` — add "Email templates" entry.

**Not touched:** Inngest (no new functions), portal UI (no portal-side changes — client receives email directly, not portal notification), sidebar badge.

---

### Task 1: Install dependencies

- [ ] **Step 1: Install `marked` + `isomorphic-dompurify`**

Run: `npm install marked isomorphic-dompurify`
Expected: both packages added to `dependencies`. No audit errors that block install.

- [ ] **Step 2: Verify types available**

Run: `npx tsc --noEmit`
Expected: EXIT 0. Both libs ship their own types.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(2.3.5): add marked + isomorphic-dompurify deps"
```

---

### Task 2: Drizzle schema — three tables

**Files:**
- Create: `src/server/db/schema/email-templates.ts`
- Create: `src/server/db/schema/case-email-outreach.ts`
- Create: `src/server/db/schema/case-email-outreach-attachments.ts`

- [ ] **Step 1: Write `email-templates.ts`**

```ts
// src/server/db/schema/email-templates.ts
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("email_templates_org_name_idx").on(table.orgId, table.name),
  ],
);

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
```

- [ ] **Step 2: Write `case-email-outreach.ts`**

```ts
// src/server/db/schema/case-email-outreach.ts
import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { emailTemplates } from "./email-templates";

export const caseEmailOutreach = pgTable(
  "case_email_outreach",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    templateId: uuid("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
    sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    subject: text("subject").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    bodyHtml: text("body_html").notNull(),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    resendId: text("resend_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_email_outreach_case_created_idx").on(table.caseId, table.createdAt),
    check(
      "case_email_outreach_status_check",
      sql`${table.status} IN ('sent','failed')`,
    ),
  ],
);

export type CaseEmailOutreach = typeof caseEmailOutreach.$inferSelect;
export type NewCaseEmailOutreach = typeof caseEmailOutreach.$inferInsert;
```

- [ ] **Step 3: Write `case-email-outreach-attachments.ts`**

```ts
// src/server/db/schema/case-email-outreach-attachments.ts
import { pgTable, uuid, text, integer, index } from "drizzle-orm/pg-core";
import { caseEmailOutreach } from "./case-email-outreach";
import { documents } from "./documents";

export const caseEmailOutreachAttachments = pgTable(
  "case_email_outreach_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailId: uuid("email_id").references(() => caseEmailOutreach.id, { onDelete: "cascade" }).notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "restrict" }).notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
  },
  (table) => [
    index("case_email_outreach_attachments_email_idx").on(table.emailId),
  ],
);

export type CaseEmailOutreachAttachment = typeof caseEmailOutreachAttachments.$inferSelect;
export type NewCaseEmailOutreachAttachment = typeof caseEmailOutreachAttachments.$inferInsert;
```

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/email-templates.ts src/server/db/schema/case-email-outreach.ts src/server/db/schema/case-email-outreach-attachments.ts
git commit -m "feat(2.3.5): drizzle schema for email outreach — 3 tables"
```

---

### Task 3: Migration 0016 + apply to dev DB

**Files:**
- Create: `src/server/db/migrations/0016_email_outreach.sql`

- [ ] **Step 1: Write migration SQL**

Write exactly this content to `src/server/db/migrations/0016_email_outreach.sql`:

```sql
-- 0016_email_outreach.sql
-- Phase 2.3.5: templated email outreach.

CREATE TABLE "email_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "name" text NOT NULL,
  "subject" text NOT NULL,
  "body_markdown" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "email_templates"
  ADD CONSTRAINT "email_templates_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  ADD CONSTRAINT "email_templates_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "email_templates_org_name_idx" ON "email_templates" USING btree ("org_id","name");

CREATE TABLE "case_email_outreach" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "template_id" uuid,
  "sent_by" uuid,
  "recipient_email" text NOT NULL,
  "recipient_name" text,
  "subject" text NOT NULL,
  "body_markdown" text NOT NULL,
  "body_html" text NOT NULL,
  "status" text NOT NULL,
  "error_message" text,
  "resend_id" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_email_outreach_status_check" CHECK ("status" IN ('sent','failed'))
);

ALTER TABLE "case_email_outreach"
  ADD CONSTRAINT "case_email_outreach_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_email_outreach_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null,
  ADD CONSTRAINT "case_email_outreach_sent_by_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "case_email_outreach_case_created_idx" ON "case_email_outreach" USING btree ("case_id","created_at");

CREATE TABLE "case_email_outreach_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL
);

ALTER TABLE "case_email_outreach_attachments"
  ADD CONSTRAINT "case_email_outreach_attachments_email_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."case_email_outreach"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_email_outreach_attachments_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict;

CREATE INDEX "case_email_outreach_attachments_email_idx" ON "case_email_outreach_attachments" USING btree ("email_id");
```

- [ ] **Step 2: Apply to dev DB**

Follow the migration-apply pattern used by 2.3.3 (Task 2) and 2.3.4 (Task 2): a Node one-liner that loads `.env.local`, connects with the `postgres` driver, runs `sql.unsafe(ddl)`, then `SELECT COUNT(*)` on each new table. Expected output: `templates: 0 | outreach: 0 | attachments: 0`.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/migrations/0016_email_outreach.sql
git commit -m "feat(2.3.5): migration 0016 — email outreach tables"
```

---

### Task 4: Extend `sendEmail` helper (attachments + replyTo)

**Files:**
- Modify: `src/server/services/email.ts`

- [ ] **Step 1: Read current file**

Use Read tool on `src/server/services/email.ts`. Locate the `SendEmailOptions` interface (near top) and the `sendEmail` function.

- [ ] **Step 2: Extend interface additively**

Replace `SendEmailOptions` + `sendEmail` body with the code block below. Keep the existing `from:` line unchanged. `attachments` and `replyTo` fields are optional so existing callers (only passing `{to, subject, html}`) keep working unchanged.

```ts
export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
  replyTo?: string;
}

export async function sendEmail({ to, subject, html, attachments, replyTo }: SendEmailOptions) {
  await resend.emails.send({
    from: process.env.RESEND_FROM ?? "onboarding@resend.dev",
    to,
    subject,
    html,
    ...(attachments && attachments.length > 0
      ? {
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            content_type: a.contentType,
          })),
        }
      : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
  } as Parameters<typeof resend.emails.send>[0]);
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/email.ts
git commit -m "feat(2.3.5): sendEmail helper — attachments + replyTo"
```

---

### Task 5: Render pipeline + `<SanitizedHtml>` component

**Files:**
- Create: `src/server/services/email-outreach/render.ts`
- Create: `src/components/common/sanitized-html.tsx`

- [ ] **Step 1: Write server render helper**

```ts
// src/server/services/email-outreach/render.ts
// Pipeline: variable substitution -> markdown -> DOMPurify sanitize.
// Shared between send path and previewRender tRPC endpoint so preview == sent.

import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = ["p", "h2", "h3", "strong", "em", "a", "ul", "ol", "li", "br", "blockquote"];
const ALLOWED_ATTR = ["href", "rel", "target"];

export function substituteVariables(src: string, variables: Record<string, string>): string {
  return src.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (full, name) => {
    return Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : full;
  });
}

export function renderMarkdownToHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

export function renderEmail({
  subject,
  bodyMarkdown,
  variables,
}: {
  subject: string;
  bodyMarkdown: string;
  variables: Record<string, string>;
}): { subject: string; bodyMarkdown: string; bodyHtml: string } {
  const finalSubject = substituteVariables(subject, variables);
  const finalMarkdown = substituteVariables(bodyMarkdown, variables);
  const bodyHtml = renderMarkdownToHtml(finalMarkdown);
  return { subject: finalSubject, bodyMarkdown: finalMarkdown, bodyHtml };
}
```

- [ ] **Step 2: Write `<SanitizedHtml>` component**

Client-only component that sanitizes html via DOMPurify before setting it via React's raw-HTML escape hatch (the `__html` prop on a `div`). All HTML rendered from email bodies in the app must go through this component.

Write the file content below (file path `src/components/common/sanitized-html.tsx`) exactly as shown — it is the one place where `__html` is set. Server already sanitizes in `renderEmail`; this client-side sanitizer is defense in depth.

```tsx
"use client";

import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = ["p", "h2", "h3", "strong", "em", "a", "ul", "ol", "li", "br", "blockquote"];
const ALLOWED_ATTR = ["href", "rel", "target"];

export function SanitizedHtml({ html, className }: { html: string; className?: string }) {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
  // The only place in the codebase that sets raw HTML via React's __html prop.
  // `clean` has already passed through DOMPurify above.
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/email-outreach/render.ts src/components/common/sanitized-html.tsx
git commit -m "feat(2.3.5): render pipeline — substitute + markdown + sanitize + SanitizedHtml"
```

---

### Task 6: `EmailOutreachService` templates CRUD + resolveVariables + tests

**Files:**
- Create: `src/server/services/email-outreach/service.ts`
- Create: `tests/integration/email-outreach-service.test.ts`

Service setup + template CRUD + variable resolution. The send path is added in Task 7 to keep diffs small.

- [ ] **Step 1: Write service**

```ts
// src/server/services/email-outreach/service.ts
import { TRPCError } from "@trpc/server";
import { and, desc, eq, asc } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { emailTemplates } from "@/server/db/schema/email-templates";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { caseEmailOutreachAttachments } from "@/server/db/schema/case-email-outreach-attachments";
import { cases } from "@/server/db/schema/cases";
import { clients } from "@/server/db/schema/clients";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { portalUsers } from "@/server/db/schema/portal-users";
import { documents } from "@/server/db/schema/documents";
import { renderEmail } from "./render";

export interface EmailOutreachServiceDeps {
  db?: typeof defaultDb;
  resendSend?: (opts: { to: string; subject: string; html: string; attachments?: any[]; replyTo?: string }) => Promise<{ id?: string }>;
  fetchObject?: (s3Key: string) => Promise<Buffer>;
}

function formatToday(d: Date = new Date()): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export class EmailOutreachService {
  private readonly db: typeof defaultDb;
  private readonly resendSend?: EmailOutreachServiceDeps["resendSend"];
  private readonly fetchObject?: EmailOutreachServiceDeps["fetchObject"];

  constructor(deps: EmailOutreachServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.resendSend = deps.resendSend;
    this.fetchObject = deps.fetchObject;
  }

  async listTemplates(input: { orgId: string }) {
    return this.db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.orgId, input.orgId))
      .orderBy(asc(emailTemplates.name));
  }

  async getTemplate(input: { templateId: string }) {
    const [row] = await this.db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.id, input.templateId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    return row;
  }

  async createTemplate(input: {
    orgId: string;
    name: string;
    subject: string;
    bodyMarkdown: string;
    createdBy: string;
  }): Promise<{ templateId: string }> {
    if (!input.name.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Name required" });
    if (!input.subject.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Subject required" });
    const [row] = await this.db
      .insert(emailTemplates)
      .values({
        orgId: input.orgId,
        name: input.name.trim(),
        subject: input.subject,
        bodyMarkdown: input.bodyMarkdown,
        createdBy: input.createdBy,
      })
      .returning();
    return { templateId: row.id };
  }

  async updateTemplate(input: {
    templateId: string;
    name?: string;
    subject?: string;
    bodyMarkdown?: string;
  }): Promise<void> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.subject !== undefined) patch.subject = input.subject;
    if (input.bodyMarkdown !== undefined) patch.bodyMarkdown = input.bodyMarkdown;
    await this.db.update(emailTemplates).set(patch).where(eq(emailTemplates.id, input.templateId));
  }

  async deleteTemplate(input: { templateId: string }): Promise<void> {
    await this.db.delete(emailTemplates).where(eq(emailTemplates.id, input.templateId));
  }

  async resolveVariables(input: { caseId: string; senderId: string }): Promise<Record<string, string>> {
    const [caseRow] = await this.db
      .select({ id: cases.id, name: cases.name, clientId: cases.clientId, orgId: cases.orgId })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .limit(1);
    if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });

    const [sender] = await this.db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, input.senderId))
      .limit(1);

    let clientName = "";
    let clientFirstName = "";
    if (caseRow.clientId) {
      const [c] = await this.db
        .select({ displayName: clients.displayName, firstName: clients.firstName })
        .from(clients)
        .where(eq(clients.id, caseRow.clientId))
        .limit(1);
      clientName = c?.displayName ?? "";
      clientFirstName = c?.firstName ?? "";
    }

    let firmName = "";
    if (caseRow.orgId) {
      const [o] = await this.db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, caseRow.orgId))
        .limit(1);
      firmName = o?.name ?? "";
    }

    let portalUrl = "";
    if (caseRow.clientId) {
      const [pu] = await this.db
        .select({ id: portalUsers.id })
        .from(portalUsers)
        .where(eq(portalUsers.clientId, caseRow.clientId))
        .limit(1);
      if (pu) {
        const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
        portalUrl = appUrl ? `${appUrl}/portal/cases/${caseRow.id}` : "";
      }
    }

    return {
      client_name: clientName,
      client_first_name: clientFirstName,
      case_name: caseRow.name ?? "(case)",
      lawyer_name: sender?.name ?? "(lawyer)",
      lawyer_email: sender?.email ?? "",
      firm_name: firmName,
      portal_url: portalUrl,
      today: formatToday(),
    };
  }
}
```

- [ ] **Step 2: Write smoke tests**

```ts
// tests/integration/email-outreach-service.test.ts
import { describe, it, expect } from "vitest";
import { EmailOutreachService } from "@/server/services/email-outreach/service";
import { substituteVariables, renderEmail } from "@/server/services/email-outreach/render";

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
          orderBy: async () => selectQueue.shift() ?? [],
        }),
        orderBy: async () => selectQueue.shift() ?? [],
      }),
    }),
    enqueue: (rows: unknown[]) => selectQueue.push(rows),
  } as any;
  return { db, inserts, updates, deletes };
}

describe("EmailOutreachService.createTemplate", () => {
  it("inserts template with trimmed name + createdBy", async () => {
    const { db, inserts } = makeMockDb();
    const svc = new EmailOutreachService({ db });
    const { templateId } = await svc.createTemplate({
      orgId: "o1",
      name: "  Intake Welcome  ",
      subject: "Welcome {{client_name}}",
      bodyMarkdown: "Hi {{client_first_name}},",
      createdBy: "u1",
    });
    expect(templateId).toBeTruthy();
    const v = inserts[0].values as Record<string, unknown>;
    expect(v.name).toBe("Intake Welcome");
    expect(v.orgId).toBe("o1");
    expect(v.createdBy).toBe("u1");
  });

  it("rejects empty name", async () => {
    const { db } = makeMockDb();
    const svc = new EmailOutreachService({ db });
    await expect(svc.createTemplate({
      orgId: "o1", name: "   ", subject: "s", bodyMarkdown: "b", createdBy: "u1",
    })).rejects.toThrow(/Name required/);
  });
});

describe("substituteVariables", () => {
  it("replaces known tokens", () => {
    expect(substituteVariables("Hi {{name}}!", { name: "Jane" })).toBe("Hi Jane!");
  });
  it("leaves unknown tokens literal", () => {
    expect(substituteVariables("Hello {{unknown}}", { name: "J" })).toBe("Hello {{unknown}}");
  });
  it("handles multiple substitutions", () => {
    expect(substituteVariables("{{a}} and {{b}}", { a: "1", b: "2" })).toBe("1 and 2");
  });
});

describe("renderEmail", () => {
  it("substitutes + renders markdown + sanitizes", () => {
    const out = renderEmail({
      subject: "Re: {{case_name}}",
      bodyMarkdown: "Hi **{{client_name}}**, see [portal]({{portal_url}}).",
      variables: {
        case_name: "Doe v. Smith",
        client_name: "John",
        portal_url: "https://example.com/p/1",
      },
    });
    expect(out.subject).toBe("Re: Doe v. Smith");
    expect(out.bodyHtml).toContain("<strong>John</strong>");
    expect(out.bodyHtml).toContain('href="https://example.com/p/1"');
  });
  it("strips script tags", () => {
    const out = renderEmail({
      subject: "x",
      bodyMarkdown: "<script>alert(1)</script>hello",
      variables: {},
    });
    expect(out.bodyHtml).not.toContain("<script>");
    expect(out.bodyHtml).toContain("hello");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/integration/email-outreach-service.test.ts`
Expected: 7/7 PASS.

- [ ] **Step 4: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/email-outreach/service.ts tests/integration/email-outreach-service.test.ts
git commit -m "feat(2.3.5): EmailOutreachService — template CRUD + variable resolution + tests"
```

---

### Task 7: Service — `resolveRecipient`, `send`, `listForCase`, `getEmail`

**Files:**
- Modify: `src/server/services/email-outreach/service.ts`

- [ ] **Step 1: Read current file**

Use Read tool on `src/server/services/email-outreach/service.ts`. Locate the closing `}` of the `EmailOutreachService` class (after `resolveVariables`).

- [ ] **Step 2: Append methods inside the class body, before the closing `}`**

```ts
  async resolveRecipient(input: { caseId: string }): Promise<{ email: string; name: string | null } | null> {
    const [caseRow] = await this.db
      .select({ clientId: cases.clientId })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .limit(1);
    if (!caseRow || !caseRow.clientId) return null;

    const contacts = await this.db
      .select({ email: clientContacts.email, firstName: clientContacts.firstName, lastName: clientContacts.lastName, isPrimary: clientContacts.isPrimary })
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, caseRow.clientId)))
      .orderBy(desc(clientContacts.isPrimary));
    const firstWithEmail = contacts.find((c) => c.email && c.email.trim().length > 0);
    if (firstWithEmail) {
      const name = [firstWithEmail.firstName, firstWithEmail.lastName].filter(Boolean).join(" ").trim() || null;
      return { email: firstWithEmail.email!, name };
    }

    const [pu] = await this.db
      .select({ email: portalUsers.email, displayName: portalUsers.displayName })
      .from(portalUsers)
      .where(eq(portalUsers.clientId, caseRow.clientId))
      .limit(1);
    if (pu && pu.email) return { email: pu.email, name: pu.displayName ?? null };

    return null;
  }

  async send(input: {
    caseId: string;
    templateId?: string | null;
    subject: string;
    bodyMarkdown: string;
    documentIds: string[];
    senderId: string;
  }): Promise<{ emailId: string; resendId: string | null }> {
    const MAX_BYTES = 35 * 1024 * 1024;

    const recipient = await this.resolveRecipient({ caseId: input.caseId });
    if (!recipient) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No recipient email — add an email contact on the Client page" });
    }

    const variables = await this.resolveVariables({ caseId: input.caseId, senderId: input.senderId });
    const rendered = renderEmail({ subject: input.subject, bodyMarkdown: input.bodyMarkdown, variables });

    const docs = input.documentIds.length > 0
      ? await this.db
          .select({ id: documents.id, caseId: documents.caseId, filename: documents.filename, s3Key: documents.s3Key, fileType: documents.fileType, fileSize: documents.fileSize })
          .from(documents)
          .where(eq(documents.caseId, input.caseId))
      : [];
    const docById = new Map(docs.map((d) => [d.id, d]));
    const attachedDocs = input.documentIds.map((id) => {
      const d = docById.get(id);
      if (!d) throw new TRPCError({ code: "BAD_REQUEST", message: `Document ${id} is not on this case` });
      return d;
    });

    const totalSize = attachedDocs.reduce((s, d) => s + (d.fileSize ?? 0), 0);
    if (totalSize > MAX_BYTES) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Attachments exceed 35MB (${Math.round(totalSize / 1024 / 1024)}MB)` });
    }

    const [sender] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, input.senderId)).limit(1);
    const replyTo = sender?.email ?? undefined;

    try {
      let attachmentsPayload: Array<{ filename: string; content: string; contentType?: string }> = [];
      if (attachedDocs.length > 0) {
        if (!this.fetchObject) throw new Error("fetchObject dependency not injected");
        const buffers = await Promise.all(attachedDocs.map((d) => this.fetchObject!(d.s3Key)));
        attachmentsPayload = attachedDocs.map((d, i) => ({
          filename: d.filename,
          content: buffers[i].toString("base64"),
          contentType: contentTypeForFileType(d.fileType, d.filename),
        }));
      }

      if (!this.resendSend) throw new Error("resendSend dependency not injected");
      const resendRes = await this.resendSend({
        to: recipient.email,
        subject: rendered.subject,
        html: rendered.bodyHtml,
        attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined,
        replyTo,
      });

      const [row] = await this.db
        .insert(caseEmailOutreach)
        .values({
          caseId: input.caseId,
          templateId: input.templateId ?? null,
          sentBy: input.senderId,
          recipientEmail: recipient.email,
          recipientName: recipient.name ?? null,
          subject: rendered.subject,
          bodyMarkdown: rendered.bodyMarkdown,
          bodyHtml: rendered.bodyHtml,
          status: "sent",
          resendId: resendRes.id ?? null,
          sentAt: new Date(),
        })
        .returning();

      if (attachedDocs.length > 0) {
        await this.db.insert(caseEmailOutreachAttachments).values(
          attachedDocs.map((d, i) => ({
            emailId: row.id,
            documentId: d.id,
            filename: d.filename,
            contentType: attachmentsPayload[i].contentType ?? "application/octet-stream",
            sizeBytes: d.fileSize ?? 0,
          })),
        );
      }

      return { emailId: row.id, resendId: resendRes.id ?? null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.db
        .insert(caseEmailOutreach)
        .values({
          caseId: input.caseId,
          templateId: input.templateId ?? null,
          sentBy: input.senderId,
          recipientEmail: recipient.email,
          recipientName: recipient.name ?? null,
          subject: rendered.subject,
          bodyMarkdown: rendered.bodyMarkdown,
          bodyHtml: rendered.bodyHtml,
          status: "failed",
          errorMessage: msg.slice(0, 2000),
        });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to send: ${msg}` });
    }
  }

  async listForCase(input: { caseId: string }) {
    return this.db
      .select({
        id: caseEmailOutreach.id,
        caseId: caseEmailOutreach.caseId,
        templateId: caseEmailOutreach.templateId,
        templateName: emailTemplates.name,
        sentBy: caseEmailOutreach.sentBy,
        sentByName: users.name,
        recipientEmail: caseEmailOutreach.recipientEmail,
        recipientName: caseEmailOutreach.recipientName,
        subject: caseEmailOutreach.subject,
        status: caseEmailOutreach.status,
        errorMessage: caseEmailOutreach.errorMessage,
        sentAt: caseEmailOutreach.sentAt,
        createdAt: caseEmailOutreach.createdAt,
      })
      .from(caseEmailOutreach)
      .leftJoin(emailTemplates, eq(emailTemplates.id, caseEmailOutreach.templateId))
      .leftJoin(users, eq(users.id, caseEmailOutreach.sentBy))
      .where(eq(caseEmailOutreach.caseId, input.caseId))
      .orderBy(desc(caseEmailOutreach.createdAt));
  }

  async getEmail(input: { emailId: string }) {
    const [row] = await this.db
      .select({
        id: caseEmailOutreach.id,
        caseId: caseEmailOutreach.caseId,
        templateId: caseEmailOutreach.templateId,
        templateName: emailTemplates.name,
        sentBy: caseEmailOutreach.sentBy,
        sentByName: users.name,
        recipientEmail: caseEmailOutreach.recipientEmail,
        recipientName: caseEmailOutreach.recipientName,
        subject: caseEmailOutreach.subject,
        bodyMarkdown: caseEmailOutreach.bodyMarkdown,
        bodyHtml: caseEmailOutreach.bodyHtml,
        status: caseEmailOutreach.status,
        errorMessage: caseEmailOutreach.errorMessage,
        resendId: caseEmailOutreach.resendId,
        sentAt: caseEmailOutreach.sentAt,
        createdAt: caseEmailOutreach.createdAt,
      })
      .from(caseEmailOutreach)
      .leftJoin(emailTemplates, eq(emailTemplates.id, caseEmailOutreach.templateId))
      .leftJoin(users, eq(users.id, caseEmailOutreach.sentBy))
      .where(eq(caseEmailOutreach.id, input.emailId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Email not found" });

    const attachments = await this.db
      .select()
      .from(caseEmailOutreachAttachments)
      .where(eq(caseEmailOutreachAttachments.emailId, input.emailId));

    return { ...row, attachments };
  }
```

Append this helper **outside** the class (at the bottom of the file):

```ts
function contentTypeForFileType(fileType: string, filename: string): string {
  if (fileType === "pdf") return "application/pdf";
  if (fileType === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (fileType === "image") {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webp")) return "image/webp";
    return "image/jpeg";
  }
  return "application/octet-stream";
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — EXIT 0.
Run: `npx vitest run tests/integration/email-outreach-service.test.ts` — 7/7 still pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/email-outreach/service.ts
git commit -m "feat(2.3.5): service send path + recipient + listForCase + getEmail"
```

---

### Task 8: tRPC routers + registration

**Files:**
- Create: `src/server/trpc/routers/email-templates.ts`
- Create: `src/server/trpc/routers/case-emails.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Write templates router**

```ts
// src/server/trpc/routers/email-templates.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { EmailOutreachService } from "@/server/services/email-outreach/service";

function requireOrgId(ctx: any): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

export const emailTemplatesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const orgId = requireOrgId(ctx);
    const svc = new EmailOutreachService({ db: ctx.db });
    const rows = await svc.listTemplates({ orgId });
    return { templates: rows };
  }),

  get: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const svc = new EmailOutreachService({ db: ctx.db });
      const row = await svc.getTemplate({ templateId: input.templateId });
      if (row.orgId !== orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      return row;
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(200),
      subject: z.string().trim().min(1).max(500),
      bodyMarkdown: z.string().max(50_000),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const svc = new EmailOutreachService({ db: ctx.db });
      return svc.createTemplate({ ...input, orgId, createdBy: ctx.user.id });
    }),

  update: protectedProcedure
    .input(z.object({
      templateId: z.string().uuid(),
      name: z.string().trim().min(1).max(200).optional(),
      subject: z.string().trim().min(1).max(500).optional(),
      bodyMarkdown: z.string().max(50_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const svc = new EmailOutreachService({ db: ctx.db });
      const existing = await svc.getTemplate({ templateId: input.templateId });
      if (existing.orgId !== orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      await svc.updateTemplate(input);
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const svc = new EmailOutreachService({ db: ctx.db });
      const existing = await svc.getTemplate({ templateId: input.templateId });
      if (existing.orgId !== orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      await svc.deleteTemplate({ templateId: input.templateId });
      return { ok: true as const };
    }),
});
```

- [ ] **Step 2: Write case-emails router**

```ts
// src/server/trpc/routers/case-emails.ts
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { EmailOutreachService } from "@/server/services/email-outreach/service";
import { renderEmail } from "@/server/services/email-outreach/render";
import { documents } from "@/server/db/schema/documents";
import { sendEmail } from "@/server/services/email";
import { getObject } from "@/server/services/s3";

async function fetchS3ToBuffer(s3Key: string): Promise<Buffer> {
  const { body } = await getObject(s3Key);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((u) => Buffer.from(u)));
}

async function resendSendAdapter(opts: { to: string; subject: string; html: string; attachments?: any[]; replyTo?: string }): Promise<{ id?: string }> {
  // sendEmail does not currently return the Resend id; keep undefined for now.
  await sendEmail({
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
    replyTo: opts.replyTo,
  });
  return { id: undefined };
}

export const caseEmailsRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new EmailOutreachService({ db: ctx.db });
      const rows = await svc.listForCase({ caseId: input.caseId });
      return { emails: rows };
    }),

  get: protectedProcedure
    .input(z.object({ emailId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new EmailOutreachService({ db: ctx.db });
      const row = await svc.getEmail({ emailId: input.emailId });
      await assertCaseAccess(ctx, row.caseId);
      return row;
    }),

  resolveContext: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new EmailOutreachService({ db: ctx.db });
      const recipient = await svc.resolveRecipient({ caseId: input.caseId });
      const variables = await svc.resolveVariables({ caseId: input.caseId, senderId: ctx.user.id });
      const docs = await ctx.db
        .select({ id: documents.id, filename: documents.filename, fileType: documents.fileType, fileSize: documents.fileSize })
        .from(documents)
        .where(eq(documents.caseId, input.caseId));
      return { recipient, variables, attachableDocuments: docs };
    }),

  previewRender: protectedProcedure
    .input(z.object({
      subject: z.string().max(500),
      bodyMarkdown: z.string().max(50_000),
      variables: z.record(z.string(), z.string()).optional(),
    }))
    .query(({ input }) => {
      return renderEmail({ subject: input.subject, bodyMarkdown: input.bodyMarkdown, variables: input.variables ?? {} });
    }),

  send: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      templateId: z.string().uuid().nullable().optional(),
      subject: z.string().trim().min(1).max(500),
      bodyMarkdown: z.string().min(1).max(50_000),
      documentIds: z.array(z.string().uuid()).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new EmailOutreachService({
        db: ctx.db,
        resendSend: resendSendAdapter,
        fetchObject: fetchS3ToBuffer,
      });
      return svc.send({
        caseId: input.caseId,
        templateId: input.templateId ?? null,
        subject: input.subject,
        bodyMarkdown: input.bodyMarkdown,
        documentIds: input.documentIds,
        senderId: ctx.user.id,
      });
    }),
});
```

- [ ] **Step 3: Register in `src/server/trpc/root.ts`**

Add imports + registrations:

```ts
import { emailTemplatesRouter } from "./routers/email-templates";
import { caseEmailsRouter } from "./routers/case-emails";
// inside router({ ... }):
  emailTemplates: emailTemplatesRouter,
  caseEmails: caseEmailsRouter,
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — EXIT 0.
Run: `npx next build 2>&1 | tail -10` — success.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/email-templates.ts src/server/trpc/routers/case-emails.ts src/server/trpc/root.ts
git commit -m "feat(2.3.5): emailTemplates + caseEmails tRPC routers"
```

---

### Task 9: Extend `<AttachDocumentModal>` with multi-select

**Files:**
- Modify: `src/components/cases/attach-document-modal.tsx`

Current component uses a radio input (single-select). Backward-compatible change: add optional `multiple` prop. When `multiple === true` render checkboxes + `onSelectMany` callback. Existing callers (messaging composer in 2.3.1) keep working unchanged.

- [ ] **Step 1: Replace the file contents**

```tsx
// src/components/cases/attach-document-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Paperclip } from "lucide-react";

type SingleProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  multiple?: false;
  onSelect: (doc: { id: string; filename: string }) => void;
  onSelectMany?: undefined;
};

type MultiProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  multiple: true;
  onSelect?: undefined;
  onSelectMany: (docs: Array<{ id: string; filename: string }>) => void;
};

export type AttachDocumentModalProps = SingleProps | MultiProps;

export function AttachDocumentModal(props: AttachDocumentModalProps) {
  const { open, onOpenChange, caseId } = props;
  const isMulti = props.multiple === true;

  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const { data, isLoading } = trpc.caseMessages.attachableDocuments.useQuery(
    { caseId, search: search || undefined },
    { enabled: open },
  );

  React.useEffect(() => {
    if (open) {
      setSearch("");
      setSelected(new Set());
    }
  }, [open]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isMulti) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  }

  const submit = () => {
    const chosen = (data?.documents ?? []).filter((d) => selected.has(d.id));
    if (chosen.length === 0) return;
    if (isMulti) {
      (props as MultiProps).onSelectMany(chosen.map((d) => ({ id: d.id, filename: d.filename })));
    } else {
      const first = chosen[0];
      (props as SingleProps).onSelect({ id: first.id, filename: first.filename });
    }
    onOpenChange(false);
  };

  const selectedCount = selected.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isMulti ? "Attach documents" : "Attach a document"}</DialogTitle>
          <DialogDescription>
            Choose {isMulti ? "one or more documents" : "a document"} already uploaded to this case.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            maxLength={200}
          />
          <div className="max-h-72 overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (data?.documents ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No documents in this case yet. Upload via Documents tab first.
              </p>
            ) : (
              <ul className="space-y-1">
                {(data?.documents ?? []).map((d) => (
                  <li key={d.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                      <input
                        type={isMulti ? "checkbox" : "radio"}
                        name="doc"
                        checked={selected.has(d.id)}
                        onChange={() => toggle(d.id)}
                      />
                      <Paperclip className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="flex-1 truncate">{d.filename}</span>
                      <span className="text-xs text-muted-foreground">
                        {Math.round((d.fileSize ?? 0) / 1024)} KB
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={selectedCount === 0}>
            {isMulti ? `Attach ${selectedCount || ""}`.trim() : "Attach selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0. If any existing caller type-errors, re-read before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/attach-document-modal.tsx
git commit -m "feat(2.3.5): AttachDocumentModal — optional multi-select"
```

---

### Task 10: `<NewEmailModal>` composer

**Files:**
- Create: `src/components/cases/emails/new-email-modal.tsx`

The composer is a two-tab (Edit / Preview) modal with template dropdown, recipient display, subject input, markdown body textarea with variable quick-insert buttons, and attachments section.

- [ ] **Step 1: Write the component**

Write the exact content below to `src/components/cases/emails/new-email-modal.tsx`.

Copy from reference: follow the tab-switch-pattern used in 2.3.3 intake-forms portal fill page (`src/components/portal/intake/intake-page.tsx`) for the Edit/Preview tabs; follow the modal shell pattern used in 2.3.4 `<RetractMilestoneModal>` / `<NewMilestoneModal>`.

```tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Paperclip, X } from "lucide-react";
import { AttachDocumentModal } from "@/components/cases/attach-document-modal";
import { SanitizedHtml } from "@/components/common/sanitized-html";

const MAX_BYTES = 35 * 1024 * 1024;
const VARIABLE_TOKENS = [
  "client_name",
  "client_first_name",
  "case_name",
  "lawyer_name",
  "lawyer_email",
  "firm_name",
  "portal_url",
  "today",
];

export interface NewEmailModalInitial {
  subject?: string;
  bodyMarkdown?: string;
  templateId?: string | null;
  attachments?: Array<{ id: string; filename: string; fileSize: number }>;
}

export function NewEmailModal({
  caseId,
  open,
  onOpenChange,
  initial,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: NewEmailModalInitial;
}) {
  const utils = trpc.useUtils();
  const [tab, setTab] = React.useState<"edit" | "preview">("edit");
  const [subject, setSubject] = React.useState(initial?.subject ?? "");
  const [bodyMarkdown, setBodyMarkdown] = React.useState(initial?.bodyMarkdown ?? "");
  const [templateId, setTemplateId] = React.useState<string | null>(initial?.templateId ?? null);
  const [attached, setAttached] = React.useState<Array<{ id: string; filename: string; fileSize: number }>>(initial?.attachments ?? []);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) {
      setTab("edit");
      setSubject(initial?.subject ?? "");
      setBodyMarkdown(initial?.bodyMarkdown ?? "");
      setTemplateId(initial?.templateId ?? null);
      setAttached(initial?.attachments ?? []);
    }
  }, [open, initial]);

  const templates = trpc.emailTemplates.list.useQuery(undefined, { enabled: open });
  const context = trpc.caseEmails.resolveContext.useQuery({ caseId }, { enabled: open });
  const preview = trpc.caseEmails.previewRender.useQuery(
    { subject, bodyMarkdown, variables: context.data?.variables },
    { enabled: open && tab === "preview" },
  );

  const send = trpc.caseEmails.send.useMutation({
    onSuccess: async () => {
      toast.success("Email sent");
      await utils.caseEmails.list.invalidate({ caseId });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function pickTemplate(id: string) {
    if (id === "__blank__") {
      setTemplateId(null);
      setSubject("");
      setBodyMarkdown("");
      return;
    }
    setTemplateId(id);
    const t = templates.data?.templates.find((x) => x.id === id);
    if (t) {
      setSubject(t.subject);
      setBodyMarkdown(t.bodyMarkdown);
    }
  }

  function insertToken(token: string) {
    const el = bodyRef.current;
    if (!el) {
      setBodyMarkdown((prev) => prev + `{{${token}}}`);
      return;
    }
    const start = el.selectionStart ?? bodyMarkdown.length;
    const end = el.selectionEnd ?? bodyMarkdown.length;
    const next = bodyMarkdown.slice(0, start) + `{{${token}}}` + bodyMarkdown.slice(end);
    setBodyMarkdown(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + token.length + 4;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function removeAttachment(id: string) {
    setAttached((prev) => prev.filter((a) => a.id !== id));
  }

  const totalBytes = attached.reduce((s, a) => s + (a.fileSize ?? 0), 0);
  const overLimit = totalBytes > MAX_BYTES;
  const recipient = context.data?.recipient ?? null;
  const canSend = !!recipient && subject.trim().length > 0 && bodyMarkdown.trim().length > 0 && !overLimit && !send.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New email</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Template</Label>
              <Select value={templateId ?? "__blank__"} onValueChange={pickTemplate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__blank__">Blank email</SelectItem>
                  {(templates.data?.templates ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Recipient</Label>
              {recipient ? (
                <div className="rounded border px-3 py-2 text-sm">
                  {recipient.name ? `${recipient.name} — ` : ""}{recipient.email}
                </div>
              ) : (
                <div className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800">
                  No email on file. Add an email contact on the Client page.
                </div>
              )}
            </div>
          </div>

          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={500} placeholder="Subject line" />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Body</Label>
              <div className="flex gap-1 text-xs">
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 ${tab === "edit" ? "bg-muted" : ""}`}
                  onClick={() => setTab("edit")}
                >Edit</button>
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 ${tab === "preview" ? "bg-muted" : ""}`}
                  onClick={() => setTab("preview")}
                >Preview</button>
              </div>
            </div>

            {tab === "edit" ? (
              <>
                <div className="mb-1 flex flex-wrap gap-1">
                  {VARIABLE_TOKENS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="rounded bg-muted px-2 py-0.5 font-mono text-xs hover:bg-zinc-200"
                      onClick={() => insertToken(t)}
                    >{`{{${t}}}`}</button>
                  ))}
                </div>
                <Textarea
                  ref={bodyRef}
                  value={bodyMarkdown}
                  onChange={(e) => setBodyMarkdown(e.target.value)}
                  className="font-mono"
                  rows={10}
                  maxLength={50_000}
                  placeholder="Dear {{client_first_name}}, …"
                />
              </>
            ) : (
              <div className="min-h-[200px] rounded border p-3">
                {preview.isLoading ? (
                  <p className="text-sm text-muted-foreground">Rendering…</p>
                ) : preview.data ? (
                  <SanitizedHtml html={preview.data.bodyHtml} />
                ) : (
                  <p className="text-sm text-muted-foreground">No preview available.</p>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Attachments</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAttachOpen(true)}>
                <Paperclip className="size-4 mr-1" /> Attach
              </Button>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {attached.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                  {a.filename} · {Math.round((a.fileSize ?? 0) / 1024)}KB
                  <button type="button" className="ml-1 text-red-600" onClick={() => removeAttachment(a.id)}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            {overLimit && (
              <p className="mt-1 text-xs text-red-700">Total attachment size exceeds 35MB.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSend}
            onClick={() => send.mutate({
              caseId,
              templateId,
              subject: subject.trim(),
              bodyMarkdown,
              documentIds: attached.map((a) => a.id),
            })}
          >
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>

        <AttachDocumentModal
          open={attachOpen}
          onOpenChange={setAttachOpen}
          caseId={caseId}
          multiple
          onSelectMany={(docs) => {
            const map = new Map(attached.map((a) => [a.id, a]));
            for (const d of docs) {
              if (!map.has(d.id)) {
                const ctxDoc = context.data?.attachableDocuments.find((x) => x.id === d.id);
                map.set(d.id, { id: d.id, filename: d.filename, fileSize: ctxDoc?.fileSize ?? 0 });
              }
            }
            setAttached(Array.from(map.values()));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/emails/new-email-modal.tsx
git commit -m "feat(2.3.5): NewEmailModal composer (template dropdown + preview + attachments)"
```

---

### Task 11: `<EmailsTab>` + list + detail + mount

**Files:**
- Create: `src/components/cases/emails/emails-list.tsx`
- Create: `src/components/cases/emails/email-detail.tsx`
- Create: `src/components/cases/emails/emails-tab.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Write `EmailsList`**

```tsx
// src/components/cases/emails/emails-list.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export function EmailsList({
  caseId,
  selectedId,
  onSelect,
}: {
  caseId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data, isLoading } = trpc.caseEmails.list.useQuery({ caseId });
  const emails = data?.emails ?? [];

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (emails.length === 0) return <p className="p-4 text-sm text-muted-foreground">No emails sent yet.</p>;

  return (
    <ul>
      {emails.map((e) => {
        const isActive = e.id === selectedId;
        return (
          <li
            key={e.id}
            className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
            onClick={() => onSelect(e.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{e.subject}</span>
              <Badge className={STATUS_STYLES[e.status] ?? ""}>{e.status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center justify-between gap-2">
              <span className="truncate">
                {e.recipientName ? `${e.recipientName} — ` : ""}{e.recipientEmail}
              </span>
              <span>{e.sentByName ? `${e.sentByName} · ` : ""}{formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Write `EmailDetail`**

```tsx
// src/components/cases/emails/email-detail.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { SanitizedHtml } from "@/components/common/sanitized-html";
import { NewEmailModal } from "./new-email-modal";

export function EmailDetail({ emailId, caseId }: { emailId: string; caseId: string }) {
  const { data } = trpc.caseEmails.get.useQuery({ emailId });
  const [resendOpen, setResendOpen] = React.useState(false);

  if (!data) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold truncate">{data.subject}</h3>
          <div className="mt-1 text-xs text-muted-foreground">
            To: {data.recipientName ? `${data.recipientName} — ` : ""}{data.recipientEmail}
            {" · "}From: {data.sentByName ?? "(unknown)"}
            {" · "}{format(new Date(data.createdAt), "PP p")}
            {data.templateName ? ` · Template: ${data.templateName}` : data.templateId ? " · (deleted template)" : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={data.status === "sent" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
            {data.status}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => setResendOpen(true)}>
            <RefreshCw className="size-4 mr-1" /> Send again
          </Button>
        </div>
      </div>

      {data.status === "failed" && data.errorMessage && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800">
          {data.errorMessage}
        </div>
      )}

      {data.attachments && data.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.attachments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
              <FileText className="size-3" /> {a.filename} · {Math.round(a.sizeBytes / 1024)}KB
            </span>
          ))}
        </div>
      )}

      <div className="rounded border p-3">
        <SanitizedHtml html={data.bodyHtml} />
      </div>

      <NewEmailModal
        caseId={caseId}
        open={resendOpen}
        onOpenChange={setResendOpen}
        initial={{
          subject: data.subject,
          bodyMarkdown: data.bodyMarkdown,
          templateId: data.templateId,
          attachments: [],
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write `EmailsTab`**

```tsx
// src/components/cases/emails/emails-tab.tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { NewEmailModal } from "./new-email-modal";
import { EmailsList } from "./emails-list";
import { EmailDetail } from "./email-detail";

export function EmailsTab({ caseId }: { caseId: string }) {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-80 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Emails</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <EmailsList caseId={caseId} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </aside>
      <section className="flex-1 overflow-y-auto">
        {selectedId ? (
          <EmailDetail emailId={selectedId} caseId={caseId} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Select an email or send a new one.</p>
        )}
      </section>
      <NewEmailModal caseId={caseId} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
```

- [ ] **Step 4: Mount on case detail**

Edit `src/app/(app)/cases/[id]/page.tsx`:
- In TABS array, after `{ key: "updates", label: "Updates" }`, append: `{ key: "emails", label: "Emails" }`.
- Add import: `import { EmailsTab } from "@/components/cases/emails/emails-tab";`
- After the `updates` conditional render, add: `{activeTab === "emails" && <EmailsTab caseId={caseData.id} />}`

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — EXIT 0.
Run: `npx next build 2>&1 | tail -10` — success.

- [ ] **Step 6: Commit**

```bash
git add src/components/cases/emails/emails-list.tsx src/components/cases/emails/email-detail.tsx src/components/cases/emails/emails-tab.tsx "src/app/(app)/cases/[id]/page.tsx"
git commit -m "feat(2.3.5): EmailsTab + list + detail + mount on case"
```

---

### Task 12: Settings page — Email Templates library + sidebar link

**Files:**
- Create: `src/components/settings/email-templates/templates-list.tsx`
- Create: `src/components/settings/email-templates/template-editor.tsx`
- Create: `src/app/(app)/settings/email-templates/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Write `TemplatesList`**

```tsx
// src/components/settings/email-templates/templates-list.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export function TemplatesList({ onEdit }: { onEdit: (templateId: string) => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.emailTemplates.list.useQuery();
  const del = trpc.emailTemplates.delete.useMutation({
    onSuccess: async () => {
      await utils.emailTemplates.list.invalidate();
      toast.success("Template deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const templates = data?.templates ?? [];
  if (templates.length === 0) return <p className="text-sm text-muted-foreground">No templates yet.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="p-2">Name</th>
          <th className="p-2">Subject</th>
          <th className="p-2">Updated</th>
          <th className="p-2" />
        </tr>
      </thead>
      <tbody>
        {templates.map((t) => (
          <tr key={t.id} className="border-t">
            <td className="p-2 font-medium">{t.name}</td>
            <td className="p-2 truncate max-w-xs">{t.subject}</td>
            <td className="p-2">{format(new Date(t.updatedAt), "PP")}</td>
            <td className="p-2 text-right">
              <Button size="sm" variant="ghost" onClick={() => onEdit(t.id)}>
                <Pencil className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm(`Delete "${t.name}"? Existing log entries remain; template_id becomes null.`)) {
                    del.mutate({ templateId: t.id });
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Write `TemplateEditor`**

```tsx
// src/components/settings/email-templates/template-editor.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { SanitizedHtml } from "@/components/common/sanitized-html";

const VARIABLE_TOKENS = [
  "client_name",
  "client_first_name",
  "case_name",
  "lawyer_name",
  "lawyer_email",
  "firm_name",
  "portal_url",
  "today",
];

const MOCK_VARIABLES: Record<string, string> = {
  client_name: "John Doe",
  client_first_name: "John",
  case_name: "Doe v. Acme Corp",
  lawyer_name: "Jane Smith",
  lawyer_email: "jane@firm.com",
  firm_name: "Smith & Partners",
  portal_url: "https://app.example.com/portal/cases/sample",
  today: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
};

export function TemplateEditor({
  templateId,
  open,
  onOpenChange,
}: {
  templateId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const isNew = !templateId;

  const loaded = trpc.emailTemplates.get.useQuery(
    { templateId: templateId ?? "" },
    { enabled: open && !!templateId },
  );

  const [name, setName] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [bodyMarkdown, setBodyMarkdown] = React.useState("");
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open && !templateId) {
      setName(""); setSubject(""); setBodyMarkdown("");
    } else if (open && loaded.data) {
      setName(loaded.data.name);
      setSubject(loaded.data.subject);
      setBodyMarkdown(loaded.data.bodyMarkdown);
    }
  }, [open, templateId, loaded.data]);

  const preview = trpc.caseEmails.previewRender.useQuery(
    { subject, bodyMarkdown, variables: MOCK_VARIABLES },
    { enabled: open },
  );

  const create = trpc.emailTemplates.create.useMutation({
    onSuccess: async () => {
      await utils.emailTemplates.list.invalidate();
      toast.success("Template created");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.emailTemplates.update.useMutation({
    onSuccess: async () => {
      await utils.emailTemplates.list.invalidate();
      await utils.emailTemplates.get.invalidate({ templateId: templateId ?? "" });
      toast.success("Saved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function insertToken(token: string) {
    const el = bodyRef.current;
    if (!el) { setBodyMarkdown((prev) => prev + `{{${token}}}`); return; }
    const start = el.selectionStart ?? bodyMarkdown.length;
    const end = el.selectionEnd ?? bodyMarkdown.length;
    const next = bodyMarkdown.slice(0, start) + `{{${token}}}` + bodyMarkdown.slice(end);
    setBodyMarkdown(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + token.length + 4;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function save() {
    if (!name.trim() || !subject.trim() || !bodyMarkdown.trim()) {
      toast.error("Name, subject, and body are required");
      return;
    }
    if (isNew) {
      create.mutate({ name: name.trim(), subject: subject.trim(), bodyMarkdown });
    } else {
      update.mutate({ templateId: templateId!, name: name.trim(), subject: subject.trim(), bodyMarkdown });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "New email template" : "Edit email template"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </div>
            <div>
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={500} />
            </div>
            <div>
              <Label>Body</Label>
              <div className="mb-1 flex flex-wrap gap-1">
                {VARIABLE_TOKENS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="rounded bg-muted px-2 py-0.5 font-mono text-xs hover:bg-zinc-200"
                    onClick={() => insertToken(t)}
                  >{`{{${t}}}`}</button>
                ))}
              </div>
              <Textarea
                ref={bodyRef}
                value={bodyMarkdown}
                onChange={(e) => setBodyMarkdown(e.target.value)}
                className="font-mono"
                rows={16}
                maxLength={50_000}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Preview (mock values)</Label>
            <div className="rounded border p-3 min-h-[300px]">
              <p className="text-sm font-semibold mb-2">
                {preview.data?.subject ?? subject}
              </p>
              {preview.data ? (
                <SanitizedHtml html={preview.data.bodyHtml} />
              ) : (
                <p className="text-sm text-muted-foreground">Type in the body to see a preview.</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Write page**

```tsx
// src/app/(app)/settings/email-templates/page.tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { TemplatesList } from "@/components/settings/email-templates/templates-list";
import { TemplateEditor } from "@/components/settings/email-templates/template-editor";

export default function EmailTemplatesPage() {
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  function openNew() {
    setEditingId(null);
    setEditorOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setEditorOpen(true);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Email templates</h1>
        <Button onClick={openNew}>
          <Plus className="size-4 mr-1" /> New template
        </Button>
      </div>
      <TemplatesList onEdit={openEdit} />
      <TemplateEditor templateId={editingId} open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}
```

- [ ] **Step 4: Add sidebar link**

Edit `src/components/layout/sidebar.tsx`. Read first, locate the existing `{ href: "/settings/templates", label: "Templates", icon: FileText }` entry (~line 42). Add immediately after:

```ts
  { href: "/settings/email-templates", label: "Email templates", icon: Mail },
```

Add `Mail` to the `lucide-react` import at the top if not already imported.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — EXIT 0.
Run: `npx next build 2>&1 | tail -10` — success.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/email-templates/templates-list.tsx src/components/settings/email-templates/template-editor.tsx "src/app/(app)/settings/email-templates/page.tsx" src/components/layout/sidebar.tsx
git commit -m "feat(2.3.5): /settings/email-templates page + sidebar entry"
```

---

### Task 13: E2E smoke + final verification

**Files:**
- Create: `e2e/email-outreach-smoke.spec.ts`

- [ ] **Step 1: Write smoke**

```ts
// e2e/email-outreach-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.5 email outreach smoke", () => {
  test("/cases/[id]?tab=emails returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=emails`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/settings/email-templates returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/settings/email-templates`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run smoke**

`npx playwright test e2e/email-outreach-smoke.spec.ts 2>&1 | tail -10`
Expected: both routes pass (auth redirects still count as <500).

- [ ] **Step 3: Final full-repo verification**

```bash
npx vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -3
npx next build 2>&1 | tail -20
```

Expected:
- Vitest: ≥544 tests pass (537 baseline + 7 new from Task 6).
- tsc: EXIT 0.
- Build: success.

- [ ] **Step 4: Commit**

```bash
git add e2e/email-outreach-smoke.spec.ts
git commit -m "test(2.3.5): E2E smoke for emails + templates routes"
```

---

### Task 14: Service-level UAT (post-implementation)

**Files:**
- Create (temporary, deleted after): `.tmp-uat-235.mjs`

Service-level end-to-end flow against dev DB, mirroring the UAT pattern used for 2.3.3 and 2.3.4.

- [ ] **Step 1: Write UAT script**

Write `.tmp-uat-235.mjs` that: loads `.env.local`, imports `EmailOutreachService` + schemas from `src/`, injects mock `resendSend` (captures calls) + `fetchObject` (returns fake buffer), exercises:
1. Template create/get/update/delete.
2. `resolveVariables` returns 8 keys.
3. `resolveRecipient` for the dev DB's Acme case (may return null if no contact seeded — SKIP that branch).
4. Full `send` happy path — verify resend called, log row inserted with `status='sent'`, subject substituted, body sanitized (no script tag).
5. Unknown variable stays literal in subject and body_html.
6. Failure path — inject throwing `resendSend`, verify row inserted with `status='failed'` + error_message.
7. Delete template — existing `case_email_outreach` rows have `template_id = null` after cascade.

Pattern mirrors `.tmp-uat-234.mjs` (2.3.4). Known dev DB IDs:
- `CASE_ID = "61e9c86a-4359-49cd-8d59-fdf894e11030"` (Acme Corp)
- `LAWYER_ID = "a480a3b1-b88b-4c94-96f6-0f9249673bb8"`
- `ORG_ID = "a28431e2-dc02-41ba-8b55-6d053e4ede4a"`

- [ ] **Step 2: Run UAT**

Run: `npx tsx .tmp-uat-235.mjs`
Expected: ≥10 ✓, 0 ✗.

- [ ] **Step 3: Remove script**

```bash
rm .tmp-uat-235.mjs
```

If bugs surface during UAT, fix them in the relevant file and make a separate `fix(2.3.5): ...` commit. Re-run UAT until green.

---

## Self-Review

**Spec coverage:** All 15 decisions from spec §3 mapped to tasks (T1=deps, T2-T3=schema+migration, T4=sendEmail, T5=render/sanitize, T6-T7=service, T8=routers, T9=attach-multi, T10=composer, T11=emails tab, T12=settings page, T13=e2e smoke, T14=UAT). Spec §4 data model → T2 + T3. Spec §5 variable namespace → T6 resolveVariables. Spec §6 backend → T4-T8. Spec §7 UI → T10-T12. Spec §8 UAT criteria → T14 + manual browser UAT. Spec §9 testing → T6 has 7 tests + T13 smokes + T14 integration UAT.

**Placeholder scan:** No "TBD", "add error handling", or unspecified code blocks. All React JSX provided in full.

**Type consistency:**
- Service signatures: `createTemplate({ orgId, name, subject, bodyMarkdown, createdBy })` — consistent across T6, T8, T14.
- `resolveVariables` returns `Record<string, string>` with identical 8 keys across T6, T8, T10, T14.
- `send` return shape `{ emailId, resendId }` — T7 service, T8 router, T14 UAT all match.
- Status literals `sent | failed` consistent across T2 schema CHECK, T7 service inserts, T11 badge styles.
- `VARIABLE_TOKENS` array identical in T10 composer and T12 template editor.
- `MAX_BYTES = 35 * 1024 * 1024` consistent in T7 service and T10 composer.
- No Inngest events in this phase — no event-name consistency to check.
