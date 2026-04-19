# Lawyer-Side Case Messaging (2.3.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lawyer-side Messages tab + real-time delivery + read tracking + nav badge so lawyers can see and respond to client messages from the main app, completing the lawyer↔client thread on the existing `case_messages` schema.

**Architecture:** New `case_message_reads` table for last-seen tracking. `caseMessages.*` tRPC sub-router (6 procedures) including SSE subscription `onNewMessage`. In-memory `EventEmitter` pub/sub broadcasts new messages to open subscriptions; Inngest `notification.case_message_received` handler emits to the channel after recipient fan-out. `documents` table reused for attachments via existing case-documents picker UX. Notification type `case_message_received` flows through `handle-notification.ts` with two branches (lawyer recipient → main-app channels; portal recipient → existing portal flow).

**Tech Stack:** Next.js App Router, Drizzle ORM (postgres-js), tRPC v11, Inngest v4, Node `EventEmitter`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-19-case-messaging-lawyer-side-design.md`

---

## File Structure

### Created
- `src/server/db/migrations/0012_case_message_reads.sql`
- `src/server/db/schema/case-message-reads.ts`
- `src/server/services/messaging/pubsub.ts`
- `src/server/services/messaging/case-messages-service.ts`
- `src/server/trpc/routers/case-messages.ts`
- `src/components/cases/messages-tab.tsx`
- `src/components/cases/message-bubble.tsx`
- `src/components/cases/message-composer.tsx`
- `src/components/cases/attach-document-modal.tsx`
- `tests/integration/case-messages-router.test.ts`
- `tests/integration/case-messages-service.test.ts`
- `tests/unit/messaging-pubsub.test.ts`
- `e2e/case-messages.spec.ts`

### Modified
- `src/server/db/schema/case-messages.ts` — add `documentId` column (Drizzle side; SQL side via migration).
- `src/server/trpc/routers/_app.ts` (or wherever `appRouter` is defined) — mount `caseMessages: caseMessagesRouter`.
- `src/server/trpc/routers/portal-messages.ts` — fire Inngest event after INSERT (so lawyer side sees client messages).
- `src/lib/notification-types.ts` — add `case_message_received`.
- `src/components/notifications/notification-preferences-matrix.tsx` — `TYPE_LABELS` entry.
- `src/server/inngest/functions/handle-notification.ts` — branch on `recipientType` for `case_message_received`.
- `src/app/(app)/cases/[id]/page.tsx` — add Messages tab.
- `src/components/layout/sidebar.tsx` — add unread badge to Cases nav-link.
- `src/app/(app)/cases/page.tsx` — add per-case unread dot.

---

## Conventions reminder

- Hand-written migrations applied via `psql "$DATABASE_URL" -f <file>` (use `/opt/homebrew/opt/libpq/bin/psql` if not on PATH).
- Drizzle index callback array form: `(table) => [index(...)]`.
- All router tests use chainable mock-DB pattern (see `tests/integration/research-router.test.ts` and `tests/integration/research-collections-router.test.ts` for reference).
- tRPC v11 subscription pattern uses `async function*` generators (matches research.ts askBroad/askDeep).
- `protectedProcedure` requires Clerk auth + populates `ctx.user`.
- `assertCaseAccess(ctx, caseId)` exists at `src/server/trpc/lib/permissions.ts` — reuse, don't duplicate.

---

## Chunk 1 — Schema + Migration

### Task 1: Drizzle schema for `case_message_reads` + `documentId` column on `case_messages`

**Files:**
- Create: `src/server/db/schema/case-message-reads.ts`
- Modify: `src/server/db/schema/case-messages.ts`

- [ ] **Step 1: Create new schema file**

```ts
// src/server/db/schema/case-message-reads.ts
import {
  pgTable,
  uuid,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";

export const caseMessageReads = pgTable(
  "case_message_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("case_message_reads_case_user_unique").on(table.caseId, table.userId),
    index("case_message_reads_user_case_idx").on(table.userId, table.caseId),
  ],
);

export type CaseMessageRead = typeof caseMessageReads.$inferSelect;
export type NewCaseMessageRead = typeof caseMessageReads.$inferInsert;
```

- [ ] **Step 2: Add `documentId` column to `case-messages.ts` Drizzle schema**

Modify `src/server/db/schema/case-messages.ts`. Add the column inside the `pgTable` definition (after `body`):

```ts
import { documents } from "./documents";
// ...inside the pgTable("case_messages", { ... }) columns:
documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: EXIT=0.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema/case-message-reads.ts src/server/db/schema/case-messages.ts
git commit -m "feat(2.3.1): drizzle schema for case_message_reads + document_id on case_messages"
```

---

### Task 2: SQL migration 0012

**Files:**
- Create: `src/server/db/migrations/0012_case_message_reads.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0012_case_message_reads.sql
-- Phase 2.3.1: lawyer-side read tracking for case messages + attachment column.

CREATE TABLE "case_message_reads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "case_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "last_read_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "case_message_reads"
  ADD CONSTRAINT "case_message_reads_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_message_reads_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "case_message_reads_case_user_unique"
  ON "case_message_reads" USING btree ("case_id","user_id");
CREATE INDEX "case_message_reads_user_case_idx"
  ON "case_message_reads" USING btree ("user_id","case_id");

-- Defensive: add document_id to case_messages if not present (2.1.8 didn't ship it).
ALTER TABLE "case_messages"
  ADD COLUMN IF NOT EXISTS "document_id" uuid REFERENCES "public"."documents"("id") ON DELETE SET NULL;
```

- [ ] **Step 2: Apply to dev DB**

Run:
```bash
set -a && source .env.local && set +a && \
  /opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f src/server/db/migrations/0012_case_message_reads.sql
```
Expected: CREATE TABLE × 1, ALTER TABLE × 2, CREATE INDEX × 2, EXIT=0.

- [ ] **Step 3: Verify**

Run:
```bash
set -a && source .env.local && set +a && \
  /opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -c \
  "SELECT relname FROM pg_class WHERE relname LIKE 'case_message_reads%';
   SELECT column_name FROM information_schema.columns WHERE table_name='case_messages' AND column_name='document_id';"
```
Expected: table + 2 indexes; document_id column present.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/migrations/0012_case_message_reads.sql
git commit -m "feat(2.3.1): migration 0012 — case_message_reads + document_id on case_messages"
```

---

## Chunk 2 — Backend Service + Pub/Sub + Router

### Task 3: Pub/sub layer

**Files:**
- Create: `src/server/services/messaging/pubsub.ts`
- Test: `tests/unit/messaging-pubsub.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/messaging-pubsub.test.ts
import { describe, it, expect, vi } from "vitest";
import { messagingPubsub } from "@/server/services/messaging/pubsub";

describe("messagingPubsub", () => {
  it("delivers emitted messages to subscribers on the same channel", () => {
    const handler = vi.fn();
    const unsub = messagingPubsub.on("case:abc", handler);
    messagingPubsub.emit("case:abc", { id: "m1" });
    expect(handler).toHaveBeenCalledWith({ id: "m1" });
    unsub();
  });

  it("does not deliver to subscribers on other channels", () => {
    const handler = vi.fn();
    const unsub = messagingPubsub.on("case:abc", handler);
    messagingPubsub.emit("case:xyz", { id: "m1" });
    expect(handler).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops further delivery", () => {
    const handler = vi.fn();
    const unsub = messagingPubsub.on("case:abc", handler);
    unsub();
    messagingPubsub.emit("case:abc", { id: "m1" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers on the same channel", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = messagingPubsub.on("case:multi", a);
    const unsubB = messagingPubsub.on("case:multi", b);
    messagingPubsub.emit("case:multi", { id: "m2" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run tests/unit/messaging-pubsub.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement pub/sub**

```ts
// src/server/services/messaging/pubsub.ts
//
// In-process pub/sub for SSE message broadcast. Single Node process only.
// Multi-process scaling requires a Postgres LISTEN/NOTIFY adapter (deferred).

import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
emitter.setMaxListeners(1000); // SSE connections can pile up under load

export const messagingPubsub = {
  emit(channel: string, message: unknown): void {
    emitter.emit(channel, message);
  },
  on(channel: string, handler: (message: unknown) => void): () => void {
    emitter.on(channel, handler);
    return () => emitter.off(channel, handler);
  },
};
```

- [ ] **Step 4: Run tests pass**

Run: `npx vitest run tests/unit/messaging-pubsub.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/messaging/pubsub.ts tests/unit/messaging-pubsub.test.ts
git commit -m "feat(2.3.1): in-process EventEmitter pub/sub for SSE broadcast"
```

---

### Task 4: CaseMessagesService (send + markRead + unread aggregation)

**Files:**
- Create: `src/server/services/messaging/case-messages-service.ts`
- Test: `tests/integration/case-messages-service.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/case-messages-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { CaseMessagesService } from "@/server/services/messaging/case-messages-service";

function makeMockDb() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  const selectQueue: unknown[][] = [];
  const db = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        return {
          returning: async () => [{ id: "msg-1", ...(v as object) }],
          onConflictDoUpdate: () => ({
            returning: async () => [{ id: "read-1", ...(v as object) }],
          }),
        };
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
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    enqueue: (rows: unknown[]) => selectQueue.push(rows),
    inserts,
    updates,
  } as any;
  return db;
}

describe("CaseMessagesService.send", () => {
  it("inserts lawyer message with documentId when provided", async () => {
    const db = makeMockDb();
    db.enqueue([{ id: "doc-1", caseId: "case-1" }]); // attachment validation
    const inngest = { send: vi.fn() };
    const svc = new CaseMessagesService({ db, inngest });
    const result = await svc.send({
      caseId: "case-1",
      lawyerUserId: "u1",
      body: "hello",
      documentId: "doc-1",
    });
    expect(result.messageId).toBe("msg-1");
    const msgInsert = db.inserts.find((i: any) => (i.values as any).body === "hello");
    expect(msgInsert).toBeDefined();
    expect((msgInsert!.values as any).documentId).toBe("doc-1");
    expect((msgInsert!.values as any).authorType).toBe("lawyer");
  });

  it("rejects documentId belonging to different case", async () => {
    const db = makeMockDb();
    db.enqueue([{ id: "doc-1", caseId: "OTHER-CASE" }]);
    const inngest = { send: vi.fn() };
    const svc = new CaseMessagesService({ db, inngest });
    await expect(
      svc.send({ caseId: "case-1", lawyerUserId: "u1", body: "x", documentId: "doc-1" }),
    ).rejects.toThrow(/not in this case/i);
  });

  it("dispatches Inngest event after insert", async () => {
    const db = makeMockDb();
    const inngest = { send: vi.fn() };
    const svc = new CaseMessagesService({ db, inngest });
    await svc.send({ caseId: "case-1", lawyerUserId: "u1", body: "hi" });
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "messaging/case_message.created" }),
    );
  });
});

describe("CaseMessagesService.markRead", () => {
  it("UPSERTs read row", async () => {
    const db = makeMockDb();
    const inngest = { send: vi.fn() };
    const svc = new CaseMessagesService({ db, inngest });
    await svc.markRead({ caseId: "case-1", userId: "u1" });
    const upsert = db.inserts.find((i: any) => (i.values as any).caseId === "case-1");
    expect(upsert).toBeDefined();
    expect((upsert!.values as any).userId).toBe("u1");
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run tests/integration/case-messages-service.test.ts`
Expected: FAIL — `CaseMessagesService is not defined`.

- [ ] **Step 3: Implement service**

```ts
// src/server/services/messaging/case-messages-service.ts
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseMessages } from "@/server/db/schema/case-messages";
import { caseMessageReads } from "@/server/db/schema/case-message-reads";
import { documents } from "@/server/db/schema/documents";
import { cases } from "@/server/db/schema/cases";
import { inngest as defaultInngest } from "@/server/inngest/client";

export interface CaseMessagesServiceDeps {
  db?: typeof defaultDb;
  inngest?: { send: (e: any) => Promise<unknown> | unknown };
}

export interface SendInput {
  caseId: string;
  lawyerUserId: string;
  body: string;
  documentId?: string;
}

export class CaseMessagesService {
  private readonly db: typeof defaultDb;
  private readonly inngest: { send: (e: any) => Promise<unknown> | unknown };

  constructor(deps: CaseMessagesServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.inngest = deps.inngest ?? defaultInngest;
  }

  async send(input: SendInput): Promise<{ messageId: string }> {
    if (input.documentId) {
      const [doc] = await this.db
        .select({ id: documents.id, caseId: documents.caseId })
        .from(documents)
        .where(eq(documents.id, input.documentId))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (doc.caseId !== input.caseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Document is not in this case" });
      }
    }
    const [row] = await this.db
      .insert(caseMessages)
      .values({
        caseId: input.caseId,
        authorType: "lawyer",
        lawyerAuthorId: input.lawyerUserId,
        portalAuthorId: null,
        body: input.body,
        documentId: input.documentId ?? null,
      })
      .returning();
    await this.inngest.send({
      name: "messaging/case_message.created",
      data: {
        messageId: row.id,
        caseId: input.caseId,
        authorType: "lawyer",
        authorUserId: input.lawyerUserId,
      },
    });
    return { messageId: row.id };
  }

  async markRead(input: { caseId: string; userId: string }): Promise<void> {
    const now = new Date();
    await this.db
      .insert(caseMessageReads)
      .values({
        caseId: input.caseId,
        userId: input.userId,
        lastReadAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [caseMessageReads.caseId, caseMessageReads.userId],
        set: { lastReadAt: now, updatedAt: now },
      });
  }

  /** For sidebar badge: count of cases (in user's org) with unread client messages. */
  async unreadByCase(input: { userId: string; orgId: string | null }): Promise<{
    count: number;
    byCase: Array<{ caseId: string; count: number; lastMessageAt: Date }>;
  }> {
    // Single aggregation. Considers cases in the user's org (or the user's own cases if no org).
    const orgClause = input.orgId
      ? sql`${cases.orgId} = ${input.orgId}`
      : sql`${cases.userId} = ${input.userId}`;
    const rows = await this.db.execute<{
      case_id: string;
      unread_count: number;
      last_message_at: Date;
    }>(sql`
      SELECT
        m.case_id,
        COUNT(*)::int AS unread_count,
        MAX(m.created_at) AS last_message_at
      FROM ${caseMessages} m
      JOIN ${cases} c ON c.id = m.case_id
      WHERE ${orgClause}
        AND m.author_type = 'client'
        AND m.created_at > COALESCE(
          (SELECT last_read_at FROM ${caseMessageReads} r
           WHERE r.case_id = m.case_id AND r.user_id = ${input.userId}),
          to_timestamp(0)
        )
      GROUP BY m.case_id
    `);
    const list = ((rows as any).rows ?? rows) as Array<{
      case_id: string;
      unread_count: number;
      last_message_at: Date;
    }>;
    const byCase = list.map((r) => ({
      caseId: r.case_id,
      count: Number(r.unread_count),
      lastMessageAt: r.last_message_at,
    }));
    return { count: byCase.length, byCase };
  }
}
```

- [ ] **Step 4: Run tests pass**

Run: `npx vitest run tests/integration/case-messages-service.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/messaging/case-messages-service.ts tests/integration/case-messages-service.test.ts
git commit -m "feat(2.3.1): CaseMessagesService (send + markRead + unread aggregation)"
```

---

### Task 5: tRPC `caseMessages.*` router (incl. SSE subscription)

**Files:**
- Create: `src/server/trpc/routers/case-messages.ts`
- Modify: wherever `appRouter` is defined to mount `caseMessages: caseMessagesRouter`
- Test: `tests/integration/case-messages-router.test.ts`

- [ ] **Step 1: Locate appRouter**

Run: `grep -rn "appRouter\s*=\|export.*appRouter" src/server/trpc/ | head`
Expected: locate the file (likely `src/server/trpc/_app.ts` or `src/server/trpc/root.ts`).

- [ ] **Step 2: Write failing tests**

```ts
// tests/integration/case-messages-router.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Use the existing makeMockDb helpers from tests/integration/research-router.test.ts.
// Copy the helpers; do not invent a new pattern.

vi.mock("@/server/inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

import { appRouter } from "@/server/trpc/root"; // adjust to actual path located in Step 1
import { inngest } from "@/server/inngest/client";

describe("caseMessages router", () => {
  let mockDb: any;
  let user: { id: string; orgId: string | null; role: string };

  beforeEach(() => {
    user = { id: "u1", orgId: "org1", role: "owner" };
    mockDb = makeMockDb();
    (inngest.send as any).mockReset();
  });

  it("send rejects when user has no case access", async () => {
    mockDb.enqueueSelect([]); // assertCaseAccess returns nothing
    const caller = appRouter.createCaller({ db: mockDb, user } as any);
    await expect(
      caller.caseMessages.send({ caseId: "case-1", body: "hi" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("send happy path inserts and dispatches event", async () => {
    mockDb.enqueueSelect([{ id: "case-1" }]); // assertCaseAccess
    mockDb.setInsertReturning([{ id: "msg-1" }]);
    const caller = appRouter.createCaller({ db: mockDb, user } as any);
    const out = await caller.caseMessages.send({ caseId: "case-1", body: "hi" });
    expect(out.messageId).toBe("msg-1");
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "messaging/case_message.created" }),
    );
  });

  it("markRead UPSERTs read row", async () => {
    mockDb.enqueueSelect([{ id: "case-1" }]); // assertCaseAccess
    const caller = appRouter.createCaller({ db: mockDb, user } as any);
    await caller.caseMessages.markRead({ caseId: "case-1" });
    const insert = mockDb.lastInsert?.values as any;
    expect(insert.userId).toBe("u1");
    expect(insert.caseId).toBe("case-1");
  });

  it("list returns paginated messages", async () => {
    mockDb.enqueueSelect([{ id: "case-1" }]); // assertCaseAccess
    mockDb.enqueueSelect([
      { id: "msg-1", body: "hi", authorType: "client" },
      { id: "msg-2", body: "there", authorType: "lawyer" },
    ]);
    const caller = appRouter.createCaller({ db: mockDb, user } as any);
    const out = await caller.caseMessages.list({ caseId: "case-1" });
    expect(out.messages).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `npx vitest run tests/integration/case-messages-router.test.ts`
Expected: FAIL — `caller.caseMessages` undefined.

- [ ] **Step 4: Implement router**

```ts
// src/server/trpc/routers/case-messages.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, isNotNull } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { caseMessages } from "@/server/db/schema/case-messages";
import { documents } from "@/server/db/schema/documents";
import { users } from "@/server/db/schema/users";
import { portalUsers } from "@/server/db/schema/portal-users";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { CaseMessagesService } from "@/server/services/messaging/case-messages-service";
import { messagingPubsub } from "@/server/services/messaging/pubsub";

export const caseMessagesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        page: z.number().int().min(1).max(100).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const offset = (input.page - 1) * input.pageSize;
      const rows = await ctx.db
        .select({
          id: caseMessages.id,
          caseId: caseMessages.caseId,
          authorType: caseMessages.authorType,
          lawyerAuthorId: caseMessages.lawyerAuthorId,
          portalAuthorId: caseMessages.portalAuthorId,
          body: caseMessages.body,
          documentId: caseMessages.documentId,
          createdAt: caseMessages.createdAt,
          lawyerName: users.name,
          portalName: portalUsers.displayName,
          documentName: documents.filename,
        })
        .from(caseMessages)
        .leftJoin(users, eq(users.id, caseMessages.lawyerAuthorId))
        .leftJoin(portalUsers, eq(portalUsers.id, caseMessages.portalAuthorId))
        .leftJoin(documents, eq(documents.id, caseMessages.documentId))
        .where(eq(caseMessages.caseId, input.caseId))
        .orderBy(desc(caseMessages.createdAt))
        .limit(input.pageSize)
        .offset(offset);
      return { messages: rows, page: input.page, pageSize: input.pageSize };
    }),

  send: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        body: z.string().trim().min(1).max(5000),
        documentId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new CaseMessagesService({ db: ctx.db });
      return svc.send({
        caseId: input.caseId,
        lawyerUserId: ctx.user.id,
        body: input.body,
        documentId: input.documentId,
      });
    }),

  markRead: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new CaseMessagesService({ db: ctx.db });
      await svc.markRead({ caseId: input.caseId, userId: ctx.user.id });
      return { ok: true };
    }),

  unreadByCase: protectedProcedure
    .query(async ({ ctx }) => {
      const svc = new CaseMessagesService({ db: ctx.db });
      return svc.unreadByCase({ userId: ctx.user.id, orgId: ctx.user.orgId ?? null });
    }),

  attachableDocuments: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        search: z.string().trim().max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const conditions = [eq(documents.caseId, input.caseId)];
      if (input.search) conditions.push(ilike(documents.filename, `%${input.search}%`));
      const rows = await ctx.db
        .select({
          id: documents.id,
          filename: documents.filename,
          fileType: documents.fileType,
          fileSize: documents.fileSize,
        })
        .from(documents)
        .where(and(...conditions))
        .orderBy(desc(documents.id))
        .limit(50);
      return { documents: rows };
    }),

  onNewMessage: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .subscription(async function* ({ ctx, input, signal }) {
      await assertCaseAccess(ctx, input.caseId);
      const queue: unknown[] = [];
      let waker: (() => void) | null = null;
      const unsub = messagingPubsub.on(`case:${input.caseId}`, (msg) => {
        queue.push(msg);
        waker?.();
      });
      try {
        while (!signal?.aborted) {
          if (queue.length > 0) {
            yield { type: "new" as const, message: queue.shift() };
          } else {
            await new Promise<void>((resolve) => {
              waker = resolve;
              const timeout = setTimeout(resolve, 30_000);
              signal?.addEventListener("abort", () => {
                clearTimeout(timeout);
                resolve();
              });
            });
            waker = null;
          }
        }
      } finally {
        unsub();
      }
    }),
});
```

- [ ] **Step 5: Mount in appRouter**

In the file located in Step 1 (e.g., `src/server/trpc/root.ts`), add:

```ts
import { caseMessagesRouter } from "./routers/case-messages";
// ...
export const appRouter = router({
  // ...existing entries...
  caseMessages: caseMessagesRouter,
});
```

- [ ] **Step 6: Run tests pass**

Run: `npx vitest run tests/integration/case-messages-router.test.ts && npx tsc --noEmit && npx vitest run`
Expected: 4/4 router tests PASS; full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/server/trpc/routers/case-messages.ts src/server/trpc/root.ts \
        tests/integration/case-messages-router.test.ts
git commit -m "feat(2.3.1): caseMessages router (list/send/markRead/unread/attach/onNewMessage SSE)"
```

(Adjust `git add` if appRouter is in a different file.)

---

## Chunk 3 — Notifications + Inngest Wiring

### Task 6: Notification type `case_message_received` + Inngest broadcaster

**Files:**
- Modify: `src/lib/notification-types.ts`
- Modify: `src/components/notifications/notification-preferences-matrix.tsx`
- Modify: `src/server/inngest/functions/handle-notification.ts`
- Modify: `src/server/trpc/routers/portal-messages.ts` — fire Inngest event after INSERT
- Create or modify: a new Inngest function that listens for `messaging/case_message.created` and dispatches per-recipient `notification.case_message_received` events plus pubsub broadcast.

- [ ] **Step 1: Add notification type to notification-types.ts**

In `src/lib/notification-types.ts`, append `"case_message_received"` to:
- `NOTIFICATION_TYPES` array
- `NOTIFICATION_CATEGORIES.cases`
- `NotificationMetadata` type map:
```ts
case_message_received: {
  caseId: string;
  caseName: string;
  messageId: string;
  authorName: string;
  bodyPreview: string;
  recipientUserId: string;       // for lawyer recipient
  recipientPortalUserId?: string; // for portal recipient
  recipientType: "lawyer" | "portal";
};
```

- [ ] **Step 2: Add label**

In `src/components/notifications/notification-preferences-matrix.tsx`, add to `TYPE_LABELS`:
```ts
case_message_received: "New message in case",
```

- [ ] **Step 3: Add handler case**

In `src/server/inngest/functions/handle-notification.ts`, add case (mirror the structure of `research_memo_ready` case):

```ts
case "case_message_received": {
  const url = `/cases/${data.caseId}?tab=messages`;
  if (data.recipientType === "portal") {
    // Routes through existing portal-notifications path — emit a portal-side
    // notification row instead of in-app for the lawyer side. Reuse whatever
    // helper portal-message-received uses today (locate via grep).
    // For MVP minimal: skip portal side here; the portal already handles
    // its own notifications via portal_notifications when portal-messages.send
    // ran. Returning empty channels avoids double-firing.
    return { inApp: null, email: null, push: null };
  }
  return {
    inApp: {
      title: `New message from ${data.authorName}`,
      body: data.bodyPreview,
      url,
    },
    email: {
      subject: `New message in ${data.caseName}`,
      html: `<p>${data.authorName.replace(/[<>&]/g, "")} sent a new message in ${data.caseName.replace(/[<>&]/g, "")}:</p><blockquote>${data.bodyPreview.replace(/[<>&]/g, "")}</blockquote><p><a href="${url}">Open conversation</a></p>`,
    },
    push: { title: "New message", body: data.bodyPreview, url },
  };
}
```

- [ ] **Step 4: Create Inngest broadcaster function**

Create `src/server/inngest/functions/case-message-broadcast.ts`:

```ts
// src/server/inngest/functions/case-message-broadcast.ts
//
// Listens for messaging/case_message.created and:
// 1. Fans out notification.case_message_received per recipient (lawyer + portal).
// 2. Emits to in-process pubsub for SSE subscribers.

import { inngest } from "@/server/inngest/client";
import { db as defaultDb } from "@/server/db";
import { eq, ne } from "drizzle-orm";
import { caseMessages } from "@/server/db/schema/case-messages";
import { caseMembers } from "@/server/db/schema/case-members";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { portalUsers } from "@/server/db/schema/portal-users";
import { messagingPubsub } from "@/server/services/messaging/pubsub";

export const caseMessageBroadcast = inngest.createFunction(
  { id: "case-message-broadcast", retries: 1 },
  { event: "messaging/case_message.created" },
  async ({ event }) => {
    const { messageId, caseId, authorType, authorUserId } = event.data as {
      messageId: string;
      caseId: string;
      authorType: "lawyer" | "client";
      authorUserId: string;
    };

    const [msg] = await defaultDb
      .select()
      .from(caseMessages)
      .where(eq(caseMessages.id, messageId))
      .limit(1);
    if (!msg) return { error: "Message vanished" };

    const [caseRow] = await defaultDb
      .select({ id: cases.id, name: cases.title, clientId: cases.clientId, orgId: cases.orgId, ownerId: cases.userId })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);
    if (!caseRow) return { error: "Case missing" };

    // Resolve author display name
    let authorName = "Someone";
    if (authorType === "lawyer") {
      const [u] = await defaultDb.select({ name: users.name }).from(users).where(eq(users.id, authorUserId)).limit(1);
      authorName = u?.name ?? "Lawyer";
    } else {
      const [pu] = await defaultDb.select({ name: portalUsers.displayName }).from(portalUsers).where(eq(portalUsers.id, authorUserId)).limit(1);
      authorName = pu?.name ?? "Client";
    }

    const bodyPreview = msg.body.slice(0, 120);

    // Lawyer recipients = case_members + ownerId, excluding the sender if lawyer.
    const memberRows = await defaultDb
      .select({ userId: caseMembers.userId })
      .from(caseMembers)
      .where(eq(caseMembers.caseId, caseId));
    const lawyerIds = new Set<string>(memberRows.map((r) => r.userId));
    if (caseRow.ownerId) lawyerIds.add(caseRow.ownerId);
    if (authorType === "lawyer") lawyerIds.delete(authorUserId);

    for (const lawyerId of lawyerIds) {
      await inngest.send({
        name: "notification.case_message_received",
        data: {
          caseId,
          caseName: caseRow.name ?? "Case",
          messageId,
          authorName,
          bodyPreview,
          recipientUserId: lawyerId,
          recipientType: "lawyer",
        },
      });
    }

    // Portal recipients = portal_users on the same client (excluding sender if portal).
    if (caseRow.clientId) {
      const portalRows = await defaultDb
        .select({ id: portalUsers.id })
        .from(portalUsers)
        .where(eq(portalUsers.clientId, caseRow.clientId));
      for (const p of portalRows) {
        if (authorType === "client" && p.id === authorUserId) continue;
        await inngest.send({
          name: "notification.case_message_received",
          data: {
            caseId,
            caseName: caseRow.name ?? "Case",
            messageId,
            authorName,
            bodyPreview,
            recipientUserId: "", // unused for portal recipient
            recipientPortalUserId: p.id,
            recipientType: "portal",
          },
        });
      }
    }

    // SSE broadcast to anyone with an open subscription on this case.
    messagingPubsub.emit(`case:${caseId}`, {
      id: msg.id,
      caseId,
      authorType,
      body: msg.body,
      createdAt: msg.createdAt,
      documentId: msg.documentId,
    });

    return { dispatched: lawyerIds.size, broadcast: true };
  },
);
```

- [ ] **Step 5: Register the new Inngest function**

Locate the Inngest registry (e.g., `src/server/inngest/index.ts`). Add:
```ts
import { caseMessageBroadcast } from "@/server/inngest/functions/case-message-broadcast";
// in the functions array:
caseMessageBroadcast,
```

- [ ] **Step 6: Patch portal-messages.send to fire the new event**

In `src/server/trpc/routers/portal-messages.ts`, find the `send` mutation. After the INSERT, add:
```ts
import { inngest as defaultInngest } from "@/server/inngest/client";
// ... after const [row] = await ctx.db.insert(...).values({ ... }).returning():
await defaultInngest.send({
  name: "messaging/case_message.created",
  data: {
    messageId: row.id,
    caseId: input.caseId,
    authorType: "client",
    authorUserId: ctx.portalUser.id,
  },
});
```

(Adjust `ctx.portalUser` access to whatever the portalProcedure exposes.)

- [ ] **Step 7: Verify typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: EXIT=0; all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/notification-types.ts src/components/notifications/notification-preferences-matrix.tsx \
        src/server/inngest/functions/handle-notification.ts \
        src/server/inngest/functions/case-message-broadcast.ts \
        src/server/inngest/index.ts \
        src/server/trpc/routers/portal-messages.ts
git commit -m "feat(2.3.1): case_message_received notification + Inngest broadcaster + pubsub fanout"
```

---

## Chunk 4 — UI: Messages Tab

### Task 7: Message bubble + day separator

**Files:**
- Create: `src/components/cases/message-bubble.tsx`

- [ ] **Step 1: Implement bubble**

```tsx
// src/components/cases/message-bubble.tsx
"use client";

import { format } from "date-fns";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: {
    id: string;
    authorType: "lawyer" | "client";
    body: string;
    createdAt: string | Date;
    lawyerName: string | null;
    portalName: string | null;
    documentId: string | null;
    documentName: string | null;
  };
  /** True when the current user is the author. Right-aligned + primary color. */
  isMine: boolean;
}

export function MessageBubble({ message, isMine }: MessageBubbleProps) {
  const author = message.authorType === "lawyer" ? message.lawyerName : message.portalName;
  const time = typeof message.createdAt === "string" ? new Date(message.createdAt) : message.createdAt;
  return (
    <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg p-3 text-sm",
          isMine ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {!isMine && author && (
          <p className="mb-1 text-xs font-medium opacity-80">{author}</p>
        )}
        <p className="whitespace-pre-wrap">{message.body}</p>
        {message.documentId && message.documentName && (
          <a
            href={`/api/documents/${message.documentId}/download`}
            className="mt-2 inline-flex items-center gap-1 rounded border border-current/20 bg-background/10 px-2 py-1 text-xs hover:bg-background/20"
          >
            <Paperclip className="size-3" aria-hidden /> {message.documentName}
          </a>
        )}
        <p className="mt-1 text-right text-[10px] opacity-70">{format(time, "h:mm a")}</p>
      </div>
    </div>
  );
}
```

(Note: `/api/documents/${id}/download` may or may not exist. If not, the link can point to an existing route or be a follow-up. Confirm during implementation; if the download endpoint is missing, the chip can be a non-link `<span>` for MVP.)

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/message-bubble.tsx
git commit -m "feat(2.3.1): message bubble component (left/right alignment + attachment chip)"
```

---

### Task 8: Attach document modal

**Files:**
- Create: `src/components/cases/attach-document-modal.tsx`

- [ ] **Step 1: Implement**

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

interface AttachDocumentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  onSelect: (doc: { id: string; filename: string }) => void;
}

export function AttachDocumentModal({ open, onOpenChange, caseId, onSelect }: AttachDocumentModalProps) {
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const { data, isLoading } = trpc.caseMessages.attachableDocuments.useQuery(
    { caseId, search: search || undefined },
    { enabled: open },
  );

  React.useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedId(null);
    }
  }, [open]);

  const submit = () => {
    const doc = data?.documents.find((d) => d.id === selectedId);
    if (!doc) return;
    onSelect({ id: doc.id, filename: doc.filename });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Attach a document</DialogTitle>
          <DialogDescription>Choose a document already uploaded to this case.</DialogDescription>
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
                        type="radio"
                        name="doc"
                        checked={selectedId === d.id}
                        onChange={() => setSelectedId(d.id)}
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
          <Button onClick={submit} disabled={!selectedId}>Attach selected</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/attach-document-modal.tsx
git commit -m "feat(2.3.1): attach-document modal (single-select picker over case documents)"
```

---

### Task 9: Composer

**Files:**
- Create: `src/components/cases/message-composer.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/cases/message-composer.tsx
"use client";

import * as React from "react";
import { Paperclip, Send, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AttachDocumentModal } from "./attach-document-modal";
import { toast } from "sonner";

interface MessageComposerProps {
  caseId: string;
  onSent?: () => void;
}

export function MessageComposer({ caseId, onSent }: MessageComposerProps) {
  const utils = trpc.useUtils();
  const [body, setBody] = React.useState("");
  const [attachment, setAttachment] = React.useState<{ id: string; filename: string } | null>(null);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const sendMut = trpc.caseMessages.send.useMutation({
    onSuccess: () => {
      setBody("");
      setAttachment(null);
      utils.caseMessages.list.invalidate({ caseId });
      utils.caseMessages.unreadByCase.invalidate();
      onSent?.();
    },
    onError: (err) => toast.error(err.message ?? "Send failed"),
  });

  const canSend =
    !sendMut.isPending && (body.trim().length > 0 || attachment !== null) && body.length <= 5000;

  const submit = () => {
    if (!canSend) return;
    sendMut.mutate({ caseId, body: body.trim() || "(attachment)", documentId: attachment?.id });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="space-y-2 border-t p-3">
      {attachment && (
        <div className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs">
          <Paperclip className="size-3" aria-hidden />
          <span>{attachment.filename}</span>
          <button
            type="button"
            onClick={() => setAttachment(null)}
            aria-label="Remove attachment"
          >
            <X className="size-3 text-muted-foreground hover:text-red-600" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => setAttachOpen(true)}
          className="rounded p-2 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          aria-label="Attach document"
        >
          <Paperclip className="size-4" />
        </button>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Reply…"
          maxLength={5000}
          className="min-h-[60px] flex-1 resize-none"
        />
        <Button onClick={submit} disabled={!canSend}>
          <Send className="mr-1 size-3.5" aria-hidden /> Send
        </Button>
      </div>
      <AttachDocumentModal
        open={attachOpen}
        onOpenChange={setAttachOpen}
        caseId={caseId}
        onSelect={(d) => setAttachment(d)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/message-composer.tsx
git commit -m "feat(2.3.1): message composer (Enter sends, Shift+Enter newline, paperclip attach)"
```

---

### Task 10: Messages tab (lawyer-side) with SSE subscription + markRead

**Files:**
- Create: `src/components/cases/messages-tab.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/cases/messages-tab.tsx
"use client";

import * as React from "react";
import { format, isSameDay } from "date-fns";
import { trpc } from "@/lib/trpc";
import { useUser } from "@clerk/nextjs";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MessagesTabProps {
  caseId: string;
}

export function MessagesTab({ caseId }: MessagesTabProps) {
  const utils = trpc.useUtils();
  const { user } = useUser();
  const currentClerkId = user?.id;
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { data, isLoading } = trpc.caseMessages.list.useQuery({ caseId });
  const markReadMut = trpc.caseMessages.markRead.useMutation({
    onSuccess: () => utils.caseMessages.unreadByCase.invalidate(),
  });

  // Mark read on tab mount + on visibility change to visible.
  React.useEffect(() => {
    markReadMut.mutate({ caseId });
    const onVis = () => {
      if (document.visibilityState === "visible") markReadMut.mutate({ caseId });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // SSE: live new messages while tab is open.
  trpc.caseMessages.onNewMessage.useSubscription(
    { caseId },
    {
      enabled: true,
      onData: () => {
        utils.caseMessages.list.invalidate({ caseId });
        utils.caseMessages.unreadByCase.invalidate();
      },
    },
  );

  // Auto-scroll to bottom on new messages.
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [data?.messages.length]);

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading messages…</p>;

  // The list query returns newest-first; render oldest-first for chat UX.
  const messages = data?.messages ? [...data.messages].reverse() : [];

  // Group by day for separators.
  const groups: Array<{ date: Date; items: typeof messages }> = [];
  for (const m of messages) {
    const t = typeof m.createdAt === "string" ? new Date(m.createdAt) : (m.createdAt as Date);
    const head = groups[groups.length - 1];
    if (head && isSameDay(head.date, t)) head.items.push(m);
    else groups.push({ date: t, items: [m] });
  }

  return (
    <Card className="flex h-[640px] flex-col">
      <CardHeader className="pb-2">
        <CardTitle>Messages</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 min-h-0 flex-col p-0">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {groups.length === 0 ? (
            <p className="mt-12 text-center text-sm text-muted-foreground">
              No messages yet. Send the first one below.
            </p>
          ) : (
            groups.map((g, i) => (
              <div key={i} className="space-y-2">
                <div className="my-3 flex items-center gap-2">
                  <div className="flex-1 border-t" />
                  <span className="text-xs text-muted-foreground">{format(g.date, "EEE, MMM d")}</span>
                  <div className="flex-1 border-t" />
                </div>
                {g.items.map((m) => {
                  // currentClerkId is from Clerk; match against the lawyer author by joining
                  // user.clerkId server-side would be ideal, but for MVP the visual cue (right
                  // align for any lawyer-authored bubble matching the current session lawyer)
                  // can be approximated: every lawyer message we sent in this session is "mine".
                  // For correctness, the list query SHOULD also return the lawyer author's
                  // clerkId. Until then, treat all lawyer-authored messages as "mine" if the
                  // viewer is a lawyer (right rail). This is acceptable single-lawyer-per-case
                  // approximation for MVP.
                  const isMine = m.authorType === "lawyer";
                  return <MessageBubble key={m.id} message={m as any} isMine={isMine} />;
                })}
              </div>
            ))
          )}
        </div>
        <MessageComposer caseId={caseId} />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/messages-tab.tsx
git commit -m "feat(2.3.1): lawyer-side Messages tab (SSE subscription, day separators, markRead)"
```

---

## Chunk 5 — Integration into Existing Surfaces

### Task 11: Mount Messages tab in case detail page

**Files:**
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Add tab to the TABS array**

Read the file. Find the TABS array (per 2.2.1 / 2.2.3 memory: pages have a TABS array of `{key, label, render}`). Append a Messages tab:

```tsx
import { MessagesTab } from "@/components/cases/messages-tab";

// Inside the TABS array (after Documents or wherever fits the existing flow):
{
  key: "messages",
  label: "Messages",
  render: () => <MessagesTab caseId={caseId} />,
},
```

(Adapt prop names to whatever the existing TABS pattern uses.)

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success; case page still compiles with new tab.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(app)/cases/[id]/page.tsx'
git commit -m "feat(2.3.1): mount Messages tab on case detail page"
```

---

### Task 12: Sidebar badge + per-case dot

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/(app)/cases/page.tsx` (or wherever the cases list is rendered)

- [ ] **Step 1: Add unread badge to Cases nav item in sidebar**

Read `src/components/layout/sidebar.tsx`. Find the Cases nav entry. Modify the rendering to include a badge driven by `trpc.caseMessages.unreadByCase`:

```tsx
"use client";
// ...existing imports...
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";

// Inside the sidebar component:
const { data: unreadData } = trpc.caseMessages.unreadByCase.useQuery(
  undefined,
  { refetchInterval: 30_000, refetchOnWindowFocus: true },
);
const unreadCases = unreadData?.count ?? 0;

// Render the Cases link with optional badge:
<Link href="/cases" className="...">
  <Briefcase className="size-4" /> Cases
  {unreadCases > 0 && (
    <Badge variant="destructive" className="ml-auto">
      {unreadCases > 9 ? "9+" : unreadCases}
    </Badge>
  )}
</Link>
```

(Adapt to actual sidebar.tsx structure. If sidebar is a Server Component, the trpc query call must be hoisted into a wrapping client subcomponent. Read the file to determine.)

- [ ] **Step 2: Add per-case dot on /cases list**

Read `src/app/(app)/cases/page.tsx`. Find where each case card is rendered. Add:

```tsx
const { data: unreadByCase } = trpc.caseMessages.unreadByCase.useQuery();
const unreadSet = new Set((unreadByCase?.byCase ?? []).map((u) => u.caseId));

// In the card render:
{unreadSet.has(c.id) && (
  <span className="absolute right-2 top-2 size-2 rounded-full bg-red-500" aria-label="Unread messages" />
)}
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/sidebar.tsx 'src/app/(app)/cases/page.tsx'
git commit -m "feat(2.3.1): unread badge on Cases nav + per-case dot on cases list"
```

---

## Chunk 6 — E2E + Final

### Task 13: E2E Playwright smoke

**Files:**
- Create: `e2e/case-messages.spec.ts`

- [ ] **Step 1: Implement**

```ts
// e2e/case-messages.spec.ts
//
// Smoke tests for /cases/[id]?tab=messages (Phase 2.3.1).
// Mirrors e2e/research.spec.ts convention: no Clerk bypass; status<500
// + body-visible. Interactive flows (send/receive/SSE) covered by manual UAT.

import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

test.describe("Case messages — smoke tests", () => {
  test("/cases/[id]?tab=messages returns <500 for unknown case (auth-gated)", async ({ page }) => {
    const res = await page.goto(`/cases/${FAKE_UUID}?tab=messages`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/case-messages.spec.ts
git commit -m "test(2.3.1): E2E smoke for /cases/[id]?tab=messages"
```

---

### Task 14: Final validation + memory + push + PR

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: EXIT=0.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all PASS (count = previous baseline + new tests from Tasks 3, 4, 5).

- [ ] **Step 3: Production build**

Run: `npm run build 2>&1 | tail -15`
Expected: EXIT=0.

- [ ] **Step 4: Update memory**

Edit `~/.claude/projects/-Users-fedorkaspirovich-ClearTerms/memory/MEMORY.md` and add:

```
- [project_231_execution.md](project_231_execution.md) — 2.3.1 Lawyer-Side Case Messaging: SHIPPED <date>, branch feature/2.3.1-lawyer-messaging. PR pending.
```

Create `project_231_execution.md` mirroring `project_224_execution.md` structure: status, spec/plan paths, brainstorm decisions, commit list, deviations, pending items, resume prompt.

- [ ] **Step 5: Push branch**

```bash
git push -u origin feature/2.3.1-lawyer-messaging
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --base main --title "Phase 2.3.1 — Lawyer-Side Case Messaging" --body "$(cat <<'EOF'
## Summary
- Adds lawyer-side Messages tab on case detail (mirror of 2.1.8 portal tab).
- Real-time delivery via SSE subscription + Inngest broadcaster.
- Last-seen unread tracking per (case, user); sidebar Cases nav badge counts cases with unread.
- Document attachments via existing case documents picker (no new upload flow).
- Notification type `case_message_received` flows through existing handler.

## What's wired
- `caseMessages.*` tRPC sub-router: list, send, markRead, unreadByCase, attachableDocuments, onNewMessage (SSE).
- New table `case_message_reads` (lawyer last-seen). Migration 0012.
- ALTER `case_messages.document_id` for attachments.
- `case-message-broadcast` Inngest function: fans out per-recipient notifications + emits to in-process pubsub.
- Portal-messages.send patched to fire the same `messaging/case_message.created` event so lawyers see client messages.
- Per-case unread dot on /cases list page.

## Verification
- TypeScript: clean
- Tests: all pass
- Build: success

## Test plan
- [ ] Lawyer sends → portal sees within ~3s.
- [ ] Client sends → lawyer's open tab updates within ~3s; bell + nav badge increment.
- [ ] Open Messages tab → markRead clears nav badge for that case.
- [ ] Per-case dot clears after open.
- [ ] Attach document picker filters by case; cross-case attach rejected with 400.
- [ ] Composer: Enter sends, Shift+Enter newline, empty Send disabled, >5000 disabled.
- [ ] Optimistic + retry on network failure.
- [ ] Notification preferences: disable email → in-app fires but no email.
- [ ] Deep-link from bell notification opens scrolled to bottom.

## Known limitations
- Single-process pub/sub (in-memory EventEmitter). Multi-process scaling needs Postgres LISTEN/NOTIFY follow-up.
- "isMine" detection in messages tab uses lawyer-authored proxy (no Clerk join in list query yet) — acceptable for single-lawyer-per-case MVP; refine when multiple lawyers share a case actively.
- Per-message read receipts deferred (Q4).
- Multi-attach + drag-drop upload deferred (Q3).
- Markdown / templates / typing indicators / edit-delete all deferred to follow-up phases.

## SSE deployment caveat
Requires Vercel Fluid Compute (or self-hosted Node). On classic serverless, fall back to `refetchInterval: 5000` polling.
EOF
)"
```

- [ ] **Step 7: Final commit if needed**

```bash
git status
# Memory file is outside the repo; nothing to commit.
```

---

## Self-Review Notes

**Spec coverage:** Each spec section maps to tasks:
- §3 Architecture → reuse map embedded in plan header.
- §4 Data model → Tasks 1, 2.
- §5 Backend → Tasks 3 (pubsub), 4 (service), 5 (router incl. SSE), 6 (Inngest broadcaster + portal patch).
- §6 UI → Tasks 7 (bubble), 8 (attach modal), 9 (composer), 10 (tab), 11 (mount), 12 (badge + dot).
- §7 Test plan → Tasks 3, 4, 5 (unit + integration); Task 13 (E2E).
- §8 Acceptance criteria → manual UAT in PR.
- §9 UPL → no new surface area.
- §10 Migration → Task 2.
- §11 SSE deploy caveat → noted in PR body Task 14.
- §12 Open items → resolved in plan preamble.

**Placeholder scan:** None present in committed plan steps. Two acknowledged "follow-up" notes (download endpoint maybe missing, isMine approximation) are explicit and survivable for MVP.

**Type consistency:** `case_message_received` payload shape consistent across notification-types, handler, and broadcaster. `caseMessages.*` procedure signatures consistent across router, service, and UI hook calls. `messagingPubsub.emit/on` consistent across pubsub.ts, broadcaster, and router subscription.

---

## Notes for executor

- 2.1.8 set the precedent for portal-side messaging UI. Read `src/components/portal/case-messages-tab.tsx` for visual style cues.
- 2.2.3 introduced subscription pattern; `src/hooks/use-research-stream.ts` is the canonical SSE hook reference.
- Don't break the portal flow — `portal-messages.ts` keeps its existing endpoints; only ADDS an Inngest dispatch.
- The new `messaging/case_message.created` event is the canonical "a message was created" trigger. Both portal-side and lawyer-side senders fire it.
- Single-process pubsub is fine for MVP; document the multi-process limitation in the PR body.
