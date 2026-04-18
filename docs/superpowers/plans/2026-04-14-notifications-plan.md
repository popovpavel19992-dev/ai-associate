# 2.1.7 Notifications Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full notification system — 16 types, 4 channels (in-app, email, web push, SSE), Inngest fan-out, user preferences, case muting.

**Architecture:** Inngest-centric fan-out. All triggers emit `notification/send` event → single `handle-notification` function checks preferences/mutes → fans out to enabled channels. SSE polls `notification_signals` table for real-time delivery. Web Push via VAPID/Service Worker.

**Tech Stack:** Drizzle ORM, tRPC, Inngest, Resend (email), web-push (npm), EventSource (SSE), Service Worker

---

## File Structure

### New Files (24)
| File | Responsibility |
|------|----------------|
| `src/server/db/schema/notifications.ts` | notifications + notification_signals tables |
| `src/server/db/schema/notification-preferences.ts` | notification_preferences table |
| `src/server/db/schema/notification-mutes.ts` | notification_mutes table |
| `src/server/db/schema/push-subscriptions.ts` | push_subscriptions table |
| `src/server/db/migrations/0007_notifications.sql` | Migration for all 5 tables |
| `src/server/trpc/routers/notifications.ts` | list, getUnreadCount, markRead, markAllRead, delete |
| `src/server/trpc/routers/notification-preferences.ts` | get, update, resetDefaults |
| `src/server/trpc/routers/notification-mutes.ts` | list, mute, unmute |
| `src/server/trpc/routers/push-subscriptions.ts` | subscribe, unsubscribe |
| `src/server/inngest/functions/handle-notification.ts` | Fan-out: preferences → in_app + email + push |
| `src/server/inngest/functions/notification-reminders.ts` | Cron: calendar event reminders |
| `src/server/inngest/functions/notification-overdue-check.ts` | Cron: overdue tasks + invoices |
| `src/lib/notification-types.ts` | Shared types, metadata shapes, category mapping |
| `src/server/services/push.ts` | web-push wrapper |
| `src/app/api/notifications/stream/route.ts` | SSE endpoint |
| `src/hooks/use-notification-stream.ts` | EventSource hook |
| `src/components/notifications/notification-bell.tsx` | Replace existing — DB-backed bell |
| `src/components/notifications/notification-list.tsx` | Paginated notification list |
| `src/components/notifications/notification-item.tsx` | Single notification row |
| `src/components/notifications/notification-preferences-matrix.tsx` | Type × channel toggle matrix |
| `src/components/notifications/case-mute-button.tsx` | Case-level mute toggle |
| `src/components/notifications/push-permission-prompt.tsx` | Push enable prompt |
| `src/app/(app)/notifications/page.tsx` | /notifications page |
| `src/app/(app)/settings/notifications/page.tsx` | /settings/notifications page |
| `public/sw.js` | Service Worker for push |

### Modified Files (15)
| File | Change |
|------|--------|
| `src/server/db/index.ts` | Register 4 new schema imports |
| `src/server/trpc/root.ts` | Register 4 new routers |
| `src/server/inngest/index.ts` | Register 3 new functions |
| `src/lib/env.ts` | Add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY |
| `src/server/services/email.ts` | Add 10 new email templates |
| `src/components/layout/sidebar.tsx` | Swap NotificationBell, add Notifications nav link |
| `src/app/(app)/cases/[id]/page.tsx` | Add CaseMuteButton |
| `src/server/inngest/functions/case-analyze.ts` | Emit case_ready + credits notifications |
| `src/server/inngest/functions/extract-document.ts` | Emit document_failed on failure |
| `src/server/inngest/functions/calendar-event-sync.ts` | Emit calendar_sync_failed |
| `src/server/trpc/routers/cases.ts` | Emit stage_changed |
| `src/server/trpc/routers/case-tasks.ts` | Emit task_assigned, task_completed |
| `src/server/trpc/routers/invoices.ts` | Emit invoice_sent, invoice_paid |
| `src/server/trpc/routers/team.ts` | Emit team_member_invited |
| `src/server/trpc/routers/case-members.ts` | Emit added_to_case |
| `src/app/api/webhooks/clerk/route.ts` | Emit team_member_joined |

---

## Chunk 1: Database Layer (Schema + Migration + Shared Types)

### Task 1: Shared notification types

**Files:**
- Create: `src/lib/notification-types.ts`

- [ ] **Step 1: Create notification types file**

```typescript
// src/lib/notification-types.ts

export const NOTIFICATION_TYPES = [
  "case_ready",
  "document_failed",
  "stage_changed",
  "task_assigned",
  "task_completed",
  "task_overdue",
  "invoice_sent",
  "invoice_paid",
  "invoice_overdue",
  "credits_low",
  "credits_exhausted",
  "team_member_invited",
  "team_member_joined",
  "added_to_case",
  "event_reminder",
  "calendar_sync_failed",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CATEGORIES = {
  cases: ["case_ready", "document_failed", "stage_changed", "task_assigned", "task_completed", "task_overdue"],
  billing: ["invoice_sent", "invoice_paid", "invoice_overdue", "credits_low", "credits_exhausted"],
  team: ["team_member_invited", "team_member_joined", "added_to_case"],
  calendar: ["event_reminder", "calendar_sync_failed"],
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export function getCategoryForType(type: NotificationType): NotificationCategory {
  for (const [category, types] of Object.entries(NOTIFICATION_CATEGORIES)) {
    if ((types as readonly string[]).includes(type)) return category as NotificationCategory;
  }
  return "cases";
}

export type NotificationMetadata = {
  case_ready: { caseName: string; documentCount: number };
  document_failed: { caseName: string; documentName: string; error: string };
  stage_changed: { caseName: string; fromStage: string; toStage: string };
  task_assigned: { caseName: string; taskTitle: string };
  task_completed: { caseName: string; taskTitle: string; completedBy: string };
  task_overdue: { caseName: string; taskTitle: string; dueDate: string };
  invoice_sent: { invoiceNumber: string; clientName: string; amount: string };
  invoice_paid: { invoiceNumber: string; clientName: string; amount: string };
  invoice_overdue: { invoiceNumber: string; clientName: string; amount: string; dueDate: string };
  credits_low: { creditsUsed: number; creditsLimit: number };
  credits_exhausted: { creditsLimit: number };
  team_member_invited: { inviterName: string; orgName: string };
  team_member_joined: { memberName: string };
  added_to_case: { caseName: string; addedBy: string };
  event_reminder: { eventTitle: string; startTime: string; minutesBefore: number };
  calendar_sync_failed: { providerName: string; error: string };
};

/** Inngest event payload for notification/send */
export interface NotificationSendEvent {
  userId?: string;
  recipientEmail?: string;
  orgId?: string;
  type: NotificationType;
  title: string;
  body: string;
  caseId?: string;
  actionUrl?: string;
  metadata?: NotificationMetadata[NotificationType];
  dedupKey?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/notification-types.ts
git commit -m "feat(notifications): add shared notification types and metadata shapes"
```

### Task 2: Drizzle schema files

**Files:**
- Create: `src/server/db/schema/notifications.ts`
- Create: `src/server/db/schema/notification-preferences.ts`
- Create: `src/server/db/schema/notification-mutes.ts`
- Create: `src/server/db/schema/push-subscriptions.ts`

- [ ] **Step 1: Create notifications schema**

```typescript
// src/server/db/schema/notifications.ts
import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";
import { cases } from "./cases";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    actionUrl: text("action_url"),
    dedupKey: text("dedup_key"),
    isRead: boolean("is_read").default(false).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notifications_user_read_created_idx").on(table.userId, table.isRead, table.createdAt),
    index("notifications_user_type_created_idx").on(table.userId, table.type, table.createdAt),
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
    uniqueIndex("notifications_dedup_key_unique")
      .on(table.dedupKey)
      .where(sql`dedup_key IS NOT NULL`),
  ],
);

export const notificationSignals = pgTable("notification_signals", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastSignalAt: timestamp("last_signal_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Create notification-preferences schema**

```typescript
// src/server/db/schema/notification-preferences.ts
import { pgTable, uuid, text, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    notificationType: text("notification_type").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
  },
  (table) => [
    uniqueIndex("notification_prefs_user_type_channel_unique").on(
      table.userId,
      table.notificationType,
      table.channel,
    ),
  ],
);
```

- [ ] **Step 3: Create notification-mutes schema**

```typescript
// src/server/db/schema/notification-mutes.ts
import { pgTable, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";
import { cases } from "./cases";

export const notificationMutes = pgTable(
  "notification_mutes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notification_mutes_user_case_unique").on(table.userId, table.caseId),
  ],
);
```

- [ ] **Step 4: Create push-subscriptions schema**

```typescript
// src/server/db/schema/push-subscriptions.ts
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
    index("push_subscriptions_user_idx").on(table.userId),
  ],
);
```

- [ ] **Step 5: Register schemas in db/index.ts**

Modify `src/server/db/index.ts` — add after line 14 (`import * as caseStages`):

```typescript
import * as notificationsSchema from "./schema/notifications";
import * as notificationPreferences from "./schema/notification-preferences";
import * as notificationMutes from "./schema/notification-mutes";
import * as pushSubscriptions from "./schema/push-subscriptions";
```

Add to schema object (after `...caseStages,`):

```typescript
    ...notificationsSchema,
    ...notificationPreferences,
    ...notificationMutes,
    ...pushSubscriptions,
```

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema/notifications.ts src/server/db/schema/notification-preferences.ts src/server/db/schema/notification-mutes.ts src/server/db/schema/push-subscriptions.ts src/server/db/index.ts
git commit -m "feat(notifications): add Drizzle schemas for 5 notification tables"
```

### Task 3: SQL migration

**Files:**
- Create: `src/server/db/migrations/0007_notifications.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Phase 2.1.7: Notifications
--
-- Adds notifications, notification_preferences, notification_mutes,
-- push_subscriptions, and notification_signals tables.
--
-- Dependencies: users, organizations, cases

-- notifications
CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid,
  "user_id" uuid NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "case_id" uuid,
  "action_url" text,
  "dedup_key" text,
  "is_read" boolean NOT NULL DEFAULT false,
  "read_at" timestamptz,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_case_id_cases_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "notifications_user_read_created_idx" ON "notifications" ("user_id", "is_read", "created_at" DESC);
CREATE INDEX "notifications_user_type_created_idx" ON "notifications" ("user_id", "type", "created_at" DESC);
CREATE INDEX "notifications_user_created_idx" ON "notifications" ("user_id", "created_at" DESC);
CREATE UNIQUE INDEX "notifications_dedup_key_unique" ON "notifications" ("dedup_key") WHERE dedup_key IS NOT NULL;

-- notification_preferences
CREATE TABLE "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "notification_type" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true
);

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "notification_prefs_user_type_channel_unique"
  ON "notification_preferences" ("user_id", "notification_type", "channel");

-- notification_mutes
CREATE TABLE "notification_mutes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_case_id_cases_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "notification_mutes_user_case_unique"
  ON "notification_mutes" ("user_id", "case_id");

-- push_subscriptions
CREATE TABLE "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "push_subscriptions_endpoint_unique" ON "push_subscriptions" ("endpoint");
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");

-- notification_signals
CREATE TABLE "notification_signals" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "last_signal_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "notification_signals" ADD CONSTRAINT "notification_signals_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

-- RLS policies (matching existing patterns from 0001_rls_policies.sql)
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notifications" ON "notifications"
  FOR ALL USING (user_id = get_current_user_id());

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notification_preferences" ON "notification_preferences"
  FOR ALL USING (user_id = get_current_user_id());

ALTER TABLE "notification_mutes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notification_mutes" ON "notification_mutes"
  FOR ALL USING (user_id = get_current_user_id());

ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_push_subscriptions" ON "push_subscriptions"
  FOR ALL USING (user_id = get_current_user_id());

ALTER TABLE "notification_signals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notification_signals" ON "notification_signals"
  FOR ALL USING (user_id = get_current_user_id());
```

- [ ] **Step 2: Commit**

```bash
git add src/server/db/migrations/0007_notifications.sql
git commit -m "feat(notifications): add migration for 5 notification tables"
```

### Task 4: Environment variables + web-push dependency

**Files:**
- Modify: `src/lib/env.ts`

- [ ] **Step 1: Install web-push**

```bash
npm install web-push
npm install -D @types/web-push
```

- [ ] **Step 2: Add VAPID env vars to env.ts**

In `src/lib/env.ts`, add after the `MICROSOFT_CLIENT_SECRET` line (line 33):

```typescript
  // Notifications (2.1.7)
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/env.ts package.json package-lock.json
git commit -m "feat(notifications): add web-push dependency and VAPID env vars"
```

---

## Chunk 2: tRPC Routers (4 new routers)

### Task 5: Notifications router

**Files:**
- Create: `src/server/trpc/routers/notifications.ts`

- [ ] **Step 1: Create notifications router**

```typescript
// src/server/trpc/routers/notifications.ts
import { z } from "zod/v4";
import { and, eq, desc, isNull, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { notifications } from "@/server/db/schema/notifications";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notification-types";

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        filter: z.enum(["all", "unread"]).default("all"),
        category: z.enum(["cases", "billing", "team", "calendar"]).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(notifications.userId, ctx.user.id),
        isNull(notifications.deletedAt),
      ];

      if (input.filter === "unread") {
        conditions.push(eq(notifications.isRead, false));
      }

      if (input.category) {
        const types = NOTIFICATION_CATEGORIES[input.category as NotificationCategory] as readonly string[];
        conditions.push(inArray(notifications.type, [...types]));
      }

      const rows = await ctx.db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [result] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.user.id),
          eq(notifications.isRead, false),
          isNull(notifications.deletedAt),
        ),
      );
    return result?.count ?? 0;
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)))
        .returning({ id: notifications.id });
      return { success: !!updated };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, ctx.user.id),
          eq(notifications.isRead, false),
          isNull(notifications.deletedAt),
        ),
      );
    return { success: true };
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(notifications)
        .set({ deletedAt: new Date() })
        .where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)))
        .returning({ id: notifications.id });
      return { success: !!updated };
    }),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/notifications.ts
git commit -m "feat(notifications): add notifications tRPC router"
```

### Task 6: Notification preferences router

**Files:**
- Create: `src/server/trpc/routers/notification-preferences.ts`

- [ ] **Step 1: Create notification-preferences router**

```typescript
// src/server/trpc/routers/notification-preferences.ts
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { notificationPreferences } from "@/server/db/schema/notification-preferences";
import { NOTIFICATION_TYPES, NOTIFICATION_CHANNELS } from "@/lib/notification-types";

export const notificationPreferencesRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, ctx.user.id));

    // Build matrix: default all ON, rows override
    const matrix: Record<string, Record<string, boolean>> = {};
    for (const type of NOTIFICATION_TYPES) {
      matrix[type] = {};
      for (const channel of NOTIFICATION_CHANNELS) {
        matrix[type][channel] = true; // default ON
      }
    }

    for (const row of rows) {
      if (matrix[row.notificationType]?.[row.channel] !== undefined) {
        matrix[row.notificationType][row.channel] = row.enabled;
      }
    }

    return matrix;
  }),

  update: protectedProcedure
    .input(
      z.object({
        type: z.enum(NOTIFICATION_TYPES),
        channel: z.enum(NOTIFICATION_CHANNELS),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(notificationPreferences)
        .values({
          userId: ctx.user.id,
          notificationType: input.type,
          channel: input.channel,
          enabled: input.enabled,
        })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.userId,
            notificationPreferences.notificationType,
            notificationPreferences.channel,
          ],
          set: { enabled: input.enabled },
        });
      return { success: true };
    }),

  resetDefaults: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.userId, ctx.user.id));
    return { success: true };
  }),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/notification-preferences.ts
git commit -m "feat(notifications): add notification-preferences tRPC router"
```

### Task 7: Notification mutes router

**Files:**
- Create: `src/server/trpc/routers/notification-mutes.ts`

- [ ] **Step 1: Create notification-mutes router**

```typescript
// src/server/trpc/routers/notification-mutes.ts
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { notificationMutes } from "@/server/db/schema/notification-mutes";
import { cases } from "@/server/db/schema/cases";

export const notificationMutesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: notificationMutes.id,
        caseId: notificationMutes.caseId,
        caseName: cases.name,
        createdAt: notificationMutes.createdAt,
      })
      .from(notificationMutes)
      .innerJoin(cases, eq(cases.id, notificationMutes.caseId))
      .where(eq(notificationMutes.userId, ctx.user.id));
  }),

  isMuted: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: notificationMutes.id })
        .from(notificationMutes)
        .where(
          and(
            eq(notificationMutes.userId, ctx.user.id),
            eq(notificationMutes.caseId, input.caseId),
          ),
        )
        .limit(1);
      return { muted: !!row };
    }),

  mute: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(notificationMutes)
        .values({ userId: ctx.user.id, caseId: input.caseId })
        .onConflictDoNothing();
      return { success: true };
    }),

  unmute: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(notificationMutes)
        .where(
          and(
            eq(notificationMutes.userId, ctx.user.id),
            eq(notificationMutes.caseId, input.caseId),
          ),
        );
      return { success: true };
    }),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/notification-mutes.ts
git commit -m "feat(notifications): add notification-mutes tRPC router"
```

### Task 8: Push subscriptions router

**Files:**
- Create: `src/server/trpc/routers/push-subscriptions.ts`

- [ ] **Step 1: Create push-subscriptions router**

```typescript
// src/server/trpc/routers/push-subscriptions.ts
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { pushSubscriptions } from "@/server/db/schema/push-subscriptions";

export const pushSubscriptionsRouter = router({
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(pushSubscriptions)
        .values({
          userId: ctx.user.id,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
        })
        .onConflictDoUpdate({
          target: [pushSubscriptions.endpoint],
          set: {
            userId: ctx.user.id,
            p256dh: input.p256dh,
            auth: input.auth,
          },
        });
      return { success: true };
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.userId, ctx.user.id)));
      return { success: true };
    }),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/push-subscriptions.ts
git commit -m "feat(notifications): add push-subscriptions tRPC router"
```

### Task 9: Register all 4 routers in root.ts

**Files:**
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Add imports and register routers**

In `src/server/trpc/root.ts`, add imports after line 21 (`import { invoicesRouter }`):

```typescript
import { notificationsRouter } from "./routers/notifications";
import { notificationPreferencesRouter } from "./routers/notification-preferences";
import { notificationMutesRouter } from "./routers/notification-mutes";
import { pushSubscriptionsRouter } from "./routers/push-subscriptions";
```

Add to appRouter object (after `invoices: invoicesRouter,`):

```typescript
  notifications: notificationsRouter,
  notificationPreferences: notificationPreferencesRouter,
  notificationMutes: notificationMutesRouter,
  pushSubscriptions: pushSubscriptionsRouter,
```

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/root.ts
git commit -m "feat(notifications): register 4 notification routers in root"
```

---

## Chunk 3: Inngest handle-notification + Email Templates + Push Service

### Task 10: Push service wrapper

**Files:**
- Create: `src/server/services/push.ts`

- [ ] **Step 1: Create push service**

```typescript
// src/server/services/push.ts
import webpush from "web-push";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID keys not set, push notifications disabled");
    return;
  }
  webpush.setVapidDetails("mailto:notifications@clearterms.ai", publicKey, privateKey);
  initialized = true;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
}

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<{ success: boolean; gone?: boolean }> {
  ensureInit();
  if (!initialized) return { success: false };

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon ?? "/icon-192.png",
        data: { url: payload.url },
      }),
    );
    return { success: true };
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 410 || statusCode === 404) {
      return { success: false, gone: true };
    }
    console.error("[push] Failed to send:", error);
    return { success: false };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/services/push.ts
git commit -m "feat(notifications): add web-push service wrapper"
```

### Task 11: Email templates (10 new)

**Files:**
- Modify: `src/server/services/email.ts`

- [ ] **Step 1: Add 10 new email template functions**

Append to `src/server/services/email.ts` before the `appUrl` function (before line 133):

```typescript
export async function sendStageChangedEmail(
  to: string,
  caseName: string,
  fromStage: string,
  toStage: string,
  caseId: string,
) {
  await sendEmail({
    to,
    subject: `Case stage updated: ${caseName}`,
    html: emailLayout(`
      <h1>Case stage updated</h1>
      <p>The stage for <strong>${escapeHtml(caseName)}</strong> has been changed from <strong>${escapeHtml(fromStage)}</strong> to <strong>${escapeHtml(toStage)}</strong>.</p>
      <a href="${appUrl(`/cases/${caseId}`)}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Case</a>
    `),
  });
}

export async function sendTaskAssignedEmail(
  to: string,
  taskTitle: string,
  caseName: string,
  caseId: string,
) {
  await sendEmail({
    to,
    subject: `New task assigned: ${taskTitle}`,
    html: emailLayout(`
      <h1>New task assigned to you</h1>
      <p>You've been assigned the task <strong>${escapeHtml(taskTitle)}</strong> in case <strong>${escapeHtml(caseName)}</strong>.</p>
      <a href="${appUrl(`/cases/${caseId}`)}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Task</a>
    `),
  });
}

export async function sendTaskOverdueEmail(
  to: string,
  taskTitle: string,
  caseName: string,
  caseId: string,
) {
  await sendEmail({
    to,
    subject: `Task overdue: ${taskTitle}`,
    html: emailLayout(`
      <h1>Task overdue</h1>
      <p>The task <strong>${escapeHtml(taskTitle)}</strong> in case <strong>${escapeHtml(caseName)}</strong> is past its due date.</p>
      <a href="${appUrl(`/cases/${caseId}`)}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Task</a>
    `),
  });
}

export async function sendInvoiceSentEmail(
  to: string,
  invoiceNumber: string,
  clientName: string,
  amount: string,
) {
  await sendEmail({
    to,
    subject: `Invoice ${invoiceNumber} sent`,
    html: emailLayout(`
      <h1>Invoice sent</h1>
      <p>Invoice <strong>${escapeHtml(invoiceNumber)}</strong> for <strong>${escapeHtml(clientName)}</strong> (${escapeHtml(amount)}) has been sent.</p>
      <a href="${appUrl("/invoices")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Invoices</a>
    `),
  });
}

export async function sendInvoicePaidEmail(
  to: string,
  invoiceNumber: string,
  clientName: string,
  amount: string,
) {
  await sendEmail({
    to,
    subject: `Invoice ${invoiceNumber} paid — ${amount}`,
    html: emailLayout(`
      <h1>Invoice paid</h1>
      <p>Invoice <strong>${escapeHtml(invoiceNumber)}</strong> from <strong>${escapeHtml(clientName)}</strong> has been marked as paid (${escapeHtml(amount)}).</p>
      <a href="${appUrl("/invoices")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Invoices</a>
    `),
  });
}

export async function sendInvoiceOverdueEmail(
  to: string,
  invoiceNumber: string,
  clientName: string,
  amount: string,
  dueDate: string,
) {
  await sendEmail({
    to,
    subject: `Invoice ${invoiceNumber} is overdue`,
    html: emailLayout(`
      <h1>Invoice overdue</h1>
      <p>Invoice <strong>${escapeHtml(invoiceNumber)}</strong> for <strong>${escapeHtml(clientName)}</strong> (${escapeHtml(amount)}) was due on ${escapeHtml(dueDate)} and is still unpaid.</p>
      <a href="${appUrl("/invoices")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Invoices</a>
    `),
  });
}

export async function sendEventReminderEmail(
  to: string,
  eventTitle: string,
  startTime: string,
  minutesBefore: number,
) {
  const timeLabel = minutesBefore >= 60 ? `${minutesBefore / 60} hour` : `${minutesBefore} minutes`;
  await sendEmail({
    to,
    subject: `Reminder: ${eventTitle} in ${timeLabel}`,
    html: emailLayout(`
      <h1>Event reminder</h1>
      <p><strong>${escapeHtml(eventTitle)}</strong> starts in ${timeLabel} (at ${escapeHtml(startTime)}).</p>
      <a href="${appUrl("/calendar")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Calendar</a>
    `),
  });
}

export async function sendTeamMemberInvitedEmail(
  to: string,
  inviterName: string,
  orgName: string,
) {
  await sendEmail({
    to,
    subject: `You've been invited to ${orgName}`,
    html: emailLayout(`
      <h1>You've been invited</h1>
      <p><strong>${escapeHtml(inviterName)}</strong> has invited you to join <strong>${escapeHtml(orgName)}</strong> on ClearTerms.</p>
      <p>Check your email for the Clerk invitation link to accept.</p>
    `),
  });
}

export async function sendTeamMemberJoinedEmail(
  to: string,
  memberName: string,
) {
  await sendEmail({
    to,
    subject: `${memberName} joined your team`,
    html: emailLayout(`
      <h1>New team member</h1>
      <p><strong>${escapeHtml(memberName)}</strong> has joined your organization on ClearTerms.</p>
      <a href="${appUrl("/settings/team")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Team</a>
    `),
  });
}

export async function sendAddedToCaseEmail(
  to: string,
  caseName: string,
  addedBy: string,
  caseId: string,
) {
  await sendEmail({
    to,
    subject: `You've been added to ${caseName}`,
    html: emailLayout(`
      <h1>Added to case</h1>
      <p><strong>${escapeHtml(addedBy)}</strong> has added you to the case <strong>${escapeHtml(caseName)}</strong>.</p>
      <a href="${appUrl(`/cases/${caseId}`)}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Case</a>
    `),
  });
}

export async function sendTaskCompletedEmail(
  to: string,
  taskTitle: string,
  caseName: string,
  completedBy: string,
  caseId: string,
) {
  await sendEmail({
    to,
    subject: `Task completed: ${taskTitle}`,
    html: emailLayout(`
      <h1>Task completed</h1>
      <p><strong>${escapeHtml(completedBy)}</strong> completed the task <strong>${escapeHtml(taskTitle)}</strong> in case <strong>${escapeHtml(caseName)}</strong>.</p>
      <a href="${appUrl(`/cases/${caseId}`)}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Case</a>
    `),
  });
}

export async function sendCalendarSyncFailedEmail(
  to: string,
  providerName: string,
) {
  await sendEmail({
    to,
    subject: `Calendar sync failed: ${providerName}`,
    html: emailLayout(`
      <h1>Calendar sync failed</h1>
      <p>Failed to sync an event to your <strong>${escapeHtml(providerName)}</strong> calendar. The event may not appear in your external calendar.</p>
      <a href="${appUrl("/settings/integrations")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">Check Integrations</a>
    `),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/services/email.ts
git commit -m "feat(notifications): add 12 new email templates"
```

### Task 12: handle-notification Inngest function

**Files:**
- Create: `src/server/inngest/functions/handle-notification.ts`

- [ ] **Step 1: Create handle-notification function**

```typescript
// src/server/inngest/functions/handle-notification.ts
import { eq, and, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { notifications, notificationSignals } from "../../db/schema/notifications";
import { notificationPreferences } from "../../db/schema/notification-preferences";
import { notificationMutes } from "../../db/schema/notification-mutes";
import { pushSubscriptions } from "../../db/schema/push-subscriptions";
import { users } from "../../db/schema/users";
import { sendPushNotification } from "../../services/push";
import * as email from "../../services/email";
import type { NotificationSendEvent, NotificationType, NotificationMetadata } from "@/lib/notification-types";

export const handleNotification = inngest.createFunction(
  {
    id: "handle-notification",
    retries: 2,
    triggers: [{ event: "notification/send" }],
  },
  async ({ event, step }) => {
    const data = event.data as NotificationSendEvent;

    // Email-only path (e.g., team_member_invited — no userId)
    if (!data.userId && data.recipientEmail) {
      await step.run("send-email-only", async () => {
        await dispatchEmail(data.type, data.recipientEmail!, data.metadata, data.actionUrl);
      });
      return { channel: "email-only" };
    }

    if (!data.userId) return { skipped: true, reason: "no userId or recipientEmail" };

    // Load user preferences for this type
    const prefs = await step.run("load-preferences", async () => {
      const rows = await db
        .select({ channel: notificationPreferences.channel, enabled: notificationPreferences.enabled })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, data.userId!),
            eq(notificationPreferences.notificationType, data.type),
          ),
        );

      // Default all ON — rows override
      const channels = { in_app: true, email: true, push: true };
      for (const row of rows) {
        if (row.channel in channels) {
          channels[row.channel as keyof typeof channels] = row.enabled;
        }
      }
      return channels;
    });

    // Check case mute
    if (data.caseId) {
      const muted = await step.run("check-case-mute", async () => {
        const [row] = await db
          .select({ id: notificationMutes.id })
          .from(notificationMutes)
          .where(
            and(
              eq(notificationMutes.userId, data.userId!),
              eq(notificationMutes.caseId, data.caseId!),
            ),
          )
          .limit(1);
        return !!row;
      });

      if (muted) return { skipped: true, reason: "case muted" };
    }

    const results: Record<string, string> = {};

    // In-app channel
    if (prefs.in_app) {
      await step.run("insert-in-app", async () => {
        // If dedupKey, use ON CONFLICT to skip duplicates
        if (data.dedupKey) {
          await db
            .insert(notifications)
            .values({
              orgId: data.orgId ?? null,
              userId: data.userId!,
              type: data.type,
              title: data.title,
              body: data.body,
              caseId: data.caseId ?? null,
              actionUrl: data.actionUrl ?? null,
              dedupKey: data.dedupKey,
            })
            .onConflictDoNothing();
        } else {
          await db.insert(notifications).values({
            orgId: data.orgId ?? null,
            userId: data.userId!,
            type: data.type,
            title: data.title,
            body: data.body,
            caseId: data.caseId ?? null,
            actionUrl: data.actionUrl ?? null,
          });
        }

        // Signal for SSE
        await db
          .insert(notificationSignals)
          .values({ userId: data.userId! })
          .onConflictDoUpdate({
            target: [notificationSignals.userId],
            set: { lastSignalAt: new Date() },
          });
      });
      results.in_app = "sent";
    }

    // Email channel
    if (prefs.email) {
      await step.run("send-email", async () => {
        const [user] = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, data.userId!))
          .limit(1);
        if (!user) return;

        await dispatchEmail(data.type, user.email, data.metadata, data.actionUrl);
      });
      results.email = "sent";
    }

    // Push channel
    if (prefs.push) {
      await step.run("send-push", async () => {
        const subs = await db
          .select()
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, data.userId!));

        for (const sub of subs) {
          const result = await sendPushNotification(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            { title: data.title, body: data.body, url: data.actionUrl },
          );

          if (result.gone) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          }
        }
      });
      results.push = "sent";
    }

    return results;
  },
);

async function dispatchEmail(
  type: NotificationType,
  toEmail: string,
  metadata: NotificationSendEvent["metadata"],
  actionUrl?: string,
) {
  const m = metadata as Record<string, unknown> | undefined;
  if (!m) return;

  switch (type) {
    case "case_ready":
      await email.sendCaseReadyEmail(
        toEmail,
        (m as NotificationMetadata["case_ready"]).caseName,
        actionUrl?.replace("/cases/", "") ?? "",
      );
      break;
    case "document_failed":
      await email.sendDocumentFailedEmail(
        toEmail,
        (m as NotificationMetadata["document_failed"]).caseName,
        (m as NotificationMetadata["document_failed"]).documentName,
        actionUrl?.replace("/cases/", "") ?? "",
      );
      break;
    case "stage_changed": {
      const meta = m as NotificationMetadata["stage_changed"];
      await email.sendStageChangedEmail(toEmail, meta.caseName, meta.fromStage, meta.toStage, actionUrl?.replace("/cases/", "") ?? "");
      break;
    }
    case "task_assigned": {
      const meta = m as NotificationMetadata["task_assigned"];
      await email.sendTaskAssignedEmail(toEmail, meta.taskTitle, meta.caseName, actionUrl?.replace("/cases/", "") ?? "");
      break;
    }
    case "task_overdue": {
      const meta = m as NotificationMetadata["task_overdue"];
      await email.sendTaskOverdueEmail(toEmail, meta.taskTitle, meta.caseName, actionUrl?.replace("/cases/", "") ?? "");
      break;
    }
    case "invoice_sent": {
      const meta = m as NotificationMetadata["invoice_sent"];
      await email.sendInvoiceSentEmail(toEmail, meta.invoiceNumber, meta.clientName, meta.amount);
      break;
    }
    case "invoice_paid": {
      const meta = m as NotificationMetadata["invoice_paid"];
      await email.sendInvoicePaidEmail(toEmail, meta.invoiceNumber, meta.clientName, meta.amount);
      break;
    }
    case "invoice_overdue": {
      const meta = m as NotificationMetadata["invoice_overdue"];
      await email.sendInvoiceOverdueEmail(toEmail, meta.invoiceNumber, meta.clientName, meta.amount, meta.dueDate);
      break;
    }
    case "credits_low": {
      const meta = m as NotificationMetadata["credits_low"];
      await email.sendCreditsLowEmail(toEmail, meta.creditsUsed, meta.creditsLimit);
      break;
    }
    case "credits_exhausted":
      await email.sendCreditsExhaustedEmail(toEmail);
      break;
    case "team_member_invited": {
      const meta = m as NotificationMetadata["team_member_invited"];
      await email.sendTeamMemberInvitedEmail(toEmail, meta.inviterName, meta.orgName);
      break;
    }
    case "team_member_joined": {
      const meta = m as NotificationMetadata["team_member_joined"];
      await email.sendTeamMemberJoinedEmail(toEmail, meta.memberName);
      break;
    }
    case "added_to_case": {
      const meta = m as NotificationMetadata["added_to_case"];
      await email.sendAddedToCaseEmail(toEmail, meta.caseName, meta.addedBy, actionUrl?.replace("/cases/", "") ?? "");
      break;
    }
    case "event_reminder": {
      const meta = m as NotificationMetadata["event_reminder"];
      await email.sendEventReminderEmail(toEmail, meta.eventTitle, meta.startTime, meta.minutesBefore);
      break;
    }
    case "calendar_sync_failed": {
      const meta = m as NotificationMetadata["calendar_sync_failed"];
      await email.sendCalendarSyncFailedEmail(toEmail, meta.providerName);
      break;
    }
    case "task_completed": {
      const meta = m as NotificationMetadata["task_completed"];
      await email.sendTaskCompletedEmail(toEmail, meta.taskTitle, meta.caseName, meta.completedBy, actionUrl?.replace("/cases/", "") ?? "");
      break;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/handle-notification.ts
git commit -m "feat(notifications): add handle-notification Inngest fan-out function"
```

---

## Chunk 4: Inngest Cron Functions (Reminders + Overdue)

### Task 13: notification-reminders cron function

**Files:**
- Create: `src/server/inngest/functions/notification-reminders.ts`

- [ ] **Step 1: Create notification-reminders function**

```typescript
// src/server/inngest/functions/notification-reminders.ts
import { and, gte, lte, eq, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { caseCalendarEvents } from "../../db/schema/case-calendar-events";
import { caseMembers } from "../../db/schema/case-members";
import { cases } from "../../db/schema/cases";
import type { NotificationSendEvent } from "@/lib/notification-types";

export const notificationReminders = inngest.createFunction(
  {
    id: "notification-reminders",
    triggers: [{ cron: "*/5 * * * *" }], // Every 5 minutes
  },
  async ({ step }) => {
    const windows = [
      { minutes: 15, label: "15min" },
      { minutes: 60, label: "1hr" },
    ];

    let emitted = 0;

    for (const window of windows) {
      const events = await step.run(`scan-${window.label}`, async () => {
        const now = new Date();
        const windowStart = new Date(now.getTime() + (window.minutes - 2.5) * 60_000);
        const windowEnd = new Date(now.getTime() + (window.minutes + 2.5) * 60_000);

        return db
          .select({
            id: caseCalendarEvents.id,
            title: caseCalendarEvents.title,
            startsAt: caseCalendarEvents.startsAt,
            caseId: caseCalendarEvents.caseId,
            userId: caseCalendarEvents.userId,
          })
          .from(caseCalendarEvents)
          .where(
            and(
              gte(caseCalendarEvents.startsAt, windowStart),
              lte(caseCalendarEvents.startsAt, windowEnd),
            ),
          );
      });

      for (const event of events) {
        // Get all case members as attendees
        const recipients = await step.run(`recipients-${event.id}-${window.label}`, async () => {
          const members = await db
            .select({ userId: caseMembers.userId })
            .from(caseMembers)
            .where(eq(caseMembers.caseId, event.caseId));

          // Include event creator if not already a member
          const userIds = new Set(members.map((m) => m.userId));
          userIds.add(event.userId);
          return Array.from(userIds);
        });

        for (const userId of recipients) {
          await step.run(`emit-${event.id}-${window.label}-${userId}`, async () => {
            const startTime = new Date(event.startsAt).toLocaleString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });

            await inngest.send({
              name: "notification/send",
              data: {
                userId,
                type: "event_reminder",
                title: `Reminder: ${event.title}`,
                body: `${event.title} starts in ${window.minutes >= 60 ? "1 hour" : `${window.minutes} minutes`}`,
                caseId: event.caseId,
                actionUrl: "/calendar",
                dedupKey: `event_reminder:${event.id}:${window.label}:${userId}`,
                metadata: {
                  eventTitle: event.title,
                  startTime,
                  minutesBefore: window.minutes,
                },
              } satisfies NotificationSendEvent,
            });
          });
          emitted++;
        }
      }
    }

    return { emitted };
  },
);
```

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/notification-reminders.ts
git commit -m "feat(notifications): add notification-reminders cron function"
```

### Task 14: notification-overdue-check cron function

**Files:**
- Create: `src/server/inngest/functions/notification-overdue-check.ts`

- [ ] **Step 1: Create notification-overdue-check function**

```typescript
// src/server/inngest/functions/notification-overdue-check.ts
import { and, eq, lt, ne, isNotNull, isNull } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { caseTasks } from "../../db/schema/case-tasks";
import { cases } from "../../db/schema/cases";
import { invoices } from "../../db/schema/invoices";
import { clients } from "../../db/schema/clients";
import { users } from "../../db/schema/users";
import { organizations } from "../../db/schema/organizations";
import type { NotificationSendEvent } from "@/lib/notification-types";

export const notificationOverdueCheck = inngest.createFunction(
  {
    id: "notification-overdue-check",
    triggers: [{ cron: "0 9 * * *" }], // Daily at 9:00
  },
  async ({ step }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    let emitted = 0;

    // Overdue tasks
    const overdueTasks = await step.run("scan-overdue-tasks", async () => {
      return db
        .select({
          taskId: caseTasks.id,
          taskTitle: caseTasks.title,
          dueDate: caseTasks.dueDate,
          assignedTo: caseTasks.assignedTo,
          caseId: caseTasks.caseId,
          caseName: cases.name,
        })
        .from(caseTasks)
        .innerJoin(cases, eq(cases.id, caseTasks.caseId))
        .where(
          and(
            ne(caseTasks.status, "done"),
            isNotNull(caseTasks.dueDate),
            lt(caseTasks.dueDate, today),
            isNotNull(caseTasks.assignedTo),
          ),
        );
    });

    for (const task of overdueTasks) {
      if (!task.assignedTo) continue;
      await step.run(`emit-task-${task.taskId}`, async () => {
        await inngest.send({
          name: "notification/send",
          data: {
            userId: task.assignedTo!,
            type: "task_overdue",
            title: `Task overdue: ${task.taskTitle}`,
            body: `${task.taskTitle} in ${task.caseName} is past its due date`,
            caseId: task.caseId,
            actionUrl: `/cases/${task.caseId}`,
            dedupKey: `overdue:task:${task.taskId}:${todayStr}`,
            metadata: {
              caseName: task.caseName,
              taskTitle: task.taskTitle,
              dueDate: task.dueDate!.toISOString().slice(0, 10),
            },
          } satisfies NotificationSendEvent,
        });
      });
      emitted++;
    }

    // Overdue invoices
    const overdueInvoices = await step.run("scan-overdue-invoices", async () => {
      return db
        .select({
          invoiceId: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          dueDate: invoices.dueDate,
          totalCents: invoices.totalCents,
          orgId: invoices.orgId,
          userId: invoices.userId,
          clientName: clients.displayName,
        })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(
          and(
            eq(invoices.status, "sent"),
            isNotNull(invoices.dueDate),
            lt(invoices.dueDate, today),
          ),
        );
    });

    for (const inv of overdueInvoices) {
      // Notify org admins if org, otherwise the invoice creator
      const recipients = await step.run(`recipients-inv-${inv.invoiceId}`, async () => {
        if (inv.orgId) {
          const admins = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.orgId, inv.orgId!)));
          return admins
            .filter((u) => u.id)
            .map((u) => u.id);
        }
        return [inv.userId];
      });

      const amount = `$${(inv.totalCents / 100).toFixed(2)}`;
      const dueDate = inv.dueDate!.toISOString().slice(0, 10);

      for (const userId of recipients) {
        await step.run(`emit-inv-${inv.invoiceId}-${userId}`, async () => {
          await inngest.send({
            name: "notification/send",
            data: {
              userId,
              orgId: inv.orgId ?? undefined,
              type: "invoice_overdue",
              title: `Invoice ${inv.invoiceNumber} is overdue`,
              body: `Invoice ${inv.invoiceNumber} for ${inv.clientName} (${amount}) was due ${dueDate}`,
              actionUrl: "/invoices",
              dedupKey: `overdue:invoice:${inv.invoiceId}:${todayStr}`,
              metadata: {
                invoiceNumber: inv.invoiceNumber,
                clientName: inv.clientName,
                amount,
                dueDate,
              },
            } satisfies NotificationSendEvent,
          });
        });
        emitted++;
      }
    }

    return { emitted };
  },
);
```

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/notification-overdue-check.ts
git commit -m "feat(notifications): add overdue-check cron function"
```

### Task 15: Register 3 new Inngest functions

**Files:**
- Modify: `src/server/inngest/index.ts`

- [ ] **Step 1: Add imports and register**

In `src/server/inngest/index.ts`, add imports:

```typescript
import { handleNotification } from "./functions/handle-notification";
import { notificationReminders } from "./functions/notification-reminders";
import { notificationOverdueCheck } from "./functions/notification-overdue-check";
```

Add to the functions array: `handleNotification, notificationReminders, notificationOverdueCheck`

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/index.ts
git commit -m "feat(notifications): register 3 new Inngest functions"
```

---

## Chunk 5: Notification Emits in Existing Code

### Task 16: Emit from case-analyze.ts (case_ready + credits)

**Files:**
- Modify: `src/server/inngest/functions/case-analyze.ts`

- [ ] **Step 1: Add notification emits after analysis completes**

After the single-doc `mark-ready-single` step (line 148) and after the multi-doc `synthesize-brief` step (line 173), add a new step:

```typescript
    // Emit case_ready notification
    await step.run("notify-case-ready", async () => {
      const docCount = analyses.length;
      await inngest.send({
        name: "notification/send",
        data: {
          userId: caseRecord.userId,
          orgId: caseRecord.orgId ?? undefined,
          type: "case_ready",
          title: "Case analysis complete",
          body: `${caseRecord.name} — ${docCount} document${docCount > 1 ? "s" : ""} analyzed`,
          caseId,
          actionUrl: `/cases/${caseId}`,
          metadata: { caseName: caseRecord.name, documentCount: docCount },
        },
      });
    });
```

Also, add credit check notification emits. After the `notify-case-ready` step, add:

```typescript
    // Check credits and emit notifications if needed
    await step.run("check-credits", async () => {
      if (!caseRecord.orgId) return;
      const [org] = await db
        .select({ creditsUsedThisMonth: organizations.creditsUsedThisMonth, creditsLimit: organizations.creditsLimit, ownerUserId: organizations.ownerUserId })
        .from(organizations)
        .where(eq(organizations.id, caseRecord.orgId))
        .limit(1);
      if (!org) return;

      if (org.creditsUsedThisMonth >= org.creditsLimit) {
        await inngest.send({
          name: "notification/send",
          data: {
            userId: org.ownerUserId,
            orgId: caseRecord.orgId,
            type: "credits_exhausted",
            title: "Credits exhausted",
            body: `You've used all ${org.creditsLimit} monthly credits`,
            actionUrl: "/settings/billing",
            metadata: { creditsLimit: org.creditsLimit },
          },
        });
      } else if (org.creditsUsedThisMonth >= org.creditsLimit * 0.8) {
        await inngest.send({
          name: "notification/send",
          data: {
            userId: org.ownerUserId,
            orgId: caseRecord.orgId,
            type: "credits_low",
            title: "Credits running low",
            body: `${org.creditsUsedThisMonth} of ${org.creditsLimit} credits used`,
            actionUrl: "/settings/billing",
            metadata: { creditsUsed: org.creditsUsedThisMonth, creditsLimit: org.creditsLimit },
          },
        });
      }
    });
```

Add import at top: `import { organizations } from "../../db/schema/organizations";`

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/case-analyze.ts
git commit -m "feat(notifications): emit case_ready and credits notifications from case-analyze"
```

### Task 17: Emit from extract-document.ts (document_failed)

**Files:**
- Modify: `src/server/inngest/functions/extract-document.ts`

- [ ] **Step 1: Add document_failed notification in onFailure handler**

In `extract-document.ts`, modify the `onFailure` handler (lines 13-21) to also emit a notification:

```typescript
    onFailure: async ({ event }) => {
      const documentId = event.data.event.data.documentId as string;
      if (documentId) {
        await db
          .update(documents)
          .set({ status: "failed" })
          .where(eq(documents.id, documentId));

        // Emit document_failed notification
        const [doc] = await db
          .select({
            userId: documents.userId,
            filename: documents.filename,
            caseId: documents.caseId,
          })
          .from(documents)
          .where(eq(documents.id, documentId))
          .limit(1);

        if (doc) {
          const [caseRecord] = await db
            .select({ name: cases.name, orgId: cases.orgId })
            .from(cases)
            .where(eq(cases.id, doc.caseId))
            .limit(1);

          await inngest.send({
            name: "notification/send",
            data: {
              userId: doc.userId,
              orgId: caseRecord?.orgId ?? undefined,
              type: "document_failed",
              title: "Document processing failed",
              body: `${doc.filename} in ${caseRecord?.name ?? "Unknown case"} could not be processed`,
              caseId: doc.caseId,
              actionUrl: `/cases/${doc.caseId}`,
              metadata: {
                caseName: caseRecord?.name ?? "Unknown case",
                documentName: doc.filename,
                error: "Processing failed after retries",
              },
            },
          });
        }
      }
    },
```

Add imports: `import { cases } from "../../db/schema/cases";`

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/extract-document.ts
git commit -m "feat(notifications): emit document_failed from extract-document onFailure"
```

### Task 18: Emit from calendar-event-sync.ts (calendar_sync_failed)

**Files:**
- Modify: `src/server/inngest/functions/calendar-event-sync.ts`

- [ ] **Step 1: Add calendar_sync_failed notification in catch block**

In `calendar-event-sync.ts`, inside the catch block (line 212-233), after the `calendarSyncLog` upsert and before the `throw error`, add:

```typescript
          // Emit calendar_sync_failed notification
          await inngest.send({
            name: "notification/send",
            data: {
              userId,
              type: "calendar_sync_failed",
              title: "Calendar sync failed",
              body: `Failed to sync event to ${connection.provider} calendar`,
              actionUrl: "/settings/integrations",
              metadata: {
                providerName: connection.provider,
                error: error instanceof Error ? error.message : String(error),
              },
            },
          });
```

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/calendar-event-sync.ts
git commit -m "feat(notifications): emit calendar_sync_failed from calendar-event-sync"
```

### Task 19: Emit from tRPC mutations (cases, case-tasks, invoices, team, case-members)

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`
- Modify: `src/server/trpc/routers/case-tasks.ts`
- Modify: `src/server/trpc/routers/invoices.ts`
- Modify: `src/server/trpc/routers/team.ts`
- Modify: `src/server/trpc/routers/case-members.ts`

- [ ] **Step 1: cases.ts — emit stage_changed after changeStage transaction**

Add import at top of `cases.ts`: `import { inngest } from "@/server/inngest/client";` and `import { caseMembers } from "@/server/db/schema/case-members";`

After the transaction in `changeStage` (after `return result;` is prepared but before it's returned — line ~343), add:

```typescript
    // Emit stage_changed notification to all case members
    const members = await ctx.db
      .select({ userId: caseMembers.userId })
      .from(caseMembers)
      .where(eq(caseMembers.caseId, input.caseId));

    const recipientIds = new Set(members.map((m) => m.userId));
    recipientIds.add(caseRecord.userId); // case creator

    for (const userId of recipientIds) {
      if (userId === ctx.user.id) continue; // Don't notify the actor
      await inngest.send({
        name: "notification/send",
        data: {
          userId,
          orgId: caseRecord.orgId ?? undefined,
          type: "stage_changed",
          title: `Stage changed to ${newStage.name}`,
          body: `${caseRecord.name}: ${fromStageName ?? "None"} → ${newStage.name}`,
          caseId: input.caseId,
          actionUrl: `/cases/${input.caseId}`,
          metadata: {
            caseName: caseRecord.name,
            fromStage: fromStageName ?? "None",
            toStage: newStage.name,
          },
        },
      });
    }
```

- [ ] **Step 2: case-tasks.ts — emit task_assigned from toggleAssign and update, task_completed from update**

Add import at top of `case-tasks.ts`: `import { inngest } from "@/server/inngest/client";` and `import { users } from "@/server/db/schema/users";`

In `toggleAssign` (after `returning()` on line 156), before `return updated`:

```typescript
      // Emit task_assigned if assigning (not unassigning)
      if (newAssignee && newAssignee !== ctx.user.id) {
        const [caseRecord] = await ctx.db
          .select({ name: cases.name, orgId: cases.orgId })
          .from(cases)
          .where(eq(cases.id, task.caseId))
          .limit(1);

        await inngest.send({
          name: "notification/send",
          data: {
            userId: newAssignee,
            orgId: caseRecord?.orgId ?? undefined,
            type: "task_assigned",
            title: `Task assigned: ${updated.title}`,
            body: `You've been assigned "${updated.title}" in ${caseRecord?.name ?? "a case"}`,
            caseId: task.caseId,
            actionUrl: `/cases/${task.caseId}`,
            metadata: { caseName: caseRecord?.name ?? "", taskTitle: updated.title },
          },
        });
      }
```

In `update` mutation, after the `assignedTo` is set (after `returning()` on line 131), add task_assigned notification if `input.assignedTo` changed:

```typescript
      // Emit task_assigned if assignedTo changed to a new user
      if (input.assignedTo && input.assignedTo !== existing.assignedTo && input.assignedTo !== ctx.user.id) {
        const [caseRecord] = await ctx.db
          .select({ name: cases.name, orgId: cases.orgId })
          .from(cases)
          .where(eq(cases.id, existing.caseId))
          .limit(1);

        await inngest.send({
          name: "notification/send",
          data: {
            userId: input.assignedTo,
            orgId: caseRecord?.orgId ?? undefined,
            type: "task_assigned",
            title: `Task assigned: ${updated.title}`,
            body: `You've been assigned "${updated.title}" in ${caseRecord?.name ?? "a case"}`,
            caseId: existing.caseId,
            actionUrl: `/cases/${existing.caseId}`,
            metadata: { caseName: caseRecord?.name ?? "", taskTitle: updated.title },
          },
        });
      }
```

After the `task_completed` caseEvents insert (line 141), add:

```typescript
        // Emit task_completed notification to case lead
        const [caseRecord] = await ctx.db
          .select({ name: cases.name, orgId: cases.orgId, userId: cases.userId })
          .from(cases)
          .where(eq(cases.id, existing.caseId))
          .limit(1);

        // Find case lead
        const [lead] = await ctx.db
          .select({ userId: caseMembers.userId })
          .from(caseMembers)
          .where(and(eq(caseMembers.caseId, existing.caseId), eq(caseMembers.role, "lead")))
          .limit(1);

        const leadUserId = lead?.userId ?? caseRecord?.userId;
        if (leadUserId && leadUserId !== ctx.user.id) {
          await inngest.send({
            name: "notification/send",
            data: {
              userId: leadUserId,
              orgId: caseRecord?.orgId ?? undefined,
              type: "task_completed",
              title: `Task completed: ${updated.title}`,
              body: `${ctx.user.name} completed "${updated.title}" in ${caseRecord?.name ?? "a case"}`,
              caseId: existing.caseId,
              actionUrl: `/cases/${existing.caseId}`,
              metadata: {
                caseName: caseRecord?.name ?? "",
                taskTitle: updated.title,
                completedBy: ctx.user.name,
              },
            },
          });
        }
```

Note: `ctx.user.name` is available because the protectedProcedure ensures ctx.user is the full user record.

- [ ] **Step 3: invoices.ts — emit invoice_sent and invoice_paid**

Add imports at top of `invoices.ts`: `import { inngest } from "@/server/inngest/client";` and add `and, inArray` to the existing drizzle-orm import.

In `send` mutation (after `returning()` on line 290), before return:

```typescript
      // Emit invoice_sent notification to org admins
      const amount = `$${(updated.totalCents / 100).toFixed(2)}`;
      const [client] = await ctx.db
        .select({ displayName: clients.displayName })
        .from(clients)
        .where(eq(clients.id, updated.clientId))
        .limit(1);

      if (ctx.user.orgId) {
        const admins = await ctx.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.orgId, ctx.user.orgId), inArray(users.role, ["owner", "admin"])));

        for (const admin of admins) {
          if (admin.id === ctx.user.id) continue;
          await inngest.send({
            name: "notification/send",
            data: {
              userId: admin.id,
              orgId: ctx.user.orgId,
              type: "invoice_sent",
              title: `Invoice ${updated.invoiceNumber} sent`,
              body: `Invoice for ${client?.displayName ?? "client"} (${amount}) has been sent`,
              actionUrl: "/invoices",
              metadata: {
                invoiceNumber: updated.invoiceNumber,
                clientName: client?.displayName ?? "",
                amount,
              },
            },
          });
        }
      }
```

Add import: `import { users } from "@/server/db/schema/users";`

In `markPaid` mutation (after `returning()` on line 308), before return:

```typescript
      // Emit invoice_paid notification
      const amount = `$${(updated.totalCents / 100).toFixed(2)}`;
      const [client] = await ctx.db
        .select({ displayName: clients.displayName })
        .from(clients)
        .where(eq(clients.id, updated.clientId))
        .limit(1);

      if (ctx.user.orgId) {
        const admins = await ctx.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.orgId, ctx.user.orgId), inArray(users.role, ["owner", "admin"])));

        for (const admin of admins) {
          if (admin.id === ctx.user.id) continue;
          await inngest.send({
            name: "notification/send",
            data: {
              userId: admin.id,
              orgId: ctx.user.orgId,
              type: "invoice_paid",
              title: `Invoice ${updated.invoiceNumber} paid`,
              body: `Invoice for ${client?.displayName ?? "client"} (${amount}) marked as paid`,
              actionUrl: "/invoices",
              metadata: {
                invoiceNumber: updated.invoiceNumber,
                clientName: client?.displayName ?? "",
                amount,
              },
            },
          });
        }
      }
```

- [ ] **Step 4: team.ts — emit team_member_invited (email-only)**

Add import at top of `team.ts`: `import { inngest } from "@/server/inngest/client";`

In `invite` mutation (after `clerk.organizations.createOrganizationInvitation` on line 78), before return:

```typescript
      // Emit team_member_invited notification (email-only, no userId)
      const [orgRecord] = await ctx.db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, ctx.user.orgId!))
        .limit(1);

      await inngest.send({
        name: "notification/send",
        data: {
          recipientEmail: input.email,
          type: "team_member_invited",
          title: `You've been invited to ${orgRecord?.name ?? "an organization"}`,
          body: `${ctx.user.name} has invited you to join ${orgRecord?.name ?? "their organization"} on ClearTerms`,
          metadata: {
            inviterName: ctx.user.name,
            orgName: orgRecord?.name ?? "",
          },
        },
      });
```

- [ ] **Step 5: case-members.ts — emit added_to_case**

Add import at top of `case-members.ts`: `import { inngest } from "@/server/inngest/client";` and `import { cases } from "@/server/db/schema/cases";`

In `add` mutation (after `returning()` on line 58, after the conflict check), before return:

```typescript
      // Emit added_to_case notification
      const [caseRecord] = await ctx.db
        .select({ name: cases.name, orgId: cases.orgId })
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .limit(1);

      if (input.userId !== ctx.user.id) {
        await inngest.send({
          name: "notification/send",
          data: {
            userId: input.userId,
            orgId: caseRecord?.orgId ?? undefined,
            type: "added_to_case",
            title: `Added to case: ${caseRecord?.name ?? "a case"}`,
            body: `${ctx.user.name} added you to ${caseRecord?.name ?? "a case"}`,
            caseId: input.caseId,
            actionUrl: `/cases/${input.caseId}`,
            metadata: {
              caseName: caseRecord?.name ?? "",
              addedBy: ctx.user.name,
            },
          },
        });
      }
```

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/cases.ts src/server/trpc/routers/case-tasks.ts src/server/trpc/routers/invoices.ts src/server/trpc/routers/team.ts src/server/trpc/routers/case-members.ts
git commit -m "feat(notifications): emit notification/send from 5 tRPC routers"
```

### Task 20: Emit from Clerk webhook (team_member_joined)

**Files:**
- Modify: `src/app/api/webhooks/clerk/route.ts`

- [ ] **Step 1: Add team_member_joined notification in organizationMembership.created handler**

In the `organizationMembership.created` case (line 70-96), after the user update (line 94), before `break`:

```typescript
      // Emit team_member_joined notification to org admins
      const [newUser] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);

      if (newUser) {
        const admins = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.orgId, org.id));

        for (const admin of admins) {
          if (admin.id === user.id) continue; // Don't notify the person who joined
          await inngest.send({
            name: "notification/send",
            data: {
              userId: admin.id,
              orgId: org.id,
              type: "team_member_joined",
              title: `${newUser.name} joined your team`,
              body: `${newUser.name} has joined your organization`,
              actionUrl: "/settings/team",
              metadata: { memberName: newUser.name },
            },
          });
        }
      }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/webhooks/clerk/route.ts
git commit -m "feat(notifications): emit team_member_joined from Clerk webhook"
```

---

## Chunk 6: SSE Endpoint + useNotificationStream Hook

### Task 21: SSE API route

**Files:**
- Create: `src/app/api/notifications/stream/route.ts`

- [ ] **Step 1: Create SSE streaming endpoint**

```typescript
// src/app/api/notifications/stream/route.ts
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { notificationSignals } from "@/server/db/schema/notifications";

export const maxDuration = 300; // 5 min max on Vercel
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  const userId = user.id;

  const encoder = new TextEncoder();
  let lastSignalAt: Date | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Send retry directive
      controller.enqueue(encoder.encode("retry: 3000\n\n"));

      // Poll loop
      const interval = setInterval(async () => {
        try {
          const [signal] = await db
            .select({ lastSignalAt: notificationSignals.lastSignalAt })
            .from(notificationSignals)
            .where(eq(notificationSignals.userId, userId))
            .limit(1);

          if (signal && (!lastSignalAt || signal.lastSignalAt > lastSignalAt)) {
            lastSignalAt = signal.lastSignalAt;
            controller.enqueue(encoder.encode("event: notification\ndata: {}\n\n"));
          }
        } catch {
          // Swallow errors — connection will be cleaned up naturally
        }
      }, 2000);

      // Clean up on close
      const cleanup = () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      };

      // Close after maxDuration - 10s buffer
      setTimeout(cleanup, (maxDuration - 10) * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/notifications/stream/route.ts
git commit -m "feat(notifications): add SSE streaming endpoint"
```

### Task 22: useNotificationStream hook

**Files:**
- Create: `src/hooks/use-notification-stream.ts`

- [ ] **Step 1: Create useNotificationStream hook**

```typescript
// src/hooks/use-notification-stream.ts
"use client";

import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

export function useNotificationStream() {
  const utils = trpc.useUtils();
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;

      try {
        const es = new EventSource("/api/notifications/stream");
        eventSourceRef.current = es;

        es.addEventListener("notification", () => {
          utils.notifications.list.invalidate();
          utils.notifications.getUnreadCount.invalidate();
        });

        es.onerror = () => {
          // EventSource auto-reconnects via retry directive
          // If it fails completely, fall back to polling
          if (es.readyState === EventSource.CLOSED) {
            startFallbackPolling();
          }
        };

        // Clear fallback if SSE connects successfully
        es.onopen = () => {
          if (fallbackRef.current) {
            clearInterval(fallbackRef.current);
            fallbackRef.current = null;
          }
        };
      } catch {
        startFallbackPolling();
      }
    }

    function startFallbackPolling() {
      if (fallbackRef.current) return;
      fallbackRef.current = setInterval(() => {
        utils.notifications.getUnreadCount.invalidate();
      }, 30_000);
    }

    connect();

    return () => {
      mounted = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (fallbackRef.current) {
        clearInterval(fallbackRef.current);
        fallbackRef.current = null;
      }
    };
  }, [utils]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-notification-stream.ts
git commit -m "feat(notifications): add useNotificationStream SSE hook"
```

---

## Chunk 7: UI Components

### Task 23: Replace NotificationBell with DB-backed version

**Files:**
- Replace: `src/components/notifications/notification-bell.tsx` (new path)
- Modify: `src/components/layout/notification-bell.tsx` (old — will be replaced by import change)

- [ ] **Step 1: Create new DB-backed NotificationBell**

```typescript
// src/components/notifications/notification-bell.tsx
"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useNotificationStream } from "@/hooks/use-notification-stream";

export function NotificationBell() {
  useNotificationStream();

  const { data: unreadCount = 0 } = trpc.notifications.getUnreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: recent = [] } = trpc.notifications.list.useQuery(
    { limit: 5, filter: "all" },
    { refetchInterval: 30_000 },
  );
  const utils = trpc.useUtils();

  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.getUnreadCount.invalidate();
      utils.notifications.list.invalidate();
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="relative" />}>
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {recent.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No notifications
          </div>
        ) : (
          <>
            {recent.map((n) => (
              <DropdownMenuItem key={n.id} asChild>
                <Link
                  href={n.actionUrl ?? "/notifications"}
                  className="flex flex-col items-start gap-0.5 py-2"
                >
                  <span className={`text-sm font-medium ${n.isRead ? "text-muted-foreground" : ""}`}>
                    {n.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {n.body}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(new Date(n.createdAt))}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {unreadCount > 0 && (
              <DropdownMenuItem onSelect={() => markAllRead.mutate()}>
                <span className="w-full text-center text-sm">Mark all read</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href="/notifications" className="justify-center text-sm font-medium">
                View all notifications
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

- [ ] **Step 2: Update sidebar import**

In `src/components/layout/sidebar.tsx`, change line 24 from:
```typescript
import { NotificationBell } from "./notification-bell";
```
to:
```typescript
import { NotificationBell } from "@/components/notifications/notification-bell";
```

Also add Notifications nav link. In the `navItems` array (line 27-37), add after the Calendar entry:

```typescript
  { href: "/notifications", label: "Notifications", icon: Bell },
```

Add `Bell` to the lucide-react import (it's already imported — the existing Bell import comes from notification-bell, but since we're keeping it in sidebar, add it to the lucide import on line 6-18).

Wait — `Bell` is already imported in `notification-bell.tsx`. We need it in sidebar's navItems. Add it to the sidebar's lucide-react import:

In line 6-18, add `Bell` to the destructured imports from `lucide-react`.

- [ ] **Step 3: Commit**

```bash
git add src/components/notifications/notification-bell.tsx src/components/layout/sidebar.tsx
git commit -m "feat(notifications): replace NotificationBell with DB-backed version"
```

### Task 24: Notification list + item components

**Files:**
- Create: `src/components/notifications/notification-list.tsx`
- Create: `src/components/notifications/notification-item.tsx`

- [ ] **Step 1: Create notification-item component**

```typescript
// src/components/notifications/notification-item.tsx
"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

interface NotificationItemProps {
  notification: {
    id: string;
    type: string;
    title: string;
    body: string;
    actionUrl: string | null;
    isRead: boolean;
    createdAt: Date;
  };
}

export function NotificationItem({ notification }: NotificationItemProps) {
  const utils = trpc.useUtils();

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.getUnreadCount.invalidate();
    },
  });

  const deleteNotification = trpc.notifications.delete.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.getUnreadCount.invalidate();
    },
  });

  const content = (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors",
        notification.isRead
          ? "border-zinc-800 bg-transparent"
          : "border-zinc-700 bg-zinc-900",
      )}
      onClick={() => {
        if (!notification.isRead) markRead.mutate({ id: notification.id });
      }}
    >
      {!notification.isRead && (
        <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{notification.title}</p>
        <p className="text-sm text-muted-foreground">{notification.body}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatRelativeTime(new Date(notification.createdAt))}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          deleteNotification.mutate({ id: notification.id });
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );

  if (notification.actionUrl) {
    return (
      <Link href={notification.actionUrl} className="block">
        {content}
      </Link>
    );
  }

  return content;
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

- [ ] **Step 2: Create notification-list component**

```typescript
// src/components/notifications/notification-list.tsx
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { NotificationItem } from "./notification-item";
import { cn } from "@/lib/utils";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "cases", label: "Cases" },
  { key: "billing", label: "Billing" },
  { key: "team", label: "Team" },
  { key: "calendar", label: "Calendar" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export function NotificationList() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const utils = trpc.useUtils();

  const queryInput = {
    limit,
    offset,
    filter: filter === "unread" ? ("unread" as const) : ("all" as const),
    category: ["cases", "billing", "team", "calendar"].includes(filter)
      ? (filter as "cases" | "billing" | "team" | "calendar")
      : undefined,
  };

  const { data: notifications = [], isLoading } = trpc.notifications.list.useQuery(queryInput);

  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.getUnreadCount.invalidate();
    },
  });

  return (
    <div>
      {/* Filter tabs */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.key
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-white",
              )}
              onClick={() => { setFilter(f.key); setOffset(0); }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => markAllRead.mutate()}>
          Mark all read
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No notifications
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <NotificationItem key={n.id} notification={n} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {notifications.length === limit && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o + limit)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/notifications/notification-list.tsx src/components/notifications/notification-item.tsx
git commit -m "feat(notifications): add NotificationList and NotificationItem components"
```

### Task 25: Notifications page

**Files:**
- Create: `src/app/(app)/notifications/page.tsx`

- [ ] **Step 1: Create notifications page**

```typescript
// src/app/(app)/notifications/page.tsx
"use client";

import { NotificationList } from "@/components/notifications/notification-list";

export default function NotificationsPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Notifications</h1>
      <NotificationList />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/notifications/page.tsx
git commit -m "feat(notifications): add /notifications page"
```

### Task 26: Notification preferences matrix + settings page

**Files:**
- Create: `src/components/notifications/notification-preferences-matrix.tsx`
- Create: `src/app/(app)/settings/notifications/page.tsx`

- [ ] **Step 1: Create preferences matrix component**

```typescript
// src/components/notifications/notification-preferences-matrix.tsx
"use client";

import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CATEGORIES,
  type NotificationType,
  type NotificationChannel,
} from "@/lib/notification-types";

const TYPE_LABELS: Record<NotificationType, string> = {
  case_ready: "Case analysis complete",
  document_failed: "Document processing failed",
  stage_changed: "Case stage changed",
  task_assigned: "Task assigned",
  task_completed: "Task completed",
  task_overdue: "Task overdue",
  invoice_sent: "Invoice sent",
  invoice_paid: "Invoice paid",
  invoice_overdue: "Invoice overdue",
  credits_low: "Credits running low",
  credits_exhausted: "Credits exhausted",
  team_member_invited: "Team member invited",
  team_member_joined: "Team member joined",
  added_to_case: "Added to case",
  event_reminder: "Event reminder",
  calendar_sync_failed: "Calendar sync failed",
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: "In-App",
  email: "Email",
  push: "Push",
};

const CATEGORY_LABELS: Record<string, string> = {
  cases: "Cases",
  billing: "Billing",
  team: "Team",
  calendar: "Calendar",
};

export function NotificationPreferencesMatrix() {
  const utils = trpc.useUtils();
  const { data: matrix, isLoading } = trpc.notificationPreferences.get.useQuery();

  const update = trpc.notificationPreferences.update.useMutation({
    onSuccess: () => utils.notificationPreferences.get.invalidate(),
  });

  const resetDefaults = trpc.notificationPreferences.resetDefaults.useMutation({
    onSuccess: () => utils.notificationPreferences.get.invalidate(),
  });

  if (isLoading || !matrix) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(NOTIFICATION_CATEGORIES).map(([category, types]) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="text-lg">{CATEGORY_LABELS[category]}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="pb-2 text-left text-sm font-medium text-muted-foreground">
                      Notification
                    </th>
                    {NOTIFICATION_CHANNELS.map((ch) => (
                      <th key={ch} className="pb-2 text-center text-sm font-medium text-muted-foreground">
                        {CHANNEL_LABELS[ch]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {types.map((type) => (
                    <tr key={type} className="border-t border-zinc-800">
                      <td className="py-3 text-sm">{TYPE_LABELS[type as NotificationType]}</td>
                      {NOTIFICATION_CHANNELS.map((channel) => {
                        // team_member_invited is email-only
                        const disabled =
                          (type === "team_member_invited" && channel !== "email");
                        const checked = matrix[type]?.[channel] ?? true;

                        return (
                          <td key={channel} className="py-3 text-center">
                            <Switch
                              checked={disabled ? false : checked}
                              disabled={disabled || update.isPending}
                              onCheckedChange={(enabled) => {
                                update.mutate({
                                  type: type as NotificationType,
                                  channel,
                                  enabled,
                                });
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button variant="outline" onClick={() => resetDefaults.mutate()}>
        Reset to defaults
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Create settings/notifications page**

```typescript
// src/app/(app)/settings/notifications/page.tsx
"use client";

import { NotificationPreferencesMatrix } from "@/components/notifications/notification-preferences-matrix";
import { PushPermissionPrompt } from "@/components/notifications/push-permission-prompt";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotificationSettingsPage() {
  const utils = trpc.useUtils();
  const { data: mutedCases = [] } = trpc.notificationMutes.list.useQuery();
  const unmute = trpc.notificationMutes.unmute.useMutation({
    onSuccess: () => utils.notificationMutes.list.invalidate(),
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Notification Settings</h1>

      <div className="space-y-8">
        <PushPermissionPrompt />

        <NotificationPreferencesMatrix />

        {mutedCases.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Muted Cases</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {mutedCases.map((mc) => (
                  <div key={mc.id} className="flex items-center justify-between rounded-md border border-zinc-800 px-3 py-2">
                    <span className="text-sm">{mc.caseName}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => unmute.mutate({ caseId: mc.caseId })}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/notifications/notification-preferences-matrix.tsx src/app/\(app\)/settings/notifications/page.tsx
git commit -m "feat(notifications): add preferences matrix and settings page"
```

### Task 27: CaseMuteButton component

**Files:**
- Create: `src/components/notifications/case-mute-button.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Create CaseMuteButton**

```typescript
// src/components/notifications/case-mute-button.tsx
"use client";

import { BellOff, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface CaseMuteButtonProps {
  caseId: string;
}

export function CaseMuteButton({ caseId }: CaseMuteButtonProps) {
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.notificationMutes.isMuted.useQuery({ caseId });
  const muted = data?.muted ?? false;

  const mute = trpc.notificationMutes.mute.useMutation({
    onSuccess: () => utils.notificationMutes.isMuted.invalidate({ caseId }),
  });

  const unmute = trpc.notificationMutes.unmute.useMutation({
    onSuccess: () => utils.notificationMutes.isMuted.invalidate({ caseId }),
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isLoading || mute.isPending || unmute.isPending}
      onClick={() => (muted ? unmute.mutate({ caseId }) : mute.mutate({ caseId }))}
      className="gap-1.5"
    >
      {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      {muted ? "Muted" : "Mute"}
    </Button>
  );
}
```

- [ ] **Step 2: Add CaseMuteButton to case detail page**

In `src/app/(app)/cases/[id]/page.tsx`, add import:

```typescript
import { CaseMuteButton } from "@/components/notifications/case-mute-button";
```

Add the button in the tab navigation bar area (line ~121, in the `justify-between` div), after the tabs and before the stage selector:

```tsx
        <CaseMuteButton caseId={id} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/notifications/case-mute-button.tsx src/app/\(app\)/cases/\[id\]/page.tsx
git commit -m "feat(notifications): add CaseMuteButton to case detail page"
```

### Task 28: PushPermissionPrompt component

**Files:**
- Create: `src/components/notifications/push-permission-prompt.tsx`

- [ ] **Step 1: Create PushPermissionPrompt**

```typescript
// src/components/notifications/push-permission-prompt.tsx
"use client";

import { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

export function PushPermissionPrompt() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [registering, setRegistering] = useState(false);

  const subscribe = trpc.pushSubscriptions.subscribe.useMutation();

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  if (permission === "granted" || permission === "unsupported") return null;
  if (permission === "denied") {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Push notifications are blocked. Enable them in your browser settings to receive notifications when the tab is closed.
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleEnable = async () => {
    setRegistering(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result === "granted") {
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
          console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set");
          return;
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });

        const json = subscription.toJSON();
        if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
          await subscribe.mutateAsync({
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
          });
        }
      }
    } catch (err) {
      console.error("[push] Registration failed:", err);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-4">
        <Bell className="h-8 w-8 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm font-medium">Enable Push Notifications</p>
          <p className="text-sm text-muted-foreground">
            Receive notifications even when your browser tab is closed.
          </p>
        </div>
        <Button onClick={handleEnable} disabled={registering}>
          {registering ? "Enabling..." : "Enable"}
        </Button>
      </CardContent>
    </Card>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/notifications/push-permission-prompt.tsx
git commit -m "feat(notifications): add PushPermissionPrompt component"
```

### Task 29: Service Worker

**Files:**
- Create: `public/sw.js`

- [ ] **Step 1: Create service worker**

```javascript
// public/sw.js
self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: data.icon || "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.data?.url || "/" },
    };

    event.waitUntil(self.registration.showNotification(data.title, options));
  } catch (err) {
    console.error("[sw] Push parse error:", err);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add public/sw.js
git commit -m "feat(notifications): add service worker for web push"
```

### Task 30: Run migration

- [ ] **Step 1: Run migration against local database**

```bash
psql $DATABASE_URL -f src/server/db/migrations/0007_notifications.sql
```

- [ ] **Step 2: Build check**

```bash
npm run build
```

Fix any type errors that arise.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(notifications): resolve build errors"
```
