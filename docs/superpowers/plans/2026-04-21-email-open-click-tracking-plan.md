# 2.3.5c Email Open/Click Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-email opt-in tracking of `delivered`, `opened`, `clicked`, and `complained` Resend events for outbound emails sent via 2.3.5, with hybrid storage (audit-log + denormalized counters) and minimal UI surfacing.

**Architecture:** NewEmailModal adds a tracking toggle (default OFF). When enabled, `send()` passes `track_opens: true, track_clicks: true` to Resend and marks the outreach row `trackingEnabled=true`. A new `POST /api/webhooks/resend/events` route verifies Svix signature, looks up outreach by `resend_id`, INSERTs into `case_email_outreach_events` audit log, and atomically UPDATEs denormalized counters on the outreach row. UI: inline 👁/🖱 counts on list rows, one summary line on detail, red complained banner.

**Tech Stack:** Next.js 16 App Router (Node runtime for webhook), Drizzle ORM, tRPC v11, Zod v4, Resend SDK native `track_opens`/`track_clicks` flags + Resend events webhook, `standardwebhooks` (reused from 2.3.5b), Vitest mock-db pattern, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-21-email-open-click-tracking-design.md`

**Branch:** `feature/2.3.5c-email-open-click-tracking` (already created, spec committed at `aec4a91`).

**Key existing files (recon, trust these):**

- `src/server/services/email.ts` — `sendEmail({to, subject, html, attachments?, replyTo?})` from 2.3.5. Extended here with `trackOpens?`, `trackClicks?`.
- `src/server/services/email-outreach/service.ts` — `send()` method accepts `outreachId?`, sets Reply-To (2.3.5b). This phase adds `trackingEnabled?` input + forwards it.
- `src/server/db/schema/case-email-outreach.ts` — already has `bounceReason`, `bouncedAt`, `lawyerLastSeenRepliesAt` from 2.3.5b. We add 9 more columns.
- `src/app/api/webhooks/resend/inbound/route.ts` (2.3.5b) — pattern for Svix signature verification to mirror for events route.
- `src/lib/notification-types.ts` + `src/components/notifications/notification-preferences-matrix.tsx` — notification type whitelist from 2.3.5b; we add `email_complained`.

**Known dev DB IDs (from 2.3.5 UAT):**
- `CASE_ID = "61e9c86a-4359-49cd-8d59-fdf894e11030"` (Acme Corp)
- `LAWYER_ID = "a480a3b1-b88b-4c94-96f6-0f9249673bb8"`
- `ORG_ID = "a28431e2-dc02-41ba-8b55-6d053e4ede4a"`

---

## File Structure

**Create:**
- `src/server/db/schema/case-email-outreach-events.ts`
- `src/server/db/migrations/0018_email_tracking.sql`
- `src/server/services/email-outreach/events-ingest.ts` — pure `EmailEventsIngestService`
- `src/app/api/webhooks/resend/events/route.ts`
- `tests/unit/email-events-ingest.test.ts`
- `e2e/email-tracking-smoke.spec.ts`

**Modify:**
- `src/server/db/schema/case-email-outreach.ts` — add 9 columns.
- `src/server/services/email.ts` — extend `SendEmailOptions` with `trackOpens?`, `trackClicks?`.
- `src/server/services/email-outreach/service.ts` — `send()` accepts + forwards `trackingEnabled`; `listForCase` and `getEmail` select new columns; insert sets `trackingEnabled`.
- `src/server/trpc/routers/case-emails.ts` — `send` input schema adds `trackingEnabled?`.
- `src/components/cases/emails/new-email-modal.tsx` — toggle + state + mutation arg.
- `src/components/cases/emails/emails-list.tsx` — 👁/🖱 badges.
- `src/components/cases/emails/email-detail.tsx` — summary line + complained banner.
- `src/lib/notification-types.ts` — add `email_complained`.
- `src/components/notifications/notification-preferences-matrix.tsx` — label.
- `.env.local.example` — `RESEND_EVENTS_WEBHOOK_SECRET`.

**Not touched:** 2.3.5b inbound route (still distinct endpoint), portal UI, sidebar.

---

### Task 1: Schema + migration + apply to dev DB

**Files:**
- Create: `src/server/db/schema/case-email-outreach-events.ts`
- Modify: `src/server/db/schema/case-email-outreach.ts`
- Create: `src/server/db/migrations/0018_email_tracking.sql`

- [ ] **Step 1: Write events schema file**

```ts
// src/server/db/schema/case-email-outreach-events.ts
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseEmailOutreach } from "./case-email-outreach";

export const caseEmailOutreachEvents = pgTable(
  "case_email_outreach_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outreachId: uuid("outreach_id").references(() => caseEmailOutreach.id, { onDelete: "cascade" }).notNull(),
    eventType: text("event_type").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata"),
    resendEventId: text("resend_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("case_email_outreach_events_event_id_unique").on(table.resendEventId),
    index("case_email_outreach_events_outreach_event_idx").on(table.outreachId, table.eventAt),
    check(
      "case_email_outreach_events_type_check",
      sql`${table.eventType} IN ('delivered','opened','clicked','complained')`,
    ),
  ],
);

export type CaseEmailOutreachEvent = typeof caseEmailOutreachEvents.$inferSelect;
export type NewCaseEmailOutreachEvent = typeof caseEmailOutreachEvents.$inferInsert;
```

- [ ] **Step 2: Modify `case-email-outreach.ts`**

Read `src/server/db/schema/case-email-outreach.ts`. After the `lawyerLastSeenRepliesAt` column (added in 2.3.5b), append:

```ts
    trackingEnabled: boolean("tracking_enabled").notNull().default(false),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    firstClickedAt: timestamp("first_clicked_at", { withTimezone: true }),
    lastClickedAt: timestamp("last_clicked_at", { withTimezone: true }),
    clickCount: integer("click_count").notNull().default(0),
    complainedAt: timestamp("complained_at", { withTimezone: true }),
```

Ensure `boolean` and `integer` are imported at the top of the file (add to the `from "drizzle-orm/pg-core"` import if missing).

- [ ] **Step 3: Write migration 0018**

```sql
-- 0018_email_tracking.sql
-- Phase 2.3.5c: open/click/delivered/complained tracking.

CREATE TABLE "case_email_outreach_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outreach_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "event_at" timestamp with time zone NOT NULL,
  "metadata" jsonb,
  "resend_event_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_email_outreach_events_type_check" CHECK ("event_type" IN ('delivered','opened','clicked','complained'))
);

ALTER TABLE "case_email_outreach_events"
  ADD CONSTRAINT "case_email_outreach_events_outreach_id_fk" FOREIGN KEY ("outreach_id") REFERENCES "public"."case_email_outreach"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "case_email_outreach_events_event_id_unique" ON "case_email_outreach_events" USING btree ("resend_event_id");
CREATE INDEX "case_email_outreach_events_outreach_event_idx" ON "case_email_outreach_events" USING btree ("outreach_id","event_at");

ALTER TABLE "case_email_outreach"
  ADD COLUMN "tracking_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "delivered_at" timestamp with time zone,
  ADD COLUMN "first_opened_at" timestamp with time zone,
  ADD COLUMN "last_opened_at" timestamp with time zone,
  ADD COLUMN "open_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "first_clicked_at" timestamp with time zone,
  ADD COLUMN "last_clicked_at" timestamp with time zone,
  ADD COLUMN "click_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "complained_at" timestamp with time zone;
```

- [ ] **Step 4: Apply to dev DB**

Same Node one-liner pattern as 2.3.5 T3 / 2.3.5b T3. After apply verify:

```
SELECT COUNT(*) FROM case_email_outreach_events;
SELECT tracking_enabled, open_count, click_count FROM case_email_outreach LIMIT 1;
```

Expected: `events: 0 | outreach columns: tracking_enabled=false, open_count=0, click_count=0 on existing rows`.

- [ ] **Step 5: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema/case-email-outreach-events.ts src/server/db/schema/case-email-outreach.ts src/server/db/migrations/0018_email_tracking.sql
git commit -m "feat(2.3.5c): schema + migration 0018 — tracking columns + events table"
```

---

### Task 2: Extend `sendEmail` helper with `trackOpens` + `trackClicks`

**Files:**
- Modify: `src/server/services/email.ts`

- [ ] **Step 1: Read current file**

Current `sendEmail` (from 2.3.5 T4) accepts `{to, subject, html, attachments?, replyTo?}`. Extend additively.

- [ ] **Step 2: Update interface + body**

Replace `SendEmailOptions` interface + `sendEmail` body. Keep existing `from:` line (preserve exact expression).

```ts
export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
  replyTo?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
}

export async function sendEmail({
  to,
  subject,
  html,
  attachments,
  replyTo,
  trackOpens,
  trackClicks,
}: SendEmailOptions) {
  // ... existing RESEND_API_KEY guard + from: line ...
  await resend.emails.send({
    from: FROM,  // KEEP THE EXISTING EXPRESSION UNCHANGED
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
    ...(trackOpens !== undefined ? { track_opens: trackOpens } : {}),
    ...(trackClicks !== undefined ? { track_clicks: trackClicks } : {}),
  } as Parameters<typeof resend.emails.send>[0]);
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/email.ts
git commit -m "feat(2.3.5c): sendEmail — trackOpens + trackClicks"
```

---

### Task 3: `send()` accepts `trackingEnabled`; router passes it through

**Files:**
- Modify: `src/server/services/email-outreach/service.ts`
- Modify: `src/server/trpc/routers/case-emails.ts`

- [ ] **Step 1: Extend `send()` input type**

Read the method. Add one field:

```ts
async send(input: {
  caseId: string;
  templateId?: string | null;
  subject: string;
  bodyMarkdown: string;
  documentIds: string[];
  senderId: string;
  outreachId?: string;
  trackingEnabled?: boolean;
}): Promise<{ emailId: string; resendId: string | null }> {
```

- [ ] **Step 2: Forward tracking flags to `resendSend`**

Locate the `resendSend({to, subject, html, attachments, replyTo})` call. Extend:

```ts
const resendRes = await this.resendSend({
  to: recipient.email,
  subject: rendered.subject,
  html: rendered.bodyHtml,
  attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined,
  replyTo,
  trackOpens: input.trackingEnabled ?? false,
  trackClicks: input.trackingEnabled ?? false,
});
```

Update the `resendSend` dep signature to accept them:

```ts
export interface EmailOutreachServiceDeps {
  db?: typeof defaultDb;
  resendSend?: (opts: {
    to: string;
    subject: string;
    html: string;
    attachments?: any[];
    replyTo?: string;
    trackOpens?: boolean;
    trackClicks?: boolean;
  }) => Promise<{ id?: string }>;
  fetchObject?: (s3Key: string) => Promise<Buffer>;
}
```

- [ ] **Step 3: Persist `trackingEnabled` on the outreach row**

In the happy-path insert block, add `trackingEnabled: input.trackingEnabled ?? false` among the values. In the failure-path insert, add the same.

- [ ] **Step 4: Update router input schema + adapter**

Read `src/server/trpc/routers/case-emails.ts`. In the `send` mutation:

Extend the `input` Zod schema:

```ts
.input(z.object({
  caseId: z.string().uuid(),
  templateId: z.string().uuid().nullable().optional(),
  subject: z.string().trim().min(1).max(500),
  bodyMarkdown: z.string().min(1).max(50_000),
  documentIds: z.array(z.string().uuid()).max(20),
  trackingEnabled: z.boolean().optional(),
}))
```

Extend the `resendSendAdapter` to forward `trackOpens`/`trackClicks`:

```ts
async function resendSendAdapter(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: any[];
  replyTo?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
}): Promise<{ id?: string }> {
  await sendEmail({
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
    replyTo: opts.replyTo,
    trackOpens: opts.trackOpens,
    trackClicks: opts.trackClicks,
  });
  return { id: undefined };
}
```

Pass `trackingEnabled` from input to `svc.send`:

```ts
return svc.send({
  caseId: input.caseId,
  templateId: input.templateId ?? null,
  subject: input.subject,
  bodyMarkdown: input.bodyMarkdown,
  documentIds: input.documentIds,
  senderId: ctx.user.id,
  trackingEnabled: input.trackingEnabled ?? false,
});
```

- [ ] **Step 5: Select new columns in `listForCase` and `getEmail`**

In the big select map in `listForCase`, add:

```ts
trackingEnabled: caseEmailOutreach.trackingEnabled,
openCount: caseEmailOutreach.openCount,
clickCount: caseEmailOutreach.clickCount,
complainedAt: caseEmailOutreach.complainedAt,
```

In `getEmail`, add the full set:

```ts
trackingEnabled: caseEmailOutreach.trackingEnabled,
deliveredAt: caseEmailOutreach.deliveredAt,
firstOpenedAt: caseEmailOutreach.firstOpenedAt,
lastOpenedAt: caseEmailOutreach.lastOpenedAt,
openCount: caseEmailOutreach.openCount,
firstClickedAt: caseEmailOutreach.firstClickedAt,
lastClickedAt: caseEmailOutreach.lastClickedAt,
clickCount: caseEmailOutreach.clickCount,
complainedAt: caseEmailOutreach.complainedAt,
```

- [ ] **Step 6: Run existing service tests**

Run: `npx vitest run tests/integration/email-outreach-service.test.ts`
Expected: 7/7 still PASS.

- [ ] **Step 7: TypeScript + build**

Run: `npx tsc --noEmit` → EXIT 0.
Run: `npx next build 2>&1 | tail -5` → success.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/email-outreach/service.ts src/server/trpc/routers/case-emails.ts
git commit -m "feat(2.3.5c): send() forwards trackingEnabled; list/get select counters"
```

---

### Task 4: `EmailEventsIngestService` + unit tests (TDD)

**Files:**
- Create: `src/server/services/email-outreach/events-ingest.ts`
- Create: `tests/unit/email-events-ingest.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/email-events-ingest.test.ts
import { describe, it, expect } from "vitest";
import { EmailEventsIngestService, type EventPayload } from "@/server/services/email-outreach/events-ingest";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";

function makeMockDb(opts: {
  existingEventId?: string;
  existingOutreach?: { id: string; caseId: string; sentBy: string } | null;
}) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  let selectCallCount = 0;
  const db: any = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        return Promise.resolve();
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => ({
        where: () => {
          updates.push({ table: t, set: s });
          return Promise.resolve();
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCallCount++;
            if (selectCallCount === 1) {
              return opts.existingEventId ? [{ id: "existing" }] : [];
            }
            if (selectCallCount === 2) {
              return opts.existingOutreach ? [opts.existingOutreach] : [];
            }
            return [];
          },
        }),
      }),
    }),
  };
  return { db, inserts, updates };
}

const OUTREACH = { id: "o1", caseId: "c1", sentBy: "u1" };
const BASE_AT = new Date("2026-04-21T10:00:00Z");

function mkPayload(overrides: Partial<EventPayload> = {}): EventPayload {
  return {
    eventId: "evt_1",
    resendEmailId: "re_abc",
    eventType: "opened",
    eventAt: BASE_AT,
    metadata: {},
    ...overrides,
  };
}

describe("EmailEventsIngestService.ingest", () => {
  it("duplicate eventId → no-op", async () => {
    const { db, inserts, updates } = makeMockDb({ existingEventId: "evt_1" });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload());
    expect(res.status).toBe("duplicate");
    expect(inserts.length).toBe(0);
    expect(updates.length).toBe(0);
  });

  it("no-parent outreach → no-op", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: null });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload());
    expect(res.status).toBe("no-parent");
    expect(inserts.length).toBe(0);
    expect(updates.length).toBe(0);
  });

  it("unknown event type → skip", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: OUTREACH });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload({ eventType: "weird" as any }));
    expect(res.status).toBe("skipped");
    expect(inserts.length).toBe(0);
    expect(updates.length).toBe(0);
  });

  it("delivered → sets delivered_at, inserts event, no counters", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: OUTREACH });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload({ eventType: "delivered" }));
    expect(res.status).toBe("ok");
    expect(inserts.length).toBe(1);
    const setObj = updates[0].set as Record<string, unknown>;
    expect(setObj).toHaveProperty("deliveredAt");
  });

  it("opened → increments open_count + first/last", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: OUTREACH });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload({ eventType: "opened" }));
    expect(res.status).toBe("ok");
    expect(inserts.length).toBe(1);
    const setObj = updates[0].set as Record<string, unknown>;
    expect(setObj).toHaveProperty("openCount");
    expect(setObj).toHaveProperty("lastOpenedAt");
  });

  it("clicked → increments click_count + first/last + metadata", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: OUTREACH });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload({ eventType: "clicked", metadata: { url: "https://portal" } }));
    expect(res.status).toBe("ok");
    const eventRow = inserts.find((i) => {
      const v = i.values as Record<string, unknown>;
      return v.eventType === "clicked";
    })!.values as Record<string, unknown>;
    expect(eventRow.metadata).toEqual({ url: "https://portal" });
    const setObj = updates[0].set as Record<string, unknown>;
    expect(setObj).toHaveProperty("clickCount");
  });

  it("complained → sets complainedAt + inserts notification", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: OUTREACH });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload({ eventType: "complained" }));
    expect(res.status).toBe("ok");
    const notifInserts = inserts.filter((i) => {
      const v = i.values as Record<string, unknown>;
      return v && v.type === "email_complained";
    });
    expect(notifInserts.length).toBe(1);
    const setObj = updates[0].set as Record<string, unknown>;
    expect(setObj).toHaveProperty("complainedAt");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/unit/email-events-ingest.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement service**

```ts
// src/server/services/email-outreach/events-ingest.ts
import { eq, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { caseEmailOutreachEvents, type NewCaseEmailOutreachEvent } from "@/server/db/schema/case-email-outreach-events";
import { notifications } from "@/server/db/schema/notifications";

export type EventType = "delivered" | "opened" | "clicked" | "complained";

export interface EventPayload {
  eventId: string;
  resendEmailId: string;
  eventType: EventType | string;
  eventAt: Date;
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  status: "ok" | "duplicate" | "no-parent" | "skipped";
}

export interface EmailEventsIngestServiceDeps {
  db?: typeof defaultDb;
}

const ALLOWED_TYPES = new Set<EventType>(["delivered", "opened", "clicked", "complained"]);

export class EmailEventsIngestService {
  private readonly db: typeof defaultDb;

  constructor(deps: EmailEventsIngestServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
  }

  async ingest(payload: EventPayload): Promise<IngestResult> {
    // 1. idempotency
    const existing = await this.db
      .select({ id: caseEmailOutreachEvents.id })
      .from(caseEmailOutreachEvents)
      .where(eq(caseEmailOutreachEvents.resendEventId, payload.eventId))
      .limit(1);
    if (existing.length > 0) return { status: "duplicate" };

    // 2. lookup outreach
    const [outreach] = await this.db
      .select({
        id: caseEmailOutreach.id,
        caseId: caseEmailOutreach.caseId,
        sentBy: caseEmailOutreach.sentBy,
      })
      .from(caseEmailOutreach)
      .where(eq(caseEmailOutreach.resendId, payload.resendEmailId))
      .limit(1);
    if (!outreach) return { status: "no-parent" };

    // 3. type filter
    if (!ALLOWED_TYPES.has(payload.eventType as EventType)) {
      return { status: "skipped" };
    }
    const eventType = payload.eventType as EventType;

    // 4. insert event row (audit log)
    const newEvent: NewCaseEmailOutreachEvent = {
      outreachId: outreach.id,
      eventType,
      eventAt: payload.eventAt,
      metadata: payload.metadata ?? null,
      resendEventId: payload.eventId,
    };
    await this.db.insert(caseEmailOutreachEvents).values(newEvent);

    // 5. atomic counter UPDATE
    if (eventType === "delivered") {
      await this.db
        .update(caseEmailOutreach)
        .set({ deliveredAt: sql`COALESCE(${caseEmailOutreach.deliveredAt}, ${payload.eventAt})` })
        .where(eq(caseEmailOutreach.id, outreach.id));
    } else if (eventType === "opened") {
      await this.db
        .update(caseEmailOutreach)
        .set({
          openCount: sql`${caseEmailOutreach.openCount} + 1`,
          firstOpenedAt: sql`COALESCE(${caseEmailOutreach.firstOpenedAt}, ${payload.eventAt})`,
          lastOpenedAt: payload.eventAt,
        })
        .where(eq(caseEmailOutreach.id, outreach.id));
    } else if (eventType === "clicked") {
      await this.db
        .update(caseEmailOutreach)
        .set({
          clickCount: sql`${caseEmailOutreach.clickCount} + 1`,
          firstClickedAt: sql`COALESCE(${caseEmailOutreach.firstClickedAt}, ${payload.eventAt})`,
          lastClickedAt: payload.eventAt,
        })
        .where(eq(caseEmailOutreach.id, outreach.id));
    } else if (eventType === "complained") {
      await this.db
        .update(caseEmailOutreach)
        .set({ complainedAt: payload.eventAt })
        .where(eq(caseEmailOutreach.id, outreach.id));
      if (outreach.sentBy) {
        try {
          await this.db.insert(notifications).values({
            userId: outreach.sentBy,
            type: "email_complained",
            title: "Email marked as spam",
            body: `Recipient marked a sent email as spam`,
            caseId: outreach.caseId,
            dedupKey: `complaint:${outreach.id}`,
          });
        } catch (e) {
          console.error("[events-ingest] notification insert failed", e);
        }
      }
    }

    return { status: "ok" };
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run tests/unit/email-events-ingest.test.ts`
Expected: 7/7 PASS.

- [ ] **Step 5: TypeScript**

Run: `npx tsc --noEmit` → EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/email-outreach/events-ingest.ts tests/unit/email-events-ingest.test.ts
git commit -m "feat(2.3.5c): EmailEventsIngestService + counter updates + tests"
```

---

### Task 5: Webhook route `/api/webhooks/resend/events`

**Files:**
- Create: `src/app/api/webhooks/resend/events/route.ts`
- Modify: `.env.local.example`

- [ ] **Step 1: Write route**

```ts
// src/app/api/webhooks/resend/events/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { EmailEventsIngestService, type EventPayload } from "@/server/services/email-outreach/events-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapResendEventType(raw: string): EventPayload["eventType"] | null {
  // Resend event types are like "email.opened", "email.clicked", "email.delivered", "email.complained"
  switch (raw) {
    case "email.delivered": return "delivered";
    case "email.opened": return "opened";
    case "email.clicked": return "clicked";
    case "email.complained": return "complained";
    default: return null;
  }
}

function toEventPayload(raw: any): EventPayload | null {
  const mapped = mapResendEventType(raw.type ?? raw.event_type ?? "");
  if (!mapped) return null;
  return {
    eventId: raw.id ?? raw.event_id,
    resendEmailId: raw.data?.email_id ?? raw.data?.emailId ?? raw.email_id,
    eventType: mapped,
    eventAt: raw.created_at ? new Date(raw.created_at) : new Date(),
    metadata: {
      url: raw.data?.click?.url ?? raw.data?.url,
      userAgent: raw.data?.click?.userAgent ?? raw.data?.open?.userAgent,
      ipAddress: raw.data?.click?.ipAddress ?? raw.data?.open?.ipAddress,
    },
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_EVENTS_WEBHOOK_SECRET ?? process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[events-webhook] RESEND_EVENTS_WEBHOOK_SECRET not set");
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
    console.warn("[events-webhook] signature verify failed", e);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const payload = toEventPayload(verified);
  if (!payload) {
    return NextResponse.json({ status: "skipped", reason: "unknown type" }, { status: 200 });
  }

  const svc = new EmailEventsIngestService();
  try {
    const result = await svc.ingest(payload);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error("[events-webhook] ingest failed", e);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add env var to `.env.local.example`**

Append:

```
RESEND_EVENTS_WEBHOOK_SECRET=
```

- [ ] **Step 3: TypeScript + build**

Run: `npx tsc --noEmit` → EXIT 0.
Run: `npx next build 2>&1 | tail -10` → success.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/resend/events/route.ts .env.local.example
git commit -m "feat(2.3.5c): Resend events webhook route + Svix verify"
```

---

### Task 6: NewEmailModal — tracking toggle

**Files:**
- Modify: `src/components/cases/emails/new-email-modal.tsx`

- [ ] **Step 1: Add state + UI**

Read the modal. After the existing state hooks, add:

```tsx
const [trackingEnabled, setTrackingEnabled] = React.useState(false);
```

Reset on open (inside the existing `React.useEffect` that resets state when `open` flips true):

```tsx
setTrackingEnabled(false);
```

Before the `<DialogFooter>`, after the Attachments section, add:

```tsx
<div className="flex items-start gap-3 rounded border p-3">
  <input
    type="checkbox"
    id="track-opens-clicks"
    checked={trackingEnabled}
    onChange={(e) => setTrackingEnabled(e.target.checked)}
    className="mt-1"
  />
  <label htmlFor="track-opens-clicks" className="flex flex-col text-sm">
    <span className="font-medium">Track opens &amp; clicks</span>
    <span className="text-xs text-muted-foreground">
      When enabled, a 1px tracking pixel is added and links route through track.resend.com.
    </span>
  </label>
</div>
```

(If a `<Switch>` primitive exists at `@/components/ui/switch` and is used elsewhere, prefer it — match surrounding style. Inspect `/settings/notifications` page for the current on/off primitive.)

- [ ] **Step 2: Pass flag to `send.mutate`**

Locate the `send.mutate({ caseId, templateId, subject, bodyMarkdown, documentIds })` call. Extend:

```tsx
send.mutate({
  caseId,
  templateId,
  subject: subject.trim(),
  bodyMarkdown,
  documentIds: attached.map((a) => a.id),
  trackingEnabled,
})
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → EXIT 0. `npx next build 2>&1 | tail -5` → success.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/emails/new-email-modal.tsx
git commit -m "feat(2.3.5c): NewEmailModal — track opens & clicks toggle"
```

---

### Task 7: EmailsList — inline 👁/🖱 counts; EmailDetail — summary + complained banner

**Files:**
- Modify: `src/components/cases/emails/emails-list.tsx`
- Modify: `src/components/cases/emails/email-detail.tsx`

- [ ] **Step 1: EmailsList — tracking counts next to badges**

Read the file. Add imports at top:

```tsx
import { Eye, MousePointerClick } from "lucide-react";
```

Inside each email row's badge area, after the existing `replyCount` badge (from 2.3.5b), add:

```tsx
{e.trackingEnabled && (
  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
    <Eye className="size-3" /> {e.openCount ?? 0}
    <MousePointerClick className="size-3 ml-2" /> {e.clickCount ?? 0}
  </span>
)}
{e.complainedAt && (
  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">spam</span>
)}
```

- [ ] **Step 2: EmailDetail — summary line + complained banner**

Read the file. Add a helper near top:

```tsx
function formatTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
```

Before the `<SanitizedHtml html={data.bodyHtml} />` block, insert:

```tsx
{data.trackingEnabled && (
  <div className="text-xs text-muted-foreground">
    Tracking:
    {data.deliveredAt && <> delivered {formatTime(data.deliveredAt)}</>}
    {(data.openCount ?? 0) > 0 && (
      <> · opened {data.openCount}× (first {formatTime(data.firstOpenedAt)}, last {formatTime(data.lastOpenedAt)})</>
    )}
    {(data.clickCount ?? 0) > 0 && <> · clicked {data.clickCount}×</>}
  </div>
)}

{data.complainedAt && (
  <div className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800">
    ⚠ Recipient marked this as spam on {formatTime(data.complainedAt)}. Future emails may land in spam folder.
  </div>
)}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → EXIT 0.
Run: `npx next build 2>&1 | tail -5` → success.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/emails/emails-list.tsx src/components/cases/emails/email-detail.tsx
git commit -m "feat(2.3.5c): UI — tracking counts on list + summary/complained on detail"
```

---

### Task 8: Register `email_complained` notification type

**Files:**
- Modify: `src/lib/notification-types.ts`
- Modify: `src/components/notifications/notification-preferences-matrix.tsx`

- [ ] **Step 1: Add to types whitelist**

Read `src/lib/notification-types.ts`. Append `"email_complained"` to:
- `NOTIFICATION_TYPES` array
- `NOTIFICATION_CATEGORIES.cases` (matching where `email_reply_received` was added in 2.3.5b)
- `NotificationMetadata` (add a variant with fields: `caseId`, `outboundEmailId`, `subject`, `recipientEmail`)

- [ ] **Step 2: Add label**

Read `src/components/notifications/notification-preferences-matrix.tsx`. Append to `TYPE_LABELS`:

```ts
email_complained: "Recipient marked a sent email as spam",
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/notification-types.ts src/components/notifications/notification-preferences-matrix.tsx
git commit -m "feat(2.3.5c): register email_complained notification type"
```

---

### Task 9: E2E smoke + final verification

**Files:**
- Create: `e2e/email-tracking-smoke.spec.ts`

- [ ] **Step 1: Write smoke**

```ts
// e2e/email-tracking-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.5c email tracking smoke", () => {
  test("/cases/[id]?tab=emails still returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=emails`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("events webhook without signature returns 401 or 500", async ({ request, baseURL }) => {
    const resp = await request.post(`${baseURL}/api/webhooks/resend/events`, {
      data: {},
      headers: { "content-type": "application/json" },
    });
    expect([400, 401, 500]).toContain(resp.status());
  });
});
```

- [ ] **Step 2: Run smoke**

Run: `npx playwright test e2e/email-tracking-smoke.spec.ts 2>&1 | tail -10`
Expected: 2/2 pass.

- [ ] **Step 3: Full-repo verification**

```bash
npx vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -3
npx next build 2>&1 | tail -20
```

Expected:
- Vitest: ≥583 tests (576 baseline from 2.3.5b + 7 new from T4).
- tsc: EXIT 0.
- Build: success.

- [ ] **Step 4: Commit**

```bash
git add e2e/email-tracking-smoke.spec.ts
git commit -m "test(2.3.5c): E2E smoke for tracking routes"
```

---

### Task 10: Service-level UAT (post-implementation)

**Files:**
- Create (temporary): `.tmp-uat-235c.mjs`

- [ ] **Step 1: Write UAT**

Mirror the pattern from `.tmp-uat-235b.mjs` (available in git history). Flow:

1. Load `.env.local`, connect `postgres` client.
2. **Seed** one `case_email_outreach` row with `tracking_enabled=true`, `resend_id='re_test_235c_<rand>'` for `CASE_ID=61e9c86a-...`, `sent_by=LAWYER_ID`. Record its `id = OUTREACH_ID`.
3. Synthesize events:
   a. `delivered` event → call `EmailEventsIngestService.ingest` → assert `delivered_at` set on outreach, event row inserted.
   b. `opened` event → `open_count=1`, `first_opened_at` + `last_opened_at` set.
   c. Second `opened` event (different eventId, later timestamp) → `open_count=2`, `first_opened_at` unchanged, `last_opened_at` updated.
   d. Duplicate eventId of the first `opened` → `status:'duplicate'`, counters unchanged.
   e. `clicked` event with `metadata.url='https://example/portal'` → `click_count=1`, event row includes metadata.
   f. Unknown `eventType='bizarre'` → `status:'skipped'`, no row.
   g. Wrong `resendEmailId` → `status:'no-parent'`, no row.
   h. `complained` event → `complained_at` set, notification row inserted with `type='email_complained'`.
4. Cleanup: delete event rows for this outreach, delete notification, delete outreach. Output `X ✓ / 0 ✗`.

- [ ] **Step 2: Run**

Run: `npx tsx .tmp-uat-235c.mjs`
Expected: ≥10 ✓, 0 ✗. Fix bugs in `fix(2.3.5c): ...` commits and re-run.

- [ ] **Step 3: Remove script**

```bash
rm .tmp-uat-235c.mjs
```

---

## Self-Review

**Spec coverage:**
- §3 decisions → tasks. 1 Per-email opt-in toggle: T6. 2 Hybrid storage: T1, T4. 3 Native Resend flags: T2, T3. 4 Flag-only complaints: T4, T7. 5 Minimal UI: T6, T7. 6 Events set: T4 service + T5 route mapping. 7 Idempotency: T4. 8 Sync pipeline: T5.
- §4 data model → T1.
- §5 send path → T2, T3.
- §6 inbound pipeline → T4, T5.
- §7 UI → T6, T7.
- §8 files → all covered.
- §9 testing → T4 unit, T9 E2E, T10 UAT.
- §10 manual UAT criteria → T10 mirrors service-level; browser UAT is separate.
- §11 rollout/ops → out of plan scope (human step). Webhook URL + env setup.
- §12 security → T5 signature verify. Privacy note: metadata stored but not displayed — implicit in T7 (we render summary fields only).
- §13 open items → `RESEND_EVENTS_WEBHOOK_SECRET` with fallback to inbound secret (T5 implements fallback). Payload shape to confirm at ops setup; `toEventPayload` in T5 is defensively keyed to cover likely Resend variants.

**Placeholder scan:** No "TBD"/"TODO". One "If a `<Switch>` primitive exists" branch in T6 is a styling preference not a blocker.

**Type consistency:**
- `EventType = "delivered"|"opened"|"clicked"|"complained"` — consistent across T1 CHECK, T4 service, T5 route mapping.
- `trackingEnabled` spelled same across DB column, service input, tRPC input, modal state, component props (T1, T3, T6).
- `openCount`/`clickCount`/`firstOpenedAt` etc. — consistent across T1 schema, T3 select lists, T7 UI.
- `resend_event_id` UNIQUE — consistent with 2.3.5b pattern.

**No red flags.** Plan ready.
