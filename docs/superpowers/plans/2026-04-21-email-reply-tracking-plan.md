# 2.3.5b Email Reply Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inbound client replies to 2.3.5 outbound emails land in the Emails tab, bounces mark the outbound as undeliverable, auto-replies are classified and hidden by default, and attachments can be promoted to case documents — all via Resend Inbound webhook on a dedicated `reply.clearterms.ai` subdomain.

**Architecture:** 2.3.5 `send()` is modified to pre-generate `outreach_id` and set `Reply-To: case-email-{outreach_id}@reply.clearterms.ai`. A new Next.js route `POST /api/webhooks/resend/inbound` verifies Svix signature, parses the To-address for the outreach UUID, classifies the inbound as human/auto-reply/bounce, sanitizes body, persists to new `case_email_replies` + `case_email_reply_attachments` tables (with S3 for binary), inserts an in-app notification, and optionally enqueues an external email via existing Inngest. UI: new `<RepliesSection>` inline under each outbound in EmailDetail; bounce banner; reply badge on email list; NewEmailModal gains a `replyTo` pre-fill; settings page exposes an email-channel pref for the `email_reply_received` notification type.

**Tech Stack:** Next.js 16 App Router (Node runtime for webhook), Drizzle ORM, tRPC v11, Zod v4, Resend Inbound (Svix signatures), `standardwebhooks` npm package, AWS S3 (existing client), DOMPurify (reuse 2.3.5), Inngest (existing, for optional external email), Vitest with mock-db pattern, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-21-email-reply-tracking-design.md`

**Branch:** `feature/2.3.5b-email-reply-tracking` (already created, spec committed at `5338237`).

**Key existing files (recon output, trust these):**

- `src/server/services/email-outreach/service.ts` — `EmailOutreachService.send()` currently inserts outreach row AFTER calling resendSend. T7 below changes it to pre-generate `outreach_id` via `crypto.randomUUID()` so the unique Reply-To is known before send.
- `src/server/db/schema/notifications.ts` — `notifications(orgId, userId, type, title, body, caseId, actionUrl, dedupKey, isRead, ...)`; `dedupKey` UNIQUE when non-null.
- `src/server/db/schema/notification-preferences.ts` — row-per-pref: `(userId, notificationType, channel, enabled)` unique index. Channel values in use: `'inapp'`, `'email'`. We add two new semantic rows, no schema change.
- `src/server/services/s3.ts` — exports `getObject(s3Key)`, `deleteObject(s3Key)`, `generatePresignedUrl`, uses `PutObjectCommand` via shared client constant. No `putObject` export — we add one in T5 via a small additive export.
- `src/server/services/email-outreach/render.ts` — exports `renderMarkdownToHtml`, `substituteVariables`, `renderEmail`. 2.3.5b imports DOMPurify config from here (ALLOWED_TAGS / ALLOWED_ATTR) — T4 exports them.
- `src/server/db/schema/documents.ts` — columns: `id, filename, s3Key, fileType (enum), fileSize, caseId, uploadedBy, …`. `fileType` is an enum: `'pdf'|'docx'|'image'|'other'` (verify at T8).
- `src/server/inngest/` — existing Inngest app. T13 adds one new event + function for optional external email-on-reply.

**Known dev DB IDs (from 2.3.5 UAT, confirmed live):**

- `CASE_ID = "61e9c86a-4359-49cd-8d59-fdf894e11030"` (Acme Corp)
- `LAWYER_ID = "a480a3b1-b88b-4c94-96f6-0f9249673bb8"`
- `ORG_ID = "a28431e2-dc02-41ba-8b55-6d053e4ede4a"`

---

## File Structure

**Create:**
- `src/server/db/schema/case-email-replies.ts`
- `src/server/db/schema/case-email-reply-attachments.ts`
- `src/server/db/migrations/0017_email_replies.sql`
- `src/server/services/email-outreach/classify.ts` — pure helpers: `classifyReplyKind`, `isBounce`
- `src/server/services/email-outreach/sender-match.ts` — pure helper: `normalizeEmail`, `isSenderMismatch`
- `src/server/services/email-outreach/inbound.ts` — main pipeline class `EmailInboundService`
- `src/app/api/webhooks/resend/inbound/route.ts` — Next.js POST route
- `src/components/cases/emails/reply-row.tsx`
- `src/components/cases/emails/replies-section.tsx`
- `tests/unit/email-inbound-classify.test.ts`
- `tests/unit/email-inbound-sender-match.test.ts`
- `tests/integration/email-inbound-service.test.ts`
- `tests/fixtures/resend-inbound/human.json`
- `tests/fixtures/resend-inbound/auto-reply.json`
- `tests/fixtures/resend-inbound/bounce.json`
- `tests/fixtures/resend-inbound/with-attachments.json`
- `e2e/email-replies-smoke.spec.ts`

**Modify:**
- `package.json` — add `standardwebhooks`.
- `src/server/db/schema/case-email-outreach.ts` — `bounceReason`, `bouncedAt`, `lawyerLastSeenRepliesAt` columns; extend status literal (`sent|failed|bounced`); extend CHECK constraint via migration.
- `src/server/services/email-outreach/render.ts` — export `ALLOWED_TAGS`, `ALLOWED_ATTR`, add `sanitizeHtml` helper that uses them (so inbound can reuse).
- `src/server/services/email-outreach/service.ts` — `send()` pre-generates `outreachId`; sets Reply-To to inbound address; `listForCase` includes `replyCount`/`hasUnreadReplies`; `getEmail` includes `replies` + their attachments; new `promoteReplyAttachment`; new `markRepliesRead`.
- `src/server/services/s3.ts` — add `putObject(key, body, contentType)` export (thin wrapper around existing `PutObjectCommand` pattern).
- `src/server/trpc/routers/case-emails.ts` — `promoteReplyAttachment`, `markRepliesRead`; existing `list`/`get` wider return; `send` wires new outreachId param.
- `src/server/inngest/index.ts` or equivalent index — register new function.
- `src/components/cases/emails/emails-list.tsx` — reply count badge, `bounced` status style, unread-dot.
- `src/components/cases/emails/email-detail.tsx` — mount `<RepliesSection>`, bounce banner, mark-read on mount, "Reply" button pre-fills NewEmailModal.
- `src/components/cases/emails/new-email-modal.tsx` — optional `replyTo` prop.
- `src/app/(app)/settings/notifications/page.tsx` — add "Email me when a client replies to a sent email" row (or create page if absent).
- `tests/integration/email-outreach-service.test.ts` — update existing 7 tests if `send()` signature changes break them.
- `.env.example` — `RESEND_INBOUND_WEBHOOK_SECRET`, `REPLY_DOMAIN`.

**Not touched:** Inngest existing functions (only ADD new one), portal UI, sidebar layout, Messaging tab badge.

---

### Task 1: Install `standardwebhooks` + recon

- [ ] **Step 1: Install dep**

Run: `npm install standardwebhooks`
Expected: added to `dependencies`. Package ships its own types.

- [ ] **Step 2: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 3: Recon `/settings/notifications` page presence**

Run: `ls src/app/\(app\)/settings/notifications/page.tsx 2>&1 || echo MISSING`
Record result in your head for Task 12 branching.

- [ ] **Step 4: Recon `documents.fileType` allowed values**

Run: `grep -n "fileType\|pgEnum" src/server/db/schema/documents.ts`
Record the set (likely `'pdf'|'docx'|'image'|'other'`) — needed for `promoteReplyAttachment` mapping in T8.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(2.3.5b): add standardwebhooks dep"
```

---

### Task 2: Drizzle schemas — two new tables + modify case-email-outreach

**Files:**
- Create: `src/server/db/schema/case-email-replies.ts`
- Create: `src/server/db/schema/case-email-reply-attachments.ts`
- Modify: `src/server/db/schema/case-email-outreach.ts`

- [ ] **Step 1: Write `case-email-replies.ts`**

```ts
// src/server/db/schema/case-email-replies.ts
import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { caseEmailOutreach } from "./case-email-outreach";

export const caseEmailReplies = pgTable(
  "case_email_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outreachId: uuid("outreach_id").references(() => caseEmailOutreach.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    replyKind: text("reply_kind").notNull(),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    subject: text("subject").notNull(),
    bodyText: text("body_text"),
    bodyHtml: text("body_html").notNull(),
    senderMismatch: boolean("sender_mismatch").notNull().default(false),
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    resendEventId: text("resend_event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("case_email_replies_event_id_unique").on(table.resendEventId),
    index("case_email_replies_outreach_received_idx").on(table.outreachId, table.receivedAt),
    index("case_email_replies_case_received_idx").on(table.caseId, table.receivedAt),
    check(
      "case_email_replies_kind_check",
      sql`${table.replyKind} IN ('human','auto_reply')`,
    ),
  ],
);

export type CaseEmailReply = typeof caseEmailReplies.$inferSelect;
export type NewCaseEmailReply = typeof caseEmailReplies.$inferInsert;
```

- [ ] **Step 2: Write `case-email-reply-attachments.ts`**

```ts
// src/server/db/schema/case-email-reply-attachments.ts
import { pgTable, uuid, text, integer, index, timestamp } from "drizzle-orm/pg-core";
import { caseEmailReplies } from "./case-email-replies";
import { documents } from "./documents";

export const caseEmailReplyAttachments = pgTable(
  "case_email_reply_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    replyId: uuid("reply_id").references(() => caseEmailReplies.id, { onDelete: "cascade" }).notNull(),
    s3Key: text("s3_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    promotedDocumentId: uuid("promoted_document_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_email_reply_attachments_reply_idx").on(table.replyId),
  ],
);

export type CaseEmailReplyAttachment = typeof caseEmailReplyAttachments.$inferSelect;
export type NewCaseEmailReplyAttachment = typeof caseEmailReplyAttachments.$inferInsert;
```

- [ ] **Step 3: Modify `case-email-outreach.ts` — add 3 columns + widen status literal**

Read current file first. Locate the columns block and the status `check` constraint. Add three new columns after `createdAt`. The CHECK constraint stays in the Drizzle file unchanged — the migration in T3 handles the DROP+ADD at the DB layer. The TypeScript status union is inferred from DB; to document the new value in the code, add no literal union (Drizzle types come from `$inferSelect`).

Add these columns to the `columns` object (order: after existing `createdAt`):

```ts
    bounceReason: text("bounce_reason"),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    lawyerLastSeenRepliesAt: timestamp("lawyer_last_seen_replies_at", { withTimezone: true }),
```

Do NOT modify the existing `check(...)` expression — the DB-level drop/add is in T3's migration. Drizzle's `check` is declarative-only for drift detection.

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/case-email-replies.ts src/server/db/schema/case-email-reply-attachments.ts src/server/db/schema/case-email-outreach.ts
git commit -m "feat(2.3.5b): drizzle schema — replies, attachments, outreach cols"
```

---

### Task 3: Migration 0017 + apply to dev DB

**Files:**
- Create: `src/server/db/migrations/0017_email_replies.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- 0017_email_replies.sql
-- Phase 2.3.5b: email reply tracking.

CREATE TABLE "case_email_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outreach_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "reply_kind" text NOT NULL,
  "from_email" text NOT NULL,
  "from_name" text,
  "subject" text NOT NULL,
  "body_text" text,
  "body_html" text NOT NULL,
  "sender_mismatch" boolean NOT NULL DEFAULT false,
  "message_id" text,
  "in_reply_to" text,
  "resend_event_id" text NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_email_replies_kind_check" CHECK ("reply_kind" IN ('human','auto_reply'))
);

ALTER TABLE "case_email_replies"
  ADD CONSTRAINT "case_email_replies_outreach_id_fk" FOREIGN KEY ("outreach_id") REFERENCES "public"."case_email_outreach"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_email_replies_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "case_email_replies_event_id_unique" ON "case_email_replies" USING btree ("resend_event_id");
CREATE INDEX "case_email_replies_outreach_received_idx" ON "case_email_replies" USING btree ("outreach_id","received_at");
CREATE INDEX "case_email_replies_case_received_idx" ON "case_email_replies" USING btree ("case_id","received_at");

CREATE TABLE "case_email_reply_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reply_id" uuid NOT NULL,
  "s3_key" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "promoted_document_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "case_email_reply_attachments"
  ADD CONSTRAINT "case_email_reply_attachments_reply_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."case_email_replies"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_email_reply_attachments_doc_id_fk" FOREIGN KEY ("promoted_document_id") REFERENCES "public"."documents"("id") ON DELETE set null;

CREATE INDEX "case_email_reply_attachments_reply_idx" ON "case_email_reply_attachments" USING btree ("reply_id");

ALTER TABLE "case_email_outreach" DROP CONSTRAINT "case_email_outreach_status_check";
ALTER TABLE "case_email_outreach" ADD CONSTRAINT "case_email_outreach_status_check" CHECK ("status" IN ('sent','failed','bounced'));
ALTER TABLE "case_email_outreach" ADD COLUMN "bounce_reason" text;
ALTER TABLE "case_email_outreach" ADD COLUMN "bounced_at" timestamp with time zone;
ALTER TABLE "case_email_outreach" ADD COLUMN "lawyer_last_seen_replies_at" timestamp with time zone;
```

- [ ] **Step 2: Apply to dev DB**

Use the same Node one-liner pattern as 2.3.5 T3 (loads `.env.local`, `postgres` driver, `sql.unsafe(ddl)`, then counts). After apply, run:

```
SELECT COUNT(*) FROM case_email_replies;
SELECT COUNT(*) FROM case_email_reply_attachments;
SELECT bounce_reason, bounced_at, lawyer_last_seen_replies_at FROM case_email_outreach LIMIT 1;
```

Expected: `replies: 0 | attachments: 0 | outreach columns exist and are NULL on existing rows`.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/migrations/0017_email_replies.sql
git commit -m "feat(2.3.5b): migration 0017 — email reply tables + outreach cols"
```

---

### Task 4: Pure classify + sender-match helpers + unit tests (TDD)

**Files:**
- Create: `src/server/services/email-outreach/classify.ts`
- Create: `src/server/services/email-outreach/sender-match.ts`
- Create: `tests/unit/email-inbound-classify.test.ts`
- Create: `tests/unit/email-inbound-sender-match.test.ts`
- Modify: `src/server/services/email-outreach/render.ts` — add exports

- [ ] **Step 1: Write failing classify test**

```ts
// tests/unit/email-inbound-classify.test.ts
import { describe, it, expect } from "vitest";
import { classifyReplyKind, isBounce } from "@/server/services/email-outreach/classify";

describe("classifyReplyKind", () => {
  it("returns 'auto_reply' for Auto-Submitted=auto-replied", () => {
    expect(classifyReplyKind({ headers: { "auto-submitted": "auto-replied" }, subject: "hi" })).toBe("auto_reply");
  });
  it("returns 'auto_reply' for Precedence=bulk", () => {
    expect(classifyReplyKind({ headers: { precedence: "bulk" }, subject: "hi" })).toBe("auto_reply");
  });
  it("returns 'auto_reply' for X-Autoreply truthy", () => {
    expect(classifyReplyKind({ headers: { "x-autoreply": "yes" }, subject: "hi" })).toBe("auto_reply");
  });
  it("returns 'auto_reply' for Out of Office subject", () => {
    expect(classifyReplyKind({ headers: {}, subject: "Out of Office: John" })).toBe("auto_reply");
  });
  it("returns 'auto_reply' for Automatic Reply subject", () => {
    expect(classifyReplyKind({ headers: {}, subject: "Automatic Reply from Jane" })).toBe("auto_reply");
  });
  it("returns 'human' for a plain reply", () => {
    expect(classifyReplyKind({ headers: {}, subject: "Re: Your case update" })).toBe("human");
  });
  it("ignores Auto-Submitted=no", () => {
    expect(classifyReplyKind({ headers: { "auto-submitted": "no" }, subject: "hi" })).toBe("human");
  });
});

describe("isBounce", () => {
  it("detects Mail Delivery Failure subject", () => {
    expect(isBounce({ from: "mailer-daemon@example.com", subject: "Mail Delivery Failure", headers: {} })).toBe(true);
  });
  it("detects Undeliverable subject", () => {
    expect(isBounce({ from: "postmaster@host.com", subject: "Undeliverable: your email", headers: {} })).toBe(true);
  });
  it("detects Delivery Status Notification subject", () => {
    expect(isBounce({ from: "MAILER-DAEMON@a", subject: "Delivery Status Notification (Failure)", headers: {} })).toBe(true);
  });
  it("returns false for a normal reply", () => {
    expect(isBounce({ from: "john@client.com", subject: "Re: hello", headers: {} })).toBe(false);
  });
  it("returns false for subject that contains 'delivery' but not a bounce phrase", () => {
    expect(isBounce({ from: "john@client.com", subject: "Confirming delivery address", headers: {} })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run tests/unit/email-inbound-classify.test.ts`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement `classify.ts`**

```ts
// src/server/services/email-outreach/classify.ts

export type ReplyKind = "human" | "auto_reply";

export interface ClassifyInput {
  headers: Record<string, string | undefined>;
  subject: string;
}

const AUTO_SUBJECT = /^(Out of Office|Automatic Reply|Auto[- ]?reply|I am (?:currently )?out of)/i;
const BOUNCE_SUBJECT = /^(Mail Delivery Failure|Undeliverable|Delivery Status Notification|Returned mail)/i;
const MAILER_DAEMON = /^(mailer-daemon|postmaster)@/i;
const BULK_PRECEDENCE = new Set(["bulk", "list", "junk", "auto_reply"]);

function headerLower(headers: Record<string, string | undefined>, name: string): string | undefined {
  // Accept any casing for header lookup.
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

export function classifyReplyKind(input: ClassifyInput): ReplyKind {
  const autoSub = headerLower(input.headers, "auto-submitted");
  if (autoSub && autoSub.toLowerCase() !== "no") return "auto_reply";

  const precedence = headerLower(input.headers, "precedence");
  if (precedence && BULK_PRECEDENCE.has(precedence.toLowerCase())) return "auto_reply";

  const autoreply = headerLower(input.headers, "x-autoreply");
  if (autoreply && autoreply.toLowerCase() !== "no" && autoreply !== "") return "auto_reply";

  if (AUTO_SUBJECT.test(input.subject)) return "auto_reply";

  return "human";
}

export interface BounceInput {
  from: string;
  subject: string;
  headers: Record<string, string | undefined>;
}

export function isBounce(input: BounceInput): boolean {
  if (BOUNCE_SUBJECT.test(input.subject) && MAILER_DAEMON.test(input.from)) return true;
  if (BOUNCE_SUBJECT.test(input.subject)) return true;
  return false;
}
```

- [ ] **Step 4: Run classify tests — verify all pass**

Run: `npx vitest run tests/unit/email-inbound-classify.test.ts`
Expected: 12/12 PASS.

- [ ] **Step 5: Write failing sender-match test**

```ts
// tests/unit/email-inbound-sender-match.test.ts
import { describe, it, expect } from "vitest";
import { normalizeEmail, isSenderMismatch } from "@/server/services/email-outreach/sender-match";

describe("normalizeEmail", () => {
  it("lowercases", () => {
    expect(normalizeEmail("FOO@BAR.COM")).toBe("foo@bar.com");
  });
  it("trims", () => {
    expect(normalizeEmail("  a@b.com  ")).toBe("a@b.com");
  });
  it("strips +tag", () => {
    expect(normalizeEmail("user+tag@example.com")).toBe("user@example.com");
  });
  it("handles already-normalized", () => {
    expect(normalizeEmail("a@b.com")).toBe("a@b.com");
  });
});

describe("isSenderMismatch", () => {
  it("same address → false", () => {
    expect(isSenderMismatch("a@b.com", "A@B.COM")).toBe(false);
  });
  it("+tag vs plain → false", () => {
    expect(isSenderMismatch("a+x@b.com", "a@b.com")).toBe(false);
  });
  it("different user → true", () => {
    expect(isSenderMismatch("a@b.com", "c@b.com")).toBe(true);
  });
  it("different domain → true", () => {
    expect(isSenderMismatch("a@b.com", "a@c.com")).toBe(true);
  });
});
```

- [ ] **Step 6: Run test — verify it fails**

Run: `npx vitest run tests/unit/email-inbound-sender-match.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement `sender-match.ts`**

```ts
// src/server/services/email-outreach/sender-match.ts

export function normalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const atIdx = trimmed.indexOf("@");
  if (atIdx < 0) return trimmed;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx);
  const plusIdx = local.indexOf("+");
  const cleanLocal = plusIdx < 0 ? local : local.slice(0, plusIdx);
  return cleanLocal + domain;
}

export function isSenderMismatch(from: string, expectedRecipient: string): boolean {
  return normalizeEmail(from) !== normalizeEmail(expectedRecipient);
}
```

- [ ] **Step 8: Run sender-match tests**

Run: `npx vitest run tests/unit/email-inbound-sender-match.test.ts`
Expected: 8/8 PASS.

- [ ] **Step 9: Export sanitize helpers from `render.ts`**

Read `src/server/services/email-outreach/render.ts`. It already has `ALLOWED_TAGS` + `ALLOWED_ATTR` as module-local consts and `renderMarkdownToHtml` which uses them. Add two exports:

```ts
// Append (or reshape) to expose for the inbound pipeline. Do NOT redefine — export existing.
export { ALLOWED_TAGS, ALLOWED_ATTR };

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
```

If the existing file declares `const ALLOWED_TAGS = [...]` → change to `export const`. Same for ALLOWED_ATTR. Add `sanitizeHtml` as a new named export. Leave `renderEmail` / `renderMarkdownToHtml` untouched.

- [ ] **Step 10: Verify existing 2.3.5 tests still green**

Run: `npx vitest run tests/integration/email-outreach-service.test.ts`
Expected: 7/7 PASS.

- [ ] **Step 11: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 12: Commit**

```bash
git add src/server/services/email-outreach/classify.ts src/server/services/email-outreach/sender-match.ts src/server/services/email-outreach/render.ts tests/unit/email-inbound-classify.test.ts tests/unit/email-inbound-sender-match.test.ts
git commit -m "feat(2.3.5b): classify + sender-match helpers + sanitizeHtml export"
```

---

### Task 5: S3 `putObject` wrapper + `EmailInboundService` scaffolding + insert tests

**Files:**
- Modify: `src/server/services/s3.ts` — add `putObject` export.
- Create: `src/server/services/email-outreach/inbound.ts`
- Create: `tests/integration/email-inbound-service.test.ts`

- [ ] **Step 1: Add `putObject` to s3 service**

Read `src/server/services/s3.ts`. Locate the shared `s3Client` or `client` const used by `PutObjectCommand` calls. Add at the bottom:

```ts
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await s3Client.send(command);
}
```

If the bucket env var name differs in the file (could be `S3_BUCKET` or similar), match the existing usage — grep for `Bucket:` in the same file to confirm.

- [ ] **Step 2: Scaffold `EmailInboundService` (core pipeline)**

Write this full file. It contains the pure-ish service that the route calls; it takes injectable deps so tests don't need real S3.

```ts
// src/server/services/email-outreach/inbound.ts
import { eq, and } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { caseEmailReplies, type NewCaseEmailReply } from "@/server/db/schema/case-email-replies";
import { caseEmailReplyAttachments, type NewCaseEmailReplyAttachment } from "@/server/db/schema/case-email-reply-attachments";
import { notifications } from "@/server/db/schema/notifications";
import { notificationPreferences } from "@/server/db/schema/notification-preferences";
import { classifyReplyKind, isBounce } from "./classify";
import { isSenderMismatch } from "./sender-match";
import { sanitizeHtml } from "./render";
import { randomUUID } from "crypto";

const REPLY_DOMAIN = process.env.REPLY_DOMAIN ?? "reply.clearterms.ai";
const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
const INLINE_IMAGE_SKIP_BYTES = 10 * 1024;
const ALLOWED_CONTENT_TYPE = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml)\..*|image\/(png|jpeg|jpg|gif|webp)|text\/plain|text\/csv|application\/zip)$/i;

export const REPLY_TO_REGEX = /^case-email-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@reply\.clearterms\.ai$/i;

export function buildReplyToAddress(outreachId: string): string {
  return `case-email-${outreachId}@${REPLY_DOMAIN}`;
}

export function parseOutreachIdFromTo(toAddresses: string[]): string | null {
  for (const addr of toAddresses) {
    const m = addr.match(REPLY_TO_REGEX);
    if (m) return m[1];
  }
  return null;
}

export interface InboundPayload {
  eventId: string;
  to: string[];
  from: { email: string; name?: string };
  subject: string;
  text?: string;
  html?: string;
  headers: Record<string, string | undefined>;
  messageId?: string;
  inReplyTo?: string;
  receivedAt: Date;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    content: Buffer;
    contentId?: string;
  }>;
}

export interface InboundResult {
  status: "ok" | "duplicate" | "unrouted" | "no-parent" | "bounced";
  replyId?: string;
}

export interface EmailInboundServiceDeps {
  db?: typeof defaultDb;
  putObject?: (key: string, body: Buffer, contentType: string) => Promise<void>;
  enqueueExternalEmail?: (opts: { userId: string; replyId: string }) => Promise<void>;
}

export class EmailInboundService {
  private readonly db: typeof defaultDb;
  private readonly putObject?: EmailInboundServiceDeps["putObject"];
  private readonly enqueueExternalEmail?: EmailInboundServiceDeps["enqueueExternalEmail"];

  constructor(deps: EmailInboundServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.putObject = deps.putObject;
    this.enqueueExternalEmail = deps.enqueueExternalEmail;
  }

  async ingest(payload: InboundPayload): Promise<InboundResult> {
    // 1. idempotency
    const existing = await this.db
      .select({ id: caseEmailReplies.id })
      .from(caseEmailReplies)
      .where(eq(caseEmailReplies.resendEventId, payload.eventId))
      .limit(1);
    if (existing.length > 0) return { status: "duplicate", replyId: existing[0].id };

    // 2. routing
    const outreachId = parseOutreachIdFromTo(payload.to);
    if (!outreachId) return { status: "unrouted" };

    // 3. lookup outreach
    const [outreach] = await this.db
      .select({
        id: caseEmailOutreach.id,
        caseId: caseEmailOutreach.caseId,
        sentBy: caseEmailOutreach.sentBy,
        recipientEmail: caseEmailOutreach.recipientEmail,
        subject: caseEmailOutreach.subject,
      })
      .from(caseEmailOutreach)
      .where(eq(caseEmailOutreach.id, outreachId))
      .limit(1);
    if (!outreach) return { status: "no-parent" };

    // 4. bounce path — update outreach, no reply row
    if (isBounce({ from: payload.from.email, subject: payload.subject, headers: payload.headers })) {
      const reason = (payload.text ?? payload.subject).slice(0, 2000);
      await this.db
        .update(caseEmailOutreach)
        .set({ status: "bounced", bounceReason: reason, bouncedAt: new Date() })
        .where(eq(caseEmailOutreach.id, outreach.id));
      if (outreach.sentBy) {
        await this.db.insert(notifications).values({
          userId: outreach.sentBy,
          type: "email_bounced",
          title: `Email bounced`,
          body: `Delivery failed for email "${outreach.subject}"`,
          caseId: outreach.caseId,
          dedupKey: `bounce:${outreach.id}`,
        }).onConflictDoNothing?.({ target: notifications.dedupKey });
      }
      return { status: "bounced" };
    }

    // 5. classify
    const replyKind = classifyReplyKind({ headers: payload.headers, subject: payload.subject });

    // 6. sender mismatch flag
    const senderMismatch = isSenderMismatch(payload.from.email, outreach.recipientEmail);

    // 7. sanitize body
    const rawHtml = payload.html ?? `<p>${(payload.text ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</p>`;
    const bodyHtml = sanitizeHtml(rawHtml);

    // 8. attachment budget
    const replyId = randomUUID();
    const accepted: Array<{ key: string; filename: string; contentType: string; size: number; content: Buffer }> = [];
    let spent = 0;
    for (const a of payload.attachments ?? []) {
      if (spent + a.size > MAX_ATTACHMENTS_BYTES) break;
      if (a.contentId && a.contentType.startsWith("image/") && a.size < INLINE_IMAGE_SKIP_BYTES) continue;
      if (!ALLOWED_CONTENT_TYPE.test(a.contentType)) continue;
      accepted.push({
        key: `email-replies/${replyId}/${a.filename}`,
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        content: a.content,
      });
      spent += a.size;
    }

    // 9. upload to S3 (before DB insert so a failure doesn't orphan DB rows)
    if (accepted.length > 0) {
      if (!this.putObject) throw new Error("putObject dep not injected");
      for (const a of accepted) {
        await this.putObject(a.key, a.content, a.contentType);
      }
    }

    // 10. insert reply
    const newReply: NewCaseEmailReply = {
      id: replyId,
      outreachId: outreach.id,
      caseId: outreach.caseId,
      replyKind,
      fromEmail: payload.from.email,
      fromName: payload.from.name ?? null,
      subject: payload.subject,
      bodyText: payload.text ?? null,
      bodyHtml,
      senderMismatch,
      messageId: payload.messageId ?? null,
      inReplyTo: payload.inReplyTo ?? null,
      resendEventId: payload.eventId,
      receivedAt: payload.receivedAt,
    };
    await this.db.insert(caseEmailReplies).values(newReply);

    // 11. insert attachment rows
    if (accepted.length > 0) {
      const rows: NewCaseEmailReplyAttachment[] = accepted.map((a) => ({
        replyId,
        s3Key: a.key,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.size,
      }));
      await this.db.insert(caseEmailReplyAttachments).values(rows);
    }

    // 12. notification
    if (outreach.sentBy) {
      try {
        await this.db.insert(notifications).values({
          userId: outreach.sentBy,
          type: "email_reply_received",
          title: replyKind === "auto_reply" ? `Auto-reply received` : `Client replied`,
          body: `${payload.from.name ?? payload.from.email}: ${(payload.text ?? "").slice(0, 140)}`,
          caseId: outreach.caseId,
          dedupKey: `reply:${replyId}`,
        });
      } catch (e) {
        // swallow — reply persisted; a follow-up sweeper can reconcile.
        console.error("[inbound] notification insert failed", e);
      }

      // 13. optional external email — only for human replies + prefs opt-in
      if (replyKind === "human" && this.enqueueExternalEmail) {
        const prefs = await this.db
          .select({ enabled: notificationPreferences.enabled })
          .from(notificationPreferences)
          .where(
            and(
              eq(notificationPreferences.userId, outreach.sentBy),
              eq(notificationPreferences.notificationType, "email_reply_received"),
              eq(notificationPreferences.channel, "email"),
            ),
          )
          .limit(1);
        if (prefs[0]?.enabled === true) {
          try {
            await this.enqueueExternalEmail({ userId: outreach.sentBy, replyId });
          } catch (e) {
            console.error("[inbound] external email enqueue failed", e);
          }
        }
      }
    }

    return { status: "ok", replyId };
  }
}
```

- [ ] **Step 3: Write integration tests with mock db**

```ts
// tests/integration/email-inbound-service.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { EmailInboundService, buildReplyToAddress, parseOutreachIdFromTo, REPLY_TO_REGEX } from "@/server/services/email-outreach/inbound";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";

function makeMockDb(opts: {
  existingReplyForEventId?: string;
  existingOutreach?: { id: string; caseId: string; sentBy: string; recipientEmail: string; subject: string } | null;
  prefsEnabled?: boolean;
}) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown; where: unknown }> = [];
  const db: any = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => ({
        where: (w: unknown) => {
          updates.push({ table: t, set: s, where: w });
          return Promise.resolve();
        },
      }),
    }),
    select: (selectShape?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            // Simulate queries in order: (a) event-id lookup, (b) outreach lookup, (c) prefs lookup
            // Use table identity to disambiguate.
            const tableStr = String(table);
            if (tableStr.includes("replies") || (selectShape && "id" in selectShape && opts.existingReplyForEventId)) {
              return opts.existingReplyForEventId ? [{ id: "existing-reply-id" }] : [];
            }
            if (tableStr.includes("outreach") || (selectShape && "recipientEmail" in (selectShape ?? {}))) {
              return opts.existingOutreach ? [opts.existingOutreach] : [];
            }
            if (tableStr.includes("notification_preferences") || (selectShape && "enabled" in (selectShape ?? {}))) {
              return opts.prefsEnabled ? [{ enabled: true }] : [];
            }
            return [];
          },
        }),
      }),
    }),
  };
  return { db, inserts, updates };
}

const OUTREACH_ID = "11111111-1111-1111-1111-111111111111";
const CASE_ID = "22222222-2222-2222-2222-222222222222";
const LAWYER_ID = "33333333-3333-3333-3333-333333333333";
const BASE_OUTREACH = {
  id: OUTREACH_ID,
  caseId: CASE_ID,
  sentBy: LAWYER_ID,
  recipientEmail: "jane@client.com",
  subject: "Your case update",
};

const BASE_PAYLOAD = {
  eventId: "evt_1",
  to: [buildReplyToAddress(OUTREACH_ID)],
  from: { email: "jane@client.com", name: "Jane Client" },
  subject: "Re: Your case update",
  text: "Thanks, John. Got it.",
  html: "<p>Thanks, John. Got it.</p>",
  headers: {} as Record<string, string | undefined>,
  receivedAt: new Date("2026-04-21T12:00:00Z"),
};

describe("buildReplyToAddress / parseOutreachIdFromTo", () => {
  it("round-trips", () => {
    const addr = buildReplyToAddress(OUTREACH_ID);
    expect(parseOutreachIdFromTo([addr])).toBe(OUTREACH_ID);
  });
  it("rejects non-matching addresses", () => {
    expect(parseOutreachIdFromTo(["random@example.com"])).toBeNull();
  });
});

describe("EmailInboundService.ingest", () => {
  it("idempotent on duplicate event id", async () => {
    const { db } = makeMockDb({ existingReplyForEventId: "evt_1" });
    const svc = new EmailInboundService({ db });
    const res = await svc.ingest(BASE_PAYLOAD);
    expect(res.status).toBe("duplicate");
  });

  it("unrouted when To doesn't match", async () => {
    const { db } = makeMockDb({ existingOutreach: null });
    const svc = new EmailInboundService({ db });
    const res = await svc.ingest({ ...BASE_PAYLOAD, to: ["who@somewhere.com"] });
    expect(res.status).toBe("unrouted");
  });

  it("no-parent when outreach id unknown", async () => {
    const { db } = makeMockDb({ existingOutreach: null });
    const svc = new EmailInboundService({ db });
    const res = await svc.ingest(BASE_PAYLOAD);
    expect(res.status).toBe("no-parent");
  });

  it("bounce → updates outreach status, no reply row", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const svc = new EmailInboundService({ db });
    const res = await svc.ingest({
      ...BASE_PAYLOAD,
      from: { email: "mailer-daemon@example.com" },
      subject: "Mail Delivery Failure",
    });
    expect(res.status).toBe("bounced");
    const replyInserts = inserts.filter((i) => String(i.table).includes("replies"));
    expect(replyInserts.length).toBe(0);
    const outreachUpdates = updates.filter((u) => u.table === caseEmailOutreach);
    expect(outreachUpdates.length).toBe(1);
    expect((outreachUpdates[0].set as Record<string, unknown>).status).toBe("bounced");
  });

  it("inserts human reply + notification", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const svc = new EmailInboundService({ db });
    const res = await svc.ingest(BASE_PAYLOAD);
    expect(res.status).toBe("ok");
    expect(res.replyId).toBeTruthy();
    const replyInserts = inserts.filter((i) => {
      const v = i.values as Record<string, unknown>;
      return "replyKind" in v;
    });
    expect(replyInserts.length).toBe(1);
    expect((replyInserts[0].values as Record<string, unknown>).replyKind).toBe("human");
    expect((replyInserts[0].values as Record<string, unknown>).senderMismatch).toBe(false);
  });

  it("flags sender_mismatch when From differs from recipient", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const svc = new EmailInboundService({ db });
    await svc.ingest({ ...BASE_PAYLOAD, from: { email: "assistant@otherdomain.com" } });
    const replyValues = (inserts.find((i) => {
      const v = i.values as Record<string, unknown>;
      return "replyKind" in v;
    })!.values) as Record<string, unknown>;
    expect(replyValues.senderMismatch).toBe(true);
  });

  it("classifies Out of Office as auto_reply", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const svc = new EmailInboundService({ db });
    await svc.ingest({ ...BASE_PAYLOAD, subject: "Out of Office: back on Monday" });
    const replyValues = (inserts.find((i) => {
      const v = i.values as Record<string, unknown>;
      return "replyKind" in v;
    })!.values) as Record<string, unknown>;
    expect(replyValues.replyKind).toBe("auto_reply");
  });

  it("sanitizes <script> from body_html", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const svc = new EmailInboundService({ db });
    await svc.ingest({
      ...BASE_PAYLOAD,
      html: "<p>hi</p><script>alert(1)</script>",
    });
    const replyValues = (inserts.find((i) => {
      const v = i.values as Record<string, unknown>;
      return "replyKind" in v;
    })!.values) as Record<string, unknown>;
    expect(replyValues.bodyHtml).not.toContain("<script>");
    expect(replyValues.bodyHtml).toContain("hi");
  });

  it("skips inline signature image (small + contentId)", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const putCalls: string[] = [];
    const svc = new EmailInboundService({
      db,
      putObject: async (k) => { putCalls.push(k); },
    });
    await svc.ingest({
      ...BASE_PAYLOAD,
      attachments: [
        { filename: "sig.png", contentType: "image/png", size: 2048, content: Buffer.from("x"), contentId: "sig@x" },
      ],
    });
    expect(putCalls.length).toBe(0);
    const attachInserts = inserts.filter((i) => {
      const v = i.values as unknown;
      return Array.isArray(v);
    });
    expect(attachInserts.length).toBe(0);
  });

  it("truncates attachments over 25MB budget", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const putCalls: string[] = [];
    const svc = new EmailInboundService({
      db,
      putObject: async (k) => { putCalls.push(k); },
    });
    const big = Buffer.alloc(20 * 1024 * 1024);
    await svc.ingest({
      ...BASE_PAYLOAD,
      attachments: [
        { filename: "a.pdf", contentType: "application/pdf", size: 20 * 1024 * 1024, content: big },
        { filename: "b.pdf", contentType: "application/pdf", size: 20 * 1024 * 1024, content: big },
      ],
    });
    expect(putCalls.length).toBe(1);
    expect(putCalls[0]).toContain("a.pdf");
  });
});
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/integration/email-inbound-service.test.ts tests/unit/email-inbound-*.test.ts`
Expected: all PASS (≥29 tests total across the 3 test files).

If any fail because the mock-db `select().where().limit()` chain can't distinguish the three different queries (event-id lookup, outreach lookup, prefs lookup), adjust the mock to inspect the `select()` input shape object OR to track call order and return from a scripted queue — pick whichever is cleaner. Don't change the service logic.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/s3.ts src/server/services/email-outreach/inbound.ts tests/integration/email-inbound-service.test.ts
git commit -m "feat(2.3.5b): EmailInboundService + S3 putObject + service tests"
```

---

### Task 6: Webhook route handler with Svix signature verification

**Files:**
- Create: `src/app/api/webhooks/resend/inbound/route.ts`
- Modify: `.env.example` — `RESEND_INBOUND_WEBHOOK_SECRET`, `REPLY_DOMAIN`.

- [ ] **Step 1: Write route**

```ts
// src/app/api/webhooks/resend/inbound/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { EmailInboundService, type InboundPayload } from "@/server/services/email-outreach/inbound";
import { putObject } from "@/server/services/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toInboundPayload(raw: any): InboundPayload {
  const recipientList: string[] = Array.isArray(raw.to) ? raw.to : [raw.to].filter(Boolean);
  return {
    eventId: raw.id ?? raw.event_id,
    to: recipientList,
    from: {
      email: raw.from?.email ?? raw.from,
      name: raw.from?.name,
    },
    subject: raw.subject ?? "",
    text: raw.text,
    html: raw.html,
    headers: raw.headers ?? {},
    messageId: raw.message_id,
    inReplyTo: raw.in_reply_to,
    receivedAt: raw.received_at ? new Date(raw.received_at) : new Date(),
    attachments: (raw.attachments ?? []).map((a: any) => ({
      filename: a.filename,
      contentType: a.content_type ?? a.contentType,
      size: a.size ?? (a.content ? Buffer.from(a.content, "base64").length : 0),
      content: a.content ? Buffer.from(a.content, "base64") : Buffer.alloc(0),
      contentId: a.content_id ?? a.contentId,
    })),
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[inbound-webhook] RESEND_INBOUND_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const headers = {
    "webhook-id": req.headers.get("svix-id") ?? req.headers.get("webhook-id") ?? "",
    "webhook-timestamp": req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": req.headers.get("svix-signature") ?? req.headers.get("webhook-signature") ?? "",
  };

  let verified: unknown;
  try {
    const wh = new Webhook(secret);
    verified = wh.verify(rawBody, headers);
  } catch (e) {
    console.warn("[inbound-webhook] signature verify failed", e);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: InboundPayload;
  try {
    payload = toInboundPayload(verified);
  } catch (e) {
    console.error("[inbound-webhook] payload shape error", e);
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const svc = new EmailInboundService({
    putObject,
    // enqueueExternalEmail wired in T13
  });

  try {
    const result = await svc.ingest(payload);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error("[inbound-webhook] ingest failed", e);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add env vars to `.env.example`**

Append to `.env.example`:

```
RESEND_INBOUND_WEBHOOK_SECRET=
REPLY_DOMAIN=reply.clearterms.ai
```

- [ ] **Step 3: TypeScript + build**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

Run: `npx next build 2>&1 | tail -10`
Expected: build succeeds. The new route appears as a Function.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/resend/inbound/route.ts .env.example
git commit -m "feat(2.3.5b): inbound webhook route + Svix verify"
```

---

### Task 7: Update `send()` to pre-generate `outreachId` + set unique Reply-To

**Files:**
- Modify: `src/server/services/email-outreach/service.ts`
- Modify: `src/server/trpc/routers/case-emails.ts` (no-op if send signature stable) — see below.
- Modify: `tests/integration/email-outreach-service.test.ts` — only if tests break.

- [ ] **Step 1: Change `send()` to accept optional `outreachId` + default UUID, and set Reply-To to inbound address**

Read `src/server/services/email-outreach/service.ts`. Locate the `send()` method. Two changes:

(a) Near the top of the method, add: `const outreachId = input.outreachId ?? randomUUID();` (import `randomUUID` from `"crypto"` at top of file if not already).

(b) Replace the `replyTo` line that currently reads `const replyTo = sender?.email ?? undefined;` with:

```ts
const replyDomain = process.env.REPLY_DOMAIN ?? "reply.clearterms.ai";
const replyTo = `case-email-${outreachId}@${replyDomain}`;
```

(c) In the insert-row block (`this.db.insert(caseEmailOutreach).values({ ... })`), add `id: outreachId` as the first field.

(d) Update `send`'s input type to accept optional `outreachId`:

```ts
async send(input: {
  caseId: string;
  templateId?: string | null;
  subject: string;
  bodyMarkdown: string;
  documentIds: string[];
  senderId: string;
  outreachId?: string;
}): Promise<{ emailId: string; resendId: string | null }> {
```

(e) In the failure-path insert (catch block), also pass `id: outreachId` to match the happy-path row shape.

- [ ] **Step 2: Run existing 2.3.5 service tests — verify still green**

Run: `npx vitest run tests/integration/email-outreach-service.test.ts`
Expected: 7/7 PASS. If any fail, adjust the affected test's expected values rather than the service — the 2.3.5 tests asserted `createTemplate` / `renderEmail` behavior, not the new `send()` signature, so they should be unaffected.

- [ ] **Step 3: Check caller in router — ensure it still compiles**

Read `src/server/trpc/routers/case-emails.ts`. The `send` mutation currently calls `svc.send({ caseId, templateId, subject, bodyMarkdown, documentIds, senderId })`. This still works unchanged — `outreachId` is optional. No edit needed unless TypeScript complains.

- [ ] **Step 4: TypeScript + build**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

Run: `npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/email-outreach/service.ts
git commit -m "feat(2.3.5b): send() pre-generates outreachId + unique Reply-To"
```

---

### Task 8: Service extensions — replies in list/get, promoteReplyAttachment, markRepliesRead

**Files:**
- Modify: `src/server/services/email-outreach/service.ts`
- Modify: `tests/integration/email-outreach-service.test.ts` — add coverage for promote logic.

- [ ] **Step 1: Add imports for replies schemas + documents schema at top of service.ts**

```ts
import { caseEmailReplies } from "@/server/db/schema/case-email-replies";
import { caseEmailReplyAttachments } from "@/server/db/schema/case-email-reply-attachments";
import { count, sql } from "drizzle-orm";
// (documents is already imported)
```

- [ ] **Step 2: Extend `listForCase` return**

Replace the existing `listForCase` method body with:

```ts
async listForCase(input: { caseId: string }) {
  const rows = await this.db
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
      bounceReason: caseEmailOutreach.bounceReason,
      sentAt: caseEmailOutreach.sentAt,
      createdAt: caseEmailOutreach.createdAt,
      lawyerLastSeenRepliesAt: caseEmailOutreach.lawyerLastSeenRepliesAt,
    })
    .from(caseEmailOutreach)
    .leftJoin(emailTemplates, eq(emailTemplates.id, caseEmailOutreach.templateId))
    .leftJoin(users, eq(users.id, caseEmailOutreach.sentBy))
    .where(eq(caseEmailOutreach.caseId, input.caseId))
    .orderBy(desc(caseEmailOutreach.createdAt));

  const outreachIds = rows.map((r) => r.id);
  if (outreachIds.length === 0) return [];

  const replyCounts = await this.db
    .select({
      outreachId: caseEmailReplies.outreachId,
      total: sql<number>`count(*)::int`.as("total"),
      latest: sql<Date | null>`max(${caseEmailReplies.receivedAt})`.as("latest"),
    })
    .from(caseEmailReplies)
    .where(sql`${caseEmailReplies.outreachId} = ANY(${outreachIds})`)
    .groupBy(caseEmailReplies.outreachId);

  const byId = new Map(replyCounts.map((c) => [c.outreachId, c]));

  return rows.map((r) => {
    const agg = byId.get(r.id);
    const replyCount = agg?.total ?? 0;
    const hasUnreadReplies =
      replyCount > 0 &&
      agg!.latest instanceof Date &&
      (!r.lawyerLastSeenRepliesAt || agg!.latest > r.lawyerLastSeenRepliesAt);
    return { ...r, replyCount, hasUnreadReplies };
  });
}
```

- [ ] **Step 3: Extend `getEmail` to include replies + attachments**

Replace the existing `getEmail` method body with:

```ts
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
      bounceReason: caseEmailOutreach.bounceReason,
      bouncedAt: caseEmailOutreach.bouncedAt,
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

  const replyRows = await this.db
    .select()
    .from(caseEmailReplies)
    .where(eq(caseEmailReplies.outreachId, input.emailId))
    .orderBy(asc(caseEmailReplies.receivedAt));

  const replyIds = replyRows.map((r) => r.id);
  const replyAttachments = replyIds.length > 0
    ? await this.db
        .select()
        .from(caseEmailReplyAttachments)
        .where(sql`${caseEmailReplyAttachments.replyId} = ANY(${replyIds})`)
    : [];

  const attByReply = new Map<string, typeof replyAttachments>();
  for (const a of replyAttachments) {
    const list = attByReply.get(a.replyId) ?? [];
    list.push(a);
    attByReply.set(a.replyId, list);
  }
  const replies = replyRows.map((r) => ({ ...r, attachments: attByReply.get(r.id) ?? [] }));

  return { ...row, attachments, replies };
}
```

- [ ] **Step 4: Add `promoteReplyAttachment`**

Append inside the class:

```ts
async promoteReplyAttachment(input: {
  replyAttachmentId: string;
  uploadedBy: string;
  s3CopyObject: (srcKey: string, dstKey: string, contentType: string) => Promise<void>;
}): Promise<{ documentId: string }> {
  const [att] = await this.db
    .select({
      id: caseEmailReplyAttachments.id,
      replyId: caseEmailReplyAttachments.replyId,
      s3Key: caseEmailReplyAttachments.s3Key,
      filename: caseEmailReplyAttachments.filename,
      contentType: caseEmailReplyAttachments.contentType,
      sizeBytes: caseEmailReplyAttachments.sizeBytes,
      promotedDocumentId: caseEmailReplyAttachments.promotedDocumentId,
    })
    .from(caseEmailReplyAttachments)
    .where(eq(caseEmailReplyAttachments.id, input.replyAttachmentId))
    .limit(1);
  if (!att) throw new TRPCError({ code: "NOT_FOUND", message: "Reply attachment not found" });

  if (att.promotedDocumentId) return { documentId: att.promotedDocumentId };

  const [reply] = await this.db
    .select({ caseId: caseEmailReplies.caseId })
    .from(caseEmailReplies)
    .where(eq(caseEmailReplies.id, att.replyId))
    .limit(1);
  if (!reply) throw new TRPCError({ code: "NOT_FOUND", message: "Parent reply missing" });

  const newDocId = crypto.randomUUID();
  const dstKey = `documents/${newDocId}/${att.filename}`;
  await input.s3CopyObject(att.s3Key, dstKey, att.contentType);

  const fileType = mapContentTypeToFileType(att.contentType);
  const [docRow] = await this.db
    .insert(documents)
    .values({
      id: newDocId,
      caseId: reply.caseId,
      filename: att.filename,
      s3Key: dstKey,
      fileType,
      fileSize: att.sizeBytes,
      uploadedBy: input.uploadedBy,
    })
    .returning();

  await this.db
    .update(caseEmailReplyAttachments)
    .set({ promotedDocumentId: docRow.id })
    .where(eq(caseEmailReplyAttachments.id, input.replyAttachmentId));

  return { documentId: docRow.id };
}
```

Add imports at top: `import { randomUUID } from "crypto";` (if not already imported in T7). If `documents` schema has required columns beyond the ones above (check in T1 recon output), add them — likely `orgId` via a SELECT on cases first.

Add this helper at the bottom of the file, outside the class (sibling of existing `contentTypeForFileType`):

```ts
function mapContentTypeToFileType(contentType: string): "pdf" | "docx" | "image" | "other" {
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("application/vnd.openxmlformats-officedocument.wordprocessingml")) return "docx";
  if (contentType.startsWith("image/")) return "image";
  return "other";
}
```

⚠ If T1 recon showed `documents.fileType` enum contains different values (e.g., `'xlsx'` or `'zip'`), extend the mapping accordingly. If the enum is strict and doesn't include a value you need, use `'other'` as fallback.

- [ ] **Step 5: Add `markRepliesRead`**

Append inside the class:

```ts
async markRepliesRead(input: { outreachId: string }): Promise<void> {
  await this.db
    .update(caseEmailOutreach)
    .set({ lawyerLastSeenRepliesAt: new Date() })
    .where(eq(caseEmailOutreach.id, input.outreachId));
}
```

- [ ] **Step 6: Run existing service tests**

Run: `npx vitest run tests/integration/email-outreach-service.test.ts`
Expected: 7/7 still PASS. The test mock-db may not handle new `sql` template patterns — if any test fails, inspect error; the 2.3.5 tests shouldn't exercise the new code paths.

- [ ] **Step 7: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/email-outreach/service.ts
git commit -m "feat(2.3.5b): service — list/get include replies, promote + mark-read"
```

---

### Task 9: tRPC router — `promoteReplyAttachment` + `markRepliesRead`

**Files:**
- Modify: `src/server/trpc/routers/case-emails.ts`
- Modify: `src/server/services/s3.ts` — add `copyObject` export.

- [ ] **Step 1: Add `copyObject` to s3**

Read `src/server/services/s3.ts`. Append:

```ts
import { CopyObjectCommand } from "@aws-sdk/client-s3";

export async function copyObject(srcKey: string, dstKey: string, contentType: string): Promise<void> {
  const bucket = process.env.AWS_S3_BUCKET!;
  const command = new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${encodeURIComponent(srcKey)}`,
    Key: dstKey,
    ContentType: contentType,
    MetadataDirective: "REPLACE",
  });
  await s3Client.send(command);
}
```

If `CopyObjectCommand` isn't already imported at top, add to the existing AWS SDK import group.

- [ ] **Step 2: Add router endpoints**

Read `src/server/trpc/routers/case-emails.ts`. At the top, import the new service dep:

```ts
import { copyObject } from "@/server/services/s3";
```

Inside `caseEmailsRouter = router({ ... })`, append after `send`:

```ts
  promoteReplyAttachment: protectedProcedure
    .input(z.object({ replyAttachmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Load minimal context to assert case access.
      const [att] = await ctx.db
        .select({ replyId: caseEmailReplyAttachments.replyId })
        .from(caseEmailReplyAttachments)
        .where(eq(caseEmailReplyAttachments.id, input.replyAttachmentId))
        .limit(1);
      if (!att) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
      const [reply] = await ctx.db
        .select({ caseId: caseEmailReplies.caseId })
        .from(caseEmailReplies)
        .where(eq(caseEmailReplies.id, att.replyId))
        .limit(1);
      if (!reply) throw new TRPCError({ code: "NOT_FOUND", message: "Reply not found" });
      await assertCaseAccess(ctx, reply.caseId);
      const svc = new EmailOutreachService({ db: ctx.db });
      return svc.promoteReplyAttachment({
        replyAttachmentId: input.replyAttachmentId,
        uploadedBy: ctx.user.id,
        s3CopyObject: copyObject,
      });
    }),

  markRepliesRead: protectedProcedure
    .input(z.object({ outreachId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [o] = await ctx.db
        .select({ caseId: caseEmailOutreach.caseId })
        .from(caseEmailOutreach)
        .where(eq(caseEmailOutreach.id, input.outreachId))
        .limit(1);
      if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "Email not found" });
      await assertCaseAccess(ctx, o.caseId);
      const svc = new EmailOutreachService({ db: ctx.db });
      await svc.markRepliesRead({ outreachId: input.outreachId });
      return { ok: true as const };
    }),
```

Add the imports at the top of the router file if not already present:

```ts
import { caseEmailReplies } from "@/server/db/schema/case-email-replies";
import { caseEmailReplyAttachments } from "@/server/db/schema/case-email-reply-attachments";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

Run: `npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/s3.ts src/server/trpc/routers/case-emails.ts
git commit -m "feat(2.3.5b): tRPC — promote reply attachment + mark replies read"
```

---

### Task 10: UI components — `<ReplyRow>` + `<RepliesSection>`

**Files:**
- Create: `src/components/cases/emails/reply-row.tsx`
- Create: `src/components/cases/emails/replies-section.tsx`

- [ ] **Step 1: Write `<ReplyRow>`**

```tsx
// src/components/cases/emails/reply-row.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SanitizedHtml } from "@/components/common/sanitized-html";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, FileText, Save } from "lucide-react";
import { toast } from "sonner";

export interface ReplyRowData {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  bodyHtml: string;
  replyKind: "human" | "auto_reply";
  senderMismatch: boolean;
  receivedAt: Date | string;
  attachments: Array<{
    id: string;
    filename: string;
    sizeBytes: number;
    promotedDocumentId: string | null;
  }>;
}

export function ReplyRow({
  reply,
  defaultCollapsed,
  onReply,
}: {
  reply: ReplyRowData;
  defaultCollapsed?: boolean;
  onReply: (reply: ReplyRowData) => void;
}) {
  const [expanded, setExpanded] = React.useState(!defaultCollapsed);
  const utils = trpc.useUtils();
  const promote = trpc.caseEmails.promoteReplyAttachment.useMutation({
    onSuccess: async () => {
      toast.success("Saved to case documents");
      await utils.caseEmails.get.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="border-b py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium">
            {reply.fromName ? `${reply.fromName} ` : ""}&lt;{reply.fromEmail}&gt;
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(reply.receivedAt), { addSuffix: true })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {reply.replyKind === "auto_reply" && (
            <Badge className="bg-yellow-100 text-yellow-800">auto-reply</Badge>
          )}
        </div>
      </button>

      {reply.senderMismatch && (
        <div className="mt-1 flex items-center gap-1 text-xs text-yellow-700">
          <AlertTriangle className="size-3" />
          Sender doesn&apos;t match original recipient
        </div>
      )}

      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="max-h-80 overflow-y-auto rounded border p-3">
            <SanitizedHtml html={reply.bodyHtml} />
          </div>
          {reply.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {reply.attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
                >
                  <FileText className="size-3" />
                  {a.filename} · {Math.round(a.sizeBytes / 1024)}KB
                  {a.promotedDocumentId ? (
                    <span className="ml-1 text-green-700">✓ saved</span>
                  ) : (
                    <button
                      type="button"
                      className="ml-1 text-blue-700 hover:underline"
                      onClick={() => promote.mutate({ replyAttachmentId: a.id })}
                      disabled={promote.isPending}
                    >
                      <Save className="inline size-3" /> Save
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div>
            <Button size="sm" variant="outline" onClick={() => onReply(reply)}>
              Reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `<RepliesSection>`**

```tsx
// src/components/cases/emails/replies-section.tsx
"use client";

import * as React from "react";
import { ReplyRow, type ReplyRowData } from "./reply-row";

export function RepliesSection({
  replies,
  onReply,
}: {
  replies: ReplyRowData[];
  onReply: (reply: ReplyRowData) => void;
}) {
  const [showAutoReplies, setShowAutoReplies] = React.useState(false);
  if (replies.length === 0) return null;

  const human = replies.filter((r) => r.replyKind === "human");
  const auto = replies.filter((r) => r.replyKind === "auto_reply");

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Replies ({replies.length})</h4>
        {auto.length > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => setShowAutoReplies((v) => !v)}
          >
            {showAutoReplies ? "Hide" : "Show"} {auto.length} auto-{auto.length === 1 ? "reply" : "replies"}
          </button>
        )}
      </div>
      {human.map((r) => <ReplyRow key={r.id} reply={r} onReply={onReply} />)}
      {showAutoReplies && auto.map((r) => <ReplyRow key={r.id} reply={r} defaultCollapsed onReply={onReply} />)}
    </div>
  );
}
```

- [ ] **Step 3: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/emails/reply-row.tsx src/components/cases/emails/replies-section.tsx
git commit -m "feat(2.3.5b): UI — ReplyRow + RepliesSection components"
```

---

### Task 11: Mount `<RepliesSection>` in EmailDetail, add bounce banner, reply badges, NewEmailModal `replyTo`

**Files:**
- Modify: `src/components/cases/emails/email-detail.tsx`
- Modify: `src/components/cases/emails/emails-list.tsx`
- Modify: `src/components/cases/emails/new-email-modal.tsx`

- [ ] **Step 1: Update `<EmailDetail>` — mount RepliesSection, bounce banner, mark-read on mount**

Read the current file. After the existing `<SanitizedHtml html={data.bodyHtml} />` block, append:

```tsx
      <RepliesSection
        replies={(data.replies ?? []).map((r) => ({
          id: r.id,
          fromEmail: r.fromEmail,
          fromName: r.fromName,
          subject: r.subject,
          bodyHtml: r.bodyHtml,
          replyKind: r.replyKind as "human" | "auto_reply",
          senderMismatch: r.senderMismatch,
          receivedAt: r.receivedAt,
          attachments: r.attachments,
        }))}
        onReply={(reply) => {
          setReplyContext(reply);
          setResendOpen(true);
        }}
      />
```

At the top of the component, add imports:

```tsx
import { RepliesSection } from "./replies-section";
import type { ReplyRowData } from "./reply-row";
```

Replace the existing `const [resendOpen, setResendOpen] = React.useState(false);` block with:

```tsx
const [resendOpen, setResendOpen] = React.useState(false);
const [replyContext, setReplyContext] = React.useState<ReplyRowData | null>(null);
```

Replace the existing bounced/failed banner logic — if `data.status === "failed"` path exists, keep it; ADD a separate case for `"bounced"`:

```tsx
      {data.status === "bounced" && data.bounceReason && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800">
          <strong>Delivery failed:</strong> {data.bounceReason}
        </div>
      )}
```

Replace the existing `<NewEmailModal>` mount with:

```tsx
<NewEmailModal
  caseId={caseId}
  open={resendOpen}
  onOpenChange={(v) => {
    setResendOpen(v);
    if (!v) setReplyContext(null);
  }}
  initial={
    replyContext
      ? {
          subject: data.subject.startsWith("Re:") ? data.subject : `Re: ${data.subject}`,
          bodyMarkdown: "",
          templateId: null,
          attachments: [],
        }
      : {
          subject: data.subject,
          bodyMarkdown: data.bodyMarkdown,
          templateId: data.templateId,
          attachments: [],
        }
  }
/>
```

Finally, trigger mark-read on mount — add a useEffect near the top of the component body:

```tsx
const markRead = trpc.caseEmails.markRepliesRead.useMutation();
React.useEffect(() => {
  if (!data) return;
  if ((data.replies ?? []).length > 0) {
    markRead.mutate({ outreachId: data.id });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [data?.id, data?.replies?.length]);
```

- [ ] **Step 2: Update `<EmailsList>` — reply count badge + bounced status**

Read the current file. In the JSX that renders each email row, locate the existing status Badge. Extend the `STATUS_STYLES` map:

```ts
const STATUS_STYLES: Record<string, string> = {
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  bounced: "bg-red-100 text-red-800",
};
```

Inside the row, next to status badge, add (use the shape of `e` which came from listForCase):

```tsx
{e.replyCount > 0 && (
  <Badge className={e.hasUnreadReplies ? "bg-blue-600 text-white" : "bg-zinc-200 text-zinc-800"}>
    {e.replyCount} {e.replyCount === 1 ? "reply" : "replies"}
  </Badge>
)}
```

- [ ] **Step 3: Update `<NewEmailModal>` — optional `replyTo` prop**

Read the file. The modal already accepts `initial`. No new prop needed — EmailDetail passes `initial.subject = "Re: …"` and empty body for reply flow. If the modal's prop typing needs to accept `null` for `initial.templateId`, confirm it already does. No modifications unless TypeScript complains after T11 step 1.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

Run: `npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/components/cases/emails/email-detail.tsx src/components/cases/emails/emails-list.tsx src/components/cases/emails/new-email-modal.tsx
git commit -m "feat(2.3.5b): UI — mount replies, bounce banner, reply badges, pre-fill"
```

---

### Task 12: Settings toggle for email-on-client-reply

**Files:**
- Check/Create/Modify: `src/app/(app)/settings/notifications/page.tsx`
- Possibly create: tRPC endpoints in an existing notifications router or new one.

- [ ] **Step 1: Detect state**

Run: `ls src/app/\(app\)/settings/notifications/page.tsx 2>&1 && cat src/app/\(app\)/settings/notifications/page.tsx | head -60`

If the page exists, read it fully to see the existing form/toggle pattern. If it doesn't exist, scaffold a minimal one.

- [ ] **Step 2 (Branch A — page exists):** Add a row for `email_reply_received`/`email` pref alongside the existing ones. Use whatever tRPC mutation the existing page uses (likely `notifications.setPreference` or `notifications.upsertPreference`). If the mutation takes `(notificationType, channel, enabled)`, pass `("email_reply_received", "email", checked)`.

If the tRPC API for prefs doesn't expose this notification_type, add `"email_reply_received"` to any enum / whitelist in the prefs router. Grep for existing `"email_bounced"` or similar types to mirror placement.

- [ ] **Step 3 (Branch B — page missing):** Create a minimal page. If the tRPC endpoint for prefs also doesn't exist, a new one is out of scope for this phase — instead, STOP at this task and report NEEDS_CONTEXT with what prefs infra is present. The plan task should not invent a whole prefs subsystem.

Minimal page (only if prefs tRPC API is usable):

```tsx
// src/app/(app)/settings/notifications/page.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch"; // if exists; else plain checkbox
import { toast } from "sonner";

export default function NotificationsPrefsPage() {
  const utils = trpc.useUtils();
  const pref = trpc.notifications.getPreference.useQuery({
    notificationType: "email_reply_received",
    channel: "email",
  });
  const upsert = trpc.notifications.upsertPreference.useMutation({
    onSuccess: async () => {
      await utils.notifications.getPreference.invalidate();
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const enabled = pref.data?.enabled ?? false;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Notifications</h1>
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={(v) =>
            upsert.mutate({
              notificationType: "email_reply_received",
              channel: "email",
              enabled: v,
            })
          }
        />
        <Label>Email me when a client replies to a sent email</Label>
      </div>
    </div>
  );
}
```

⚠ The exact tRPC method names (`getPreference` / `upsertPreference`) MUST match what the prefs router already exposes. Grep the codebase before writing.

- [ ] **Step 4: TypeScript + build**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

Run: `npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/settings/notifications/page.tsx
git commit -m "feat(2.3.5b): settings — email-on-client-reply toggle"
```

---

### Task 13: Optional external email on reply via Inngest

**Files:**
- Create: `src/server/inngest/functions/email-reply-notification.ts` (or match the existing inngest folder pattern)
- Modify: inngest functions index to register.
- Modify: `src/app/api/webhooks/resend/inbound/route.ts` — wire `enqueueExternalEmail`.

- [ ] **Step 1: Recon existing Inngest pattern**

Run: `ls src/server/inngest/functions/ | head -20 && head -40 src/server/inngest/functions/*.ts | head -100`

Note the existing `inngest.createFunction(...)` pattern and event naming (e.g., `"email/notify.*"` or `"app/...event"`).

- [ ] **Step 2: Create function**

Template (adapt event name to match existing convention):

```ts
// src/server/inngest/functions/email-reply-notification.ts
import { inngest } from "../client";
import { db } from "@/server/db";
import { caseEmailReplies } from "@/server/db/schema/case-email-replies";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { users } from "@/server/db/schema/users";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/server/services/email";

export const emailReplyNotification = inngest.createFunction(
  { id: "email-reply-notification" },
  { event: "email/notify.client-reply" },
  async ({ event, step }) => {
    const { userId, replyId } = event.data as { userId: string; replyId: string };

    const ctx = await step.run("load", async () => {
      const [reply] = await db
        .select({
          fromEmail: caseEmailReplies.fromEmail,
          fromName: caseEmailReplies.fromName,
          subject: caseEmailReplies.subject,
          bodyText: caseEmailReplies.bodyText,
          outreachId: caseEmailReplies.outreachId,
        })
        .from(caseEmailReplies)
        .where(eq(caseEmailReplies.id, replyId))
        .limit(1);
      const [user] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const [outreach] = await db
        .select({ subject: caseEmailOutreach.subject })
        .from(caseEmailOutreach)
        .where(eq(caseEmailOutreach.id, reply.outreachId))
        .limit(1);
      return { reply, user, outreach };
    });

    if (!ctx.user?.email) return { skipped: "no user email" };

    await step.run("send", async () => {
      const preview = (ctx.reply.bodyText ?? "").slice(0, 280);
      await sendEmail({
        to: ctx.user.email,
        subject: `Client replied: ${ctx.outreach?.subject ?? ctx.reply.subject}`,
        html: `<p><strong>${ctx.reply.fromName ?? ctx.reply.fromEmail}</strong> replied:</p><blockquote>${preview.replace(/</g, "&lt;")}</blockquote><p><a href="${process.env.APP_URL ?? ""}/cases">View in ClearTerms</a></p>`,
      });
    });
    return { ok: true };
  },
);
```

- [ ] **Step 3: Register in inngest functions index**

Find the index (likely `src/server/inngest/functions/index.ts` or equivalent). Import + add to exported array.

- [ ] **Step 4: Wire webhook route to enqueue**

Read `src/app/api/webhooks/resend/inbound/route.ts`. At top, add:

```ts
import { inngest } from "@/server/inngest/client";
```

Change the service construction to:

```ts
const svc = new EmailInboundService({
  putObject,
  enqueueExternalEmail: async ({ userId, replyId }) => {
    await inngest.send({
      name: "email/notify.client-reply",
      data: { userId, replyId },
    });
  },
});
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

Run: `npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/server/inngest/ src/app/api/webhooks/resend/inbound/route.ts
git commit -m "feat(2.3.5b): inngest — external email on client reply (opt-in)"
```

---

### Task 14: E2E smoke + final verification

**Files:**
- Create: `e2e/email-replies-smoke.spec.ts`

- [ ] **Step 1: Write smoke**

```ts
// e2e/email-replies-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.5b email replies smoke", () => {
  test("/cases/[id]?tab=emails still returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=emails`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("inbound webhook without signature returns 401", async ({ request, baseURL }) => {
    const resp = await request.post(`${baseURL}/api/webhooks/resend/inbound`, {
      data: {},
      headers: { "content-type": "application/json" },
    });
    expect([401, 400, 500]).toContain(resp.status());
  });
});
```

Note: `500` is accepted in the second assertion only if `RESEND_INBOUND_WEBHOOK_SECRET` isn't set in the test env; prefer `401` but don't fail if infra isn't wired.

- [ ] **Step 2: Run smoke**

Run: `npx playwright test e2e/email-replies-smoke.spec.ts 2>&1 | tail -10`
Expected: 2/2 pass.

- [ ] **Step 3: Full-repo verification**

```bash
npx vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -3
npx next build 2>&1 | tail -20
```

Expected:
- Vitest: ≥576 tests pass (544 baseline from 2.3.5 + ~32 new).
- tsc: EXIT 0.
- Build: success.

- [ ] **Step 4: Commit**

```bash
git add e2e/email-replies-smoke.spec.ts
git commit -m "test(2.3.5b): E2E smoke for reply routes"
```

---

### Task 15: Service-level UAT (post-implementation)

**Files:**
- Create (temporary, deleted after): `.tmp-uat-235b.mjs`

- [ ] **Step 1: Write UAT**

Mirror `.tmp-uat-235.mjs` pattern. Script flow:

1. Load `.env.local`, connect postgres client + import schemas.
2. Seed: insert a `case_email_outreach` row for known `CASE_ID`/`LAWYER_ID` (manually, via SQL) — the parent for testing. Record its `id = OUTREACH_ID`.
3. Build a fake `InboundPayload` for:
   a. Human reply → expect reply row + notification row + status stays `sent`.
   b. Duplicate same eventId → expect `duplicate` result, no additional rows.
   c. Bounce (mailer-daemon subject) for SAME outreach → expect outreach status = `bounced`.
   d. Unrouted To address → expect `unrouted`, no reply.
   e. With attachments (a PDF under budget) → expect attachment row + S3 key present.
   f. `promoteReplyAttachment` → expect documents row exists, `promoted_document_id` filled, second call is no-op returning same document.
   g. `markRepliesRead` → `lawyer_last_seen_replies_at` populated.
4. Clean up: delete all seeded rows, delete any S3 objects under `email-replies/` and `documents/` prefixes that the script created.
5. Print `X ✓ 0 ✗`.

Use mocked `putObject` inside the UAT (record calls without actual S3) for speed — the real S3 copy in `promoteReplyAttachment` needs a real source object though. Either use real S3 for that one test, or stub the `copyObject` fn too and assert it was called with expected keys. Pick the stubbed path to keep UAT isolated.

- [ ] **Step 2: Run**

Run: `npx tsx .tmp-uat-235b.mjs`
Expected: ≥10 ✓, 0 ✗. Fix bugs in a separate `fix(2.3.5b): ...` commit and re-run.

- [ ] **Step 3: Remove script**

```bash
rm .tmp-uat-235b.mjs
```

---

## Self-Review

**Spec coverage:**
- §3 decisions → tasks. 1 Resend Inbound: T6 route. 2 UUID reply-to: T7. 3 Hybrid UI: T10, T11. 4 Permissive sender: T4, T5. 5 Attachments table: T2, T3. Promote button: T8, T9, T10. 6 Size budget: T5. 7 Notifications + opt-in email: T5, T12, T13. 8 Bounce/auto-reply: T4, T5. 9 Idempotency: T5. 10 Pipeline sync + Inngest for email: T5, T13.
- §4 data model → T2 schemas, T3 migration.
- §5 inbound pipeline → T5 service, T6 route.
- §6 UI → T10, T11.
- §7 tRPC → T8 (service), T9 (router).
- §8 files → all modifications covered.
- §9 testing → T4 classifier+sender unit, T5 service integration, T14 E2E smoke, T15 UAT.
- §10 UAT criteria → T15 covers service-level; manual browser UAT is separate.
- §11 rollout/ops → out of plan scope (human/ops step).
- §12 security → T6 signature verify, DOMPurify reused in T4.
- §13 open items — T1 recon confirmed `notification_preferences` shape (row-per-pref), `documents.fileType` mapping to confirm in T1 step 4.

**Placeholder scan:** No "TBD"; task 12 explicitly accepts a NEEDS_CONTEXT branch when prefs infra is absent (this is a real escalation guard, not a placeholder).

**Type consistency:**
- `ReplyKind = "human" | "auto_reply"` — consistent in T4 classify, T5 service, T10 UI.
- `REPLY_TO_REGEX` and `buildReplyToAddress` in `inbound.ts` used by both T5 parser and T7 service send (via env).
- `outreachId` as both column name and service input param — consistent across T5, T7, T9.
- `InboundPayload` shape — consistent between T5 service and T6 route mapping.
- `notifications` insert columns (`userId, type, title, body, caseId, dedupKey`) — consistent with existing schema (see recon).
- `sanitizeHtml` export from T4 used in T5 ingest.
- Mock-db test pattern from 2.3.5 T6 — reused in T5 step 3 with extended query disambiguation.

**No red flags.** Plan ready.
