# 2.4.1 Filing Deadlines Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lawyer enters a trigger event on a case; FRCP rules engine auto-generates dependent deadlines with weekend/holiday shift; reminders fire via daily Inngest cron into existing notification infra; deadlines appear in a new case Deadlines tab AND the existing global `/calendar` via the shared `useCalendarItems` aggregator.

**Architecture:** Four new tables (`deadline_rules` catalog, `case_trigger_events`, `case_deadlines`, `court_holidays`). Pure `computeDeadlineDate` helper handles day math + holiday shift. `DeadlinesService` orchestrates create/update with auto-cascade + `manual_override` preservation. Cron-driven Inngest function inserts dedup-keyed notifications 7/3/1 days before + on due day + while overdue. UI: new Deadlines tab on case detail (mirrors Signatures/Emails split pane), extension of existing `useCalendarItems` hook to include deadlines as a 3rd source, settings page for rule catalog management.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, tRPC v11, Zod v4, Inngest (existing `createFunction` with `cron` trigger), `react-big-calendar` (already installed, used via existing `GlobalCalendar`), Vitest mock-db, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-23-filing-deadlines-calendar-design.md`

**Branch:** `feature/2.4.1-filing-deadlines-calendar` (spec committed at `e4419f4`).

**Key existing files (recon, trust these):**

- `src/server/lib/crypto.ts` — unused here, no secrets in this phase.
- `src/components/calendar/use-calendar-items.ts` — aggregates events + tasks via tRPC; we add a 3rd `trpc.deadlines.listForRange` query.
- `src/components/calendar/calendar-item-utils.ts` — `mergeToCalendarItems()` + `CalendarItem` type; we add a `"deadline"` source variant.
- `src/components/calendar/global-calendar.tsx` — global page at `/calendar`; consumes `useCalendarItems`. No changes needed (works via hook extension).
- `src/components/layout/sidebar.tsx` — `/calendar` already in nav at line 41. We add `/settings/deadline-rules` under Settings subsection.
- `src/server/inngest/functions/*.ts` — existing functions use `{ id, retries?, triggers: [{ event }] }` two-arg signature; for cron use `triggers: [{ cron: "0 12 * * *" }]`.
- `src/lib/notification-types.ts` + `src/components/notifications/notification-preferences-matrix.tsx` — register new types per 2.3.5b/c pattern.
- `src/server/db/schema/cases.ts`, `users.ts`, `organizations.ts`, `case-milestones.ts`, `notifications.ts` — all referenced schemas exist.
- Case detail page: `src/app/(app)/cases/[id]/page.tsx`, TABS array at line 28, append pattern matches 2.3.6 signatures tab.

**Known dev DB IDs (from prior UATs):**
- `CASE_ID = "61e9c86a-4359-49cd-8d59-fdf894e11030"` (Acme Corp)
- `LAWYER_ID = "a480a3b1-b88b-4c94-96f6-0f9249673bb8"`
- `ORG_ID = "a28431e2-dc02-41ba-8b55-6d053e4ede4a"`

---

## File Structure

**Create:**
- `src/server/db/schema/deadline-rules.ts`
- `src/server/db/schema/case-trigger-events.ts`
- `src/server/db/schema/case-deadlines.ts`
- `src/server/db/schema/court-holidays.ts`
- `src/server/db/migrations/0020_filing_deadlines.sql` (tables + FRCP rule seeds + 3-year federal holiday seeds)
- `src/server/services/deadlines/compute.ts` — pure `computeDeadlineDate`, `addBusinessDays`, `isBusinessDay` helpers.
- `src/server/services/deadlines/service.ts` — `DeadlinesService` class.
- `src/server/inngest/functions/deadline-reminders.ts` — daily cron.
- `src/server/trpc/routers/deadlines.ts`
- `src/components/cases/deadlines/deadlines-tab.tsx`
- `src/components/cases/deadlines/trigger-events-list.tsx`
- `src/components/cases/deadlines/deadline-row.tsx`
- `src/components/cases/deadlines/add-trigger-event-modal.tsx`
- `src/components/cases/deadlines/add-custom-deadline-modal.tsx`
- `src/components/cases/deadlines/edit-deadline-modal.tsx`
- `src/app/(app)/settings/deadline-rules/page.tsx`
- `src/components/settings/deadline-rules/rules-table.tsx`
- `src/components/settings/deadline-rules/rule-editor-modal.tsx`
- `tests/unit/deadlines-compute.test.ts`
- `tests/integration/deadlines-service.test.ts`
- `e2e/deadlines-smoke.spec.ts`

**Modify:**
- `src/server/trpc/root.ts` — register `deadlines` router.
- `src/app/(app)/cases/[id]/page.tsx` — add `deadlines` tab.
- `src/server/inngest/index.ts` — register `deadlineRemindersDaily` function.
- `src/lib/notification-types.ts` — 3 new types + `deadlines` category.
- `src/components/notifications/notification-preferences-matrix.tsx` — labels.
- `src/components/calendar/use-calendar-items.ts` — add deadlines query + merge.
- `src/components/calendar/calendar-item-utils.ts` — `"deadline"` variant in `CalendarItem` + `mergeToCalendarItems` accepts 3rd array.
- `src/components/layout/sidebar.tsx` — add `/settings/deadline-rules` link under Settings.

**Not touched:** 2.3.4 milestones schema (only via API call), 2.3.5/b/c emails, 2.3.6 signatures.

---

### Task 1: Schemas + migration 0020 + apply to dev DB

**Files:**
- Create: `src/server/db/schema/deadline-rules.ts`
- Create: `src/server/db/schema/case-trigger-events.ts`
- Create: `src/server/db/schema/case-deadlines.ts`
- Create: `src/server/db/schema/court-holidays.ts`
- Create: `src/server/db/migrations/0020_filing_deadlines.sql`

- [ ] **Step 1: Write `deadline-rules.ts`**

```ts
// src/server/db/schema/deadline-rules.ts
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

export const deadlineRules = pgTable(
  "deadline_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    triggerEvent: text("trigger_event").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    days: integer("days").notNull(),
    dayType: text("day_type").notNull(),
    shiftIfHoliday: boolean("shift_if_holiday").notNull().default(true),
    defaultReminders: jsonb("default_reminders").notNull().default(sql`'[7,3,1]'::jsonb`),
    jurisdiction: text("jurisdiction").notNull().default("FRCP"),
    citation: text("citation"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("deadline_rules_trigger_idx").on(table.triggerEvent, table.jurisdiction),
    index("deadline_rules_org_idx").on(table.orgId),
    check("deadline_rules_day_type_check", sql`${table.dayType} IN ('calendar','court')`),
  ],
);

export type DeadlineRule = typeof deadlineRules.$inferSelect;
export type NewDeadlineRule = typeof deadlineRules.$inferInsert;
```

- [ ] **Step 2: Write `case-trigger-events.ts`**

```ts
// src/server/db/schema/case-trigger-events.ts
import { pgTable, uuid, text, date, timestamp, index } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";
import { caseMilestones } from "./case-milestones";

export const caseTriggerEvents = pgTable(
  "case_trigger_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    triggerEvent: text("trigger_event").notNull(),
    eventDate: date("event_date").notNull(),
    jurisdiction: text("jurisdiction").notNull().default("FRCP"),
    notes: text("notes"),
    publishedMilestoneId: uuid("published_milestone_id").references(() => caseMilestones.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_trigger_events_case_idx").on(table.caseId, table.eventDate),
  ],
);

export type CaseTriggerEvent = typeof caseTriggerEvents.$inferSelect;
export type NewCaseTriggerEvent = typeof caseTriggerEvents.$inferInsert;
```

If `case-milestones.ts` export name differs (e.g., `caseMilestones` vs `case_milestones`), match existing. Grep to confirm.

- [ ] **Step 3: Write `case-deadlines.ts`**

```ts
// src/server/db/schema/case-deadlines.ts
import { pgTable, uuid, text, date, boolean, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { deadlineRules } from "./deadline-rules";
import { caseTriggerEvents } from "./case-trigger-events";

export const caseDeadlines = pgTable(
  "case_deadlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull(),
    dueDate: date("due_date").notNull(),
    source: text("source").notNull(),
    ruleId: uuid("rule_id").references(() => deadlineRules.id, { onDelete: "set null" }),
    triggerEventId: uuid("trigger_event_id").references(() => caseTriggerEvents.id, { onDelete: "cascade" }),
    rawDate: date("raw_date"),
    shiftedReason: text("shifted_reason"),
    manualOverride: boolean("manual_override").notNull().default(false),
    reminders: jsonb("reminders").notNull().default(sql`'[7,3,1]'::jsonb`),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_deadlines_case_due_idx").on(table.caseId, table.dueDate),
    index("case_deadlines_trigger_idx").on(table.triggerEventId),
    check("case_deadlines_source_check", sql`${table.source} IN ('rule_generated','manual')`),
  ],
);

export type CaseDeadline = typeof caseDeadlines.$inferSelect;
export type NewCaseDeadline = typeof caseDeadlines.$inferInsert;
```

- [ ] **Step 4: Write `court-holidays.ts`**

```ts
// src/server/db/schema/court-holidays.ts
import { pgTable, uuid, text, date, uniqueIndex, index } from "drizzle-orm/pg-core";

export const courtHolidays = pgTable(
  "court_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jurisdiction: text("jurisdiction").notNull().default("FEDERAL"),
    name: text("name").notNull(),
    observedDate: date("observed_date").notNull(),
  },
  (table) => [
    uniqueIndex("court_holidays_jurisdiction_date_unique").on(table.jurisdiction, table.observedDate),
    index("court_holidays_jurisdiction_date_idx").on(table.jurisdiction, table.observedDate),
  ],
);

export type CourtHoliday = typeof courtHolidays.$inferSelect;
export type NewCourtHoliday = typeof courtHolidays.$inferInsert;
```

- [ ] **Step 5: Write migration 0020 — DDL + seeds**

```sql
-- 0020_filing_deadlines.sql
-- Phase 2.4.1: FRCP filing deadlines calendar.

CREATE TABLE "deadline_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid,
  "trigger_event" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "days" integer NOT NULL,
  "day_type" text NOT NULL,
  "shift_if_holiday" boolean NOT NULL DEFAULT true,
  "default_reminders" jsonb NOT NULL DEFAULT '[7,3,1]'::jsonb,
  "jurisdiction" text NOT NULL DEFAULT 'FRCP',
  "citation" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "deadline_rules_day_type_check" CHECK ("day_type" IN ('calendar','court'))
);
ALTER TABLE "deadline_rules"
  ADD CONSTRAINT "deadline_rules_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
CREATE INDEX "deadline_rules_trigger_idx" ON "deadline_rules" USING btree ("trigger_event","jurisdiction");
CREATE INDEX "deadline_rules_org_idx" ON "deadline_rules" USING btree ("org_id");

CREATE TABLE "case_trigger_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "trigger_event" text NOT NULL,
  "event_date" date NOT NULL,
  "jurisdiction" text NOT NULL DEFAULT 'FRCP',
  "notes" text,
  "published_milestone_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE "case_trigger_events"
  ADD CONSTRAINT "case_trigger_events_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_trigger_events_milestone_fk" FOREIGN KEY ("published_milestone_id") REFERENCES "public"."case_milestones"("id") ON DELETE set null,
  ADD CONSTRAINT "case_trigger_events_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
CREATE INDEX "case_trigger_events_case_idx" ON "case_trigger_events" USING btree ("case_id","event_date");

CREATE TABLE "case_deadlines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "title" text NOT NULL,
  "due_date" date NOT NULL,
  "source" text NOT NULL,
  "rule_id" uuid,
  "trigger_event_id" uuid,
  "raw_date" date,
  "shifted_reason" text,
  "manual_override" boolean NOT NULL DEFAULT false,
  "reminders" jsonb NOT NULL DEFAULT '[7,3,1]'::jsonb,
  "notes" text,
  "completed_at" timestamp with time zone,
  "completed_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_deadlines_source_check" CHECK ("source" IN ('rule_generated','manual'))
);
ALTER TABLE "case_deadlines"
  ADD CONSTRAINT "case_deadlines_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_deadlines_rule_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."deadline_rules"("id") ON DELETE set null,
  ADD CONSTRAINT "case_deadlines_trigger_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."case_trigger_events"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_deadlines_completed_by_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null;
CREATE INDEX "case_deadlines_case_due_idx" ON "case_deadlines" USING btree ("case_id","due_date");
CREATE INDEX "case_deadlines_due_idx" ON "case_deadlines" USING btree ("due_date") WHERE "completed_at" IS NULL;
CREATE INDEX "case_deadlines_trigger_idx" ON "case_deadlines" USING btree ("trigger_event_id");

CREATE TABLE "court_holidays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "jurisdiction" text NOT NULL DEFAULT 'FEDERAL',
  "name" text NOT NULL,
  "observed_date" date NOT NULL
);
CREATE UNIQUE INDEX "court_holidays_jurisdiction_date_unique" ON "court_holidays" USING btree ("jurisdiction","observed_date");
CREATE INDEX "court_holidays_jurisdiction_date_idx" ON "court_holidays" USING btree ("jurisdiction","observed_date");

-- Seed FRCP rules (global, org_id = NULL).
INSERT INTO "deadline_rules" (org_id, trigger_event, name, days, day_type, jurisdiction, citation) VALUES
  (NULL, 'served_defendant', 'Answer Due', 21, 'calendar', 'FRCP', 'FRCP 12(a)(1)(A)(i)'),
  (NULL, 'served_defendant', 'Waiver of Service Response', 60, 'calendar', 'FRCP', 'FRCP 4(d)(3)'),
  (NULL, 'complaint_filed', 'Serve Defendant Deadline', 90, 'calendar', 'FRCP', 'FRCP 4(m)'),
  (NULL, 'motion_filed', 'Opposition to Motion Due', 14, 'calendar', 'FRCP', 'Local Rule (generic)'),
  (NULL, 'motion_response_filed', 'Reply Brief Due', 7, 'calendar', 'FRCP', 'Local Rule (generic)'),
  (NULL, 'discovery_served', 'Response to Discovery Due', 30, 'calendar', 'FRCP', 'FRCP 33/34/36(a)'),
  (NULL, 'answer_filed', 'Rule 26(f) Conference Window Opens', 21, 'calendar', 'FRCP', 'FRCP 26(f)'),
  (NULL, 'rule_26f_conference', 'Initial Disclosures Due', 14, 'calendar', 'FRCP', 'FRCP 26(a)(1)(C)'),
  (NULL, 'answer_filed', 'Rule 16 Scheduling Order Target', 90, 'calendar', 'FRCP', 'FRCP 16(b)(2)'),
  (NULL, 'expert_disclosure', 'Rebuttal Expert Due', 30, 'calendar', 'FRCP', 'FRCP 26(a)(2)(D)(ii)'),
  (NULL, 'trial_scheduled', 'Pretrial Disclosures Due', -30, 'calendar', 'FRCP', 'FRCP 26(a)(3)(B)'),
  (NULL, 'judgment_entered', 'Notice of Appeal Due', 30, 'calendar', 'FRCP', 'FRAP 4(a)(1)(A)'),
  (NULL, 'judgment_entered', 'Rule 59 Motion Deadline', 28, 'calendar', 'FRCP', 'FRCP 59(b)'),
  (NULL, 'judgment_entered', 'Rule 60 Motion Deadline', 365, 'calendar', 'FRCP', 'FRCP 60(c)(1)'),
  (NULL, 'ssa_decision', 'Complaint for Review Deadline', 60, 'calendar', 'FRCP', '42 U.S.C. §405(g)');

-- Seed US federal holidays for 2026, 2027, 2028 (observed dates — when Jan 1 or July 4 falls on Sunday, observed Monday).
INSERT INTO "court_holidays" (jurisdiction, name, observed_date) VALUES
  ('FEDERAL', 'New Year''s Day', '2026-01-01'),
  ('FEDERAL', 'Martin Luther King Jr. Day', '2026-01-19'),
  ('FEDERAL', 'Presidents Day', '2026-02-16'),
  ('FEDERAL', 'Memorial Day', '2026-05-25'),
  ('FEDERAL', 'Juneteenth', '2026-06-19'),
  ('FEDERAL', 'Independence Day', '2026-07-03'),      -- July 4 is Saturday; observed Friday
  ('FEDERAL', 'Labor Day', '2026-09-07'),
  ('FEDERAL', 'Columbus Day', '2026-10-12'),
  ('FEDERAL', 'Veterans Day', '2026-11-11'),
  ('FEDERAL', 'Thanksgiving Day', '2026-11-26'),
  ('FEDERAL', 'Christmas Day', '2026-12-25'),
  ('FEDERAL', 'New Year''s Day', '2027-01-01'),
  ('FEDERAL', 'Martin Luther King Jr. Day', '2027-01-18'),
  ('FEDERAL', 'Presidents Day', '2027-02-15'),
  ('FEDERAL', 'Memorial Day', '2027-05-31'),
  ('FEDERAL', 'Juneteenth', '2027-06-18'),             -- June 19 is Saturday; observed Friday
  ('FEDERAL', 'Independence Day', '2027-07-05'),       -- July 4 is Sunday; observed Monday
  ('FEDERAL', 'Labor Day', '2027-09-06'),
  ('FEDERAL', 'Columbus Day', '2027-10-11'),
  ('FEDERAL', 'Veterans Day', '2027-11-11'),
  ('FEDERAL', 'Thanksgiving Day', '2027-11-25'),
  ('FEDERAL', 'Christmas Day', '2027-12-24'),          -- Dec 25 is Saturday; observed Friday
  ('FEDERAL', 'New Year''s Day', '2028-01-01'),
  ('FEDERAL', 'Martin Luther King Jr. Day', '2028-01-17'),
  ('FEDERAL', 'Presidents Day', '2028-02-21'),
  ('FEDERAL', 'Memorial Day', '2028-05-29'),
  ('FEDERAL', 'Juneteenth', '2028-06-19'),
  ('FEDERAL', 'Independence Day', '2028-07-04'),
  ('FEDERAL', 'Labor Day', '2028-09-04'),
  ('FEDERAL', 'Columbus Day', '2028-10-09'),
  ('FEDERAL', 'Veterans Day', '2028-11-10'),           -- Nov 11 is Saturday; observed Friday
  ('FEDERAL', 'Thanksgiving Day', '2028-11-23'),
  ('FEDERAL', 'Christmas Day', '2028-12-25');
```

- [ ] **Step 6: Apply to dev DB**

Same Node one-liner pattern as prior phases (loads `.env.local`, uses `postgres` driver, `sql.unsafe(ddl)`). Verify:

```sql
SELECT COUNT(*) FROM deadline_rules;            -- Expect 15
SELECT COUNT(*) FROM court_holidays;             -- Expect 33
SELECT COUNT(*) FROM case_trigger_events;        -- Expect 0
SELECT COUNT(*) FROM case_deadlines;             -- Expect 0
```

- [ ] **Step 7: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 8: Commit**

```bash
git add src/server/db/schema/deadline-rules.ts src/server/db/schema/case-trigger-events.ts src/server/db/schema/case-deadlines.ts src/server/db/schema/court-holidays.ts src/server/db/migrations/0020_filing_deadlines.sql
git commit -m "feat(2.4.1): schema + migration 0020 — 4 tables + FRCP seed + federal holidays"
```

---

### Task 2: Pure compute helpers (TDD)

**Files:**
- Create: `src/server/services/deadlines/compute.ts`
- Create: `tests/unit/deadlines-compute.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/deadlines-compute.test.ts
import { describe, it, expect } from "vitest";
import {
  isBusinessDay,
  addBusinessDays,
  computeDeadlineDate,
} from "@/server/services/deadlines/compute";

// Mid-2026 fixture holidays (subset).
const HOLIDAYS = new Set<string>([
  "2026-07-03",  // Independence Day observed
  "2026-11-26",  // Thanksgiving
  "2026-12-25",  // Christmas
]);

describe("isBusinessDay", () => {
  it("Monday-Friday non-holiday is business day", () => {
    expect(isBusinessDay(new Date("2026-05-04"), HOLIDAYS)).toBe(true);  // Monday
  });
  it("Saturday is not business day", () => {
    expect(isBusinessDay(new Date("2026-05-02"), HOLIDAYS)).toBe(false);
  });
  it("Sunday is not business day", () => {
    expect(isBusinessDay(new Date("2026-05-03"), HOLIDAYS)).toBe(false);
  });
  it("Holiday is not business day", () => {
    expect(isBusinessDay(new Date("2026-11-26"), HOLIDAYS)).toBe(false);
  });
});

describe("addBusinessDays", () => {
  it("adding 1 business day from Monday lands Tuesday", () => {
    const result = addBusinessDays(new Date("2026-05-04"), 1, HOLIDAYS);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-05");
  });
  it("adding 1 business day from Friday skips weekend to Monday", () => {
    const result = addBusinessDays(new Date("2026-05-01"), 1, HOLIDAYS);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-04");
  });
  it("adding 5 business days over a weekend and holiday", () => {
    // Tuesday 2026-11-24 + 5 business days; Thanksgiving 2026-11-26 is holiday.
    // 11-24 Tue -> skip +1 Wed 11-25 -> skip Thu 11-26 holiday -> Fri 11-27 (1) -> skip Sat/Sun
    //   -> Mon 11-30 (2) -> Tue 12-01 (3) -> Wed 12-02 (4) -> Thu 12-03 (5)
    const result = addBusinessDays(new Date("2026-11-24"), 5, HOLIDAYS);
    expect(result.toISOString().slice(0, 10)).toBe("2026-12-03");
  });
  it("adding 0 days returns the same day (if business day)", () => {
    const result = addBusinessDays(new Date("2026-05-04"), 0, HOLIDAYS);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-04");
  });
  it("subtracting business days (negative) works", () => {
    // Wed 2026-05-06 - 3 business days = Fri 2026-05-01
    const result = addBusinessDays(new Date("2026-05-06"), -3, HOLIDAYS);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-01");
  });
});

describe("computeDeadlineDate", () => {
  it("calendar days + plain weekday result: no shift", () => {
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-05-04"),  // Mon
      days: 2,
      dayType: "calendar",
      shiftIfHoliday: true,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-05-06");
    expect(r.shiftedReason).toBeNull();
  });

  it("calendar days landing on Sunday shifts to Monday", () => {
    // Mon 2026-05-04 + 6 calendar days = Sun 2026-05-10
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-05-04"),
      days: 6,
      dayType: "calendar",
      shiftIfHoliday: true,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-05-11");
    expect(r.raw.toISOString().slice(0, 10)).toBe("2026-05-10");
    expect(r.shiftedReason).toBe("weekend");
  });

  it("calendar days landing on holiday shifts to next business day", () => {
    // Wed 2026-11-25 + 1 calendar day = Thu 2026-11-26 (Thanksgiving) → Fri 2026-11-27
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-11-25"),
      days: 1,
      dayType: "calendar",
      shiftIfHoliday: true,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-11-27");
    expect(r.shiftedReason).toContain("holiday");
  });

  it("shiftIfHoliday=false keeps raw date even on weekend", () => {
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-05-04"),
      days: 6,
      dayType: "calendar",
      shiftIfHoliday: false,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-05-10");
    expect(r.shiftedReason).toBeNull();
  });

  it("court days skip weekends inherently", () => {
    // Mon 2026-05-04 + 3 court days = Thu 2026-05-07
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-05-04"),
      days: 3,
      dayType: "court",
      shiftIfHoliday: true,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-05-07");
  });

  it("negative days walk backwards (pretrial deadlines)", () => {
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-05-11"),  // Mon
      days: -7,
      dayType: "calendar",
      shiftIfHoliday: false,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-05-04");
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/unit/deadlines-compute.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `compute.ts`**

```ts
// src/server/services/deadlines/compute.ts

export function isBusinessDay(d: Date, holidays: Set<string>): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const iso = d.toISOString().slice(0, 10);
  return !holidays.has(iso);
}

export function addBusinessDays(from: Date, count: number, holidays: Set<string>): Date {
  const d = new Date(from);
  if (count === 0) return d;
  const direction = count > 0 ? 1 : -1;
  let remaining = Math.abs(count);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + direction);
    if (isBusinessDay(d, holidays)) remaining--;
  }
  return d;
}

export interface ComputeInput {
  triggerDate: Date;
  days: number;
  dayType: "calendar" | "court";
  shiftIfHoliday: boolean;
  holidays: Set<string>;
  holidayNames?: Map<string, string>;  // optional: ISO -> holiday display name
}

export interface ComputeResult {
  dueDate: Date;
  raw: Date;
  shiftedReason: string | null;
}

export function computeDeadlineDate(input: ComputeInput): ComputeResult {
  let raw: Date;

  if (input.dayType === "court") {
    raw = addBusinessDays(input.triggerDate, input.days, input.holidays);
    // Court-day math inherently lands on a business day; no shift needed.
    return { dueDate: new Date(raw), raw, shiftedReason: null };
  }

  // Calendar days: naive add.
  raw = new Date(input.triggerDate);
  raw.setUTCDate(raw.getUTCDate() + input.days);

  if (!input.shiftIfHoliday) {
    return { dueDate: new Date(raw), raw, shiftedReason: null };
  }

  const dueDate = new Date(raw);
  let shiftedReason: string | null = null;
  while (!isBusinessDay(dueDate, input.holidays)) {
    const iso = dueDate.toISOString().slice(0, 10);
    const day = dueDate.getUTCDay();
    if (day === 0 || day === 6) {
      shiftedReason = shiftedReason ?? "weekend";
    } else {
      const name = input.holidayNames?.get(iso) ?? "holiday";
      shiftedReason = shiftedReason ?? `holiday:${name}`;
    }
    dueDate.setUTCDate(dueDate.getUTCDate() + 1);
  }

  return { dueDate, raw, shiftedReason };
}
```

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/unit/deadlines-compute.test.ts`
Expected: 13/13 PASS.

- [ ] **Step 5: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/deadlines/compute.ts tests/unit/deadlines-compute.test.ts
git commit -m "feat(2.4.1): compute helpers (addBusinessDays, computeDeadlineDate) + tests"
```

---

### Task 3: `DeadlinesService` — core CRUD + trigger creation + recompute

**Files:**
- Create: `src/server/services/deadlines/service.ts`
- Create: `tests/integration/deadlines-service.test.ts`

- [ ] **Step 1: Write failing service tests — create + recompute paths**

```ts
// tests/integration/deadlines-service.test.ts
import { describe, it, expect } from "vitest";
import { DeadlinesService } from "@/server/services/deadlines/service";

function makeMockDb(opts: {
  rules?: Array<{ id: string; triggerEvent: string; name: string; days: number; dayType: "calendar" | "court"; shiftIfHoliday: boolean; defaultReminders: number[]; jurisdiction: string }>;
  holidays?: string[];
  existingTrigger?: any;
  existingDeadlines?: any[];
}) {
  const inserts: Array<{ table: string; values: any }> = [];
  const updates: Array<{ table: string; set: any; where?: any }> = [];
  const deletes: Array<{ table: string }> = [];
  let selectCount = 0;

  const tableName = (t: unknown): string => {
    const s = String(t);
    if (s.includes("rules")) return "deadline_rules";
    if (s.includes("trigger_events")) return "case_trigger_events";
    if (s.includes("deadlines")) return "case_deadlines";
    if (s.includes("holidays")) return "court_holidays";
    return "unknown";
  };

  const db: any = {
    insert: (t: unknown) => ({
      values: (v: any) => {
        const name = tableName(t);
        inserts.push({ table: name, values: v });
        const rows = Array.isArray(v) ? v : [v];
        return {
          returning: async () => rows.map((r, i) => ({ id: `row-${inserts.length}-${i}`, ...r })),
        };
      },
    }),
    update: (t: unknown) => ({
      set: (s: any) => ({
        where: (w: any) => {
          updates.push({ table: tableName(t), set: s, where: w });
          return Promise.resolve();
        },
      }),
    }),
    delete: (t: unknown) => ({
      where: () => {
        deletes.push({ table: tableName(t) });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () => {
            selectCount++;
            const name = tableName(t);
            if (name === "court_holidays") {
              return (opts.holidays ?? []).map((d) => ({ observedDate: d, name: "Holiday" }));
            }
            if (name === "deadline_rules") return opts.rules ?? [];
            if (name === "case_trigger_events") return opts.existingTrigger ? [opts.existingTrigger] : [];
            if (name === "case_deadlines") return opts.existingDeadlines ?? [];
            return [];
          },
          orderBy: async () => {
            const name = tableName(t);
            if (name === "court_holidays") return (opts.holidays ?? []).map((d) => ({ observedDate: d, name: "Holiday" }));
            if (name === "case_deadlines") return opts.existingDeadlines ?? [];
            if (name === "deadline_rules") return opts.rules ?? [];
            return [];
          },
        }),
      }),
    }),
  };
  return { db, inserts, updates, deletes };
}

const FRCP_ANSWER_DUE = {
  id: "rule-answer",
  triggerEvent: "served_defendant",
  name: "Answer Due",
  days: 21,
  dayType: "calendar" as const,
  shiftIfHoliday: true,
  defaultReminders: [7, 3, 1],
  jurisdiction: "FRCP",
};

describe("DeadlinesService.createTriggerEvent", () => {
  it("creates trigger event + matching rule deadlines", async () => {
    const { db, inserts } = makeMockDb({ rules: [FRCP_ANSWER_DUE], holidays: [] });
    const svc = new DeadlinesService({ db });
    const result = await svc.createTriggerEvent({
      caseId: "case-1",
      triggerEvent: "served_defendant",
      eventDate: "2026-04-15",
      jurisdiction: "FRCP",
      createdBy: "user-1",
    });
    expect(result.deadlinesCreated).toBe(1);
    const triggerInsert = inserts.find((i) => i.table === "case_trigger_events");
    expect(triggerInsert).toBeTruthy();
    const deadlineInsert = inserts.find((i) => i.table === "case_deadlines");
    expect(deadlineInsert).toBeTruthy();
    const dls = Array.isArray(deadlineInsert!.values) ? deadlineInsert!.values : [deadlineInsert!.values];
    expect(dls[0].dueDate).toBe("2026-05-06");  // 2026-04-15 + 21 days = 2026-05-06 Wed
  });

  it("creates trigger with zero matching rules", async () => {
    const { db, inserts } = makeMockDb({ rules: [], holidays: [] });
    const svc = new DeadlinesService({ db });
    const result = await svc.createTriggerEvent({
      caseId: "case-1",
      triggerEvent: "unknown_event",
      eventDate: "2026-04-15",
      jurisdiction: "FRCP",
      createdBy: "user-1",
    });
    expect(result.deadlinesCreated).toBe(0);
    expect(inserts.some((i) => i.table === "case_trigger_events")).toBe(true);
    expect(inserts.some((i) => i.table === "case_deadlines")).toBe(false);
  });
});

describe("DeadlinesService.updateTriggerEventDate", () => {
  it("recomputes non-overridden deadlines", async () => {
    const existingDeadlines = [
      { id: "d1", manualOverride: false, ruleId: "rule-answer", title: "Answer Due" },
      { id: "d2", manualOverride: true, ruleId: "rule-answer", title: "Answer Due (edited)" },
    ];
    const { db, updates } = makeMockDb({
      rules: [FRCP_ANSWER_DUE],
      holidays: [],
      existingTrigger: { id: "t1", caseId: "case-1", triggerEvent: "served_defendant", eventDate: "2026-04-15", jurisdiction: "FRCP" },
      existingDeadlines,
    });
    const svc = new DeadlinesService({ db });
    const result = await svc.updateTriggerEventDate({ triggerEventId: "t1", newEventDate: "2026-04-20" });
    expect(result.recomputed).toBe(1);
    expect(result.preserved).toBe(1);
    // Should have UPDATE on trigger + UPDATE on d1 only (not d2)
    const deadlineUpdates = updates.filter((u) => u.table === "case_deadlines");
    expect(deadlineUpdates.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/integration/deadlines-service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `service.ts`**

```ts
// src/server/services/deadlines/service.ts
import { and, eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { deadlineRules } from "@/server/db/schema/deadline-rules";
import { caseTriggerEvents, type NewCaseTriggerEvent } from "@/server/db/schema/case-trigger-events";
import { caseDeadlines, type NewCaseDeadline } from "@/server/db/schema/case-deadlines";
import { courtHolidays } from "@/server/db/schema/court-holidays";
import { TRPCError } from "@trpc/server";
import { computeDeadlineDate } from "./compute";

export interface DeadlinesServiceDeps {
  db?: typeof defaultDb;
}

function toHolidayMaps(rows: Array<{ observedDate: string | Date; name: string }>) {
  const set = new Set<string>();
  const names = new Map<string, string>();
  for (const r of rows) {
    const iso = typeof r.observedDate === "string" ? r.observedDate : r.observedDate.toISOString().slice(0, 10);
    set.add(iso);
    names.set(iso, r.name);
  }
  return { set, names };
}

function toDateFromIso(iso: string): Date {
  // Treat input as UTC midnight to avoid timezone shifts.
  return new Date(iso + "T00:00:00.000Z");
}

function isoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class DeadlinesService {
  private readonly db: typeof defaultDb;

  constructor(deps: DeadlinesServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
  }

  async createTriggerEvent(input: {
    caseId: string;
    triggerEvent: string;
    eventDate: string;  // ISO yyyy-mm-dd
    jurisdiction: string;
    notes?: string;
    createdBy: string;
    publishedMilestoneId?: string | null;
  }): Promise<{ triggerEventId: string; deadlinesCreated: number }> {
    const newTrigger: NewCaseTriggerEvent = {
      caseId: input.caseId,
      triggerEvent: input.triggerEvent,
      eventDate: input.eventDate,
      jurisdiction: input.jurisdiction,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
      publishedMilestoneId: input.publishedMilestoneId ?? null,
    };
    const [trigger] = await this.db.insert(caseTriggerEvents).values(newTrigger).returning();

    // Fetch matching rules. Org-scoped rule with same (triggerEvent, jurisdiction) takes precedence.
    const rules = await this.db
      .select()
      .from(deadlineRules)
      .where(
        and(
          eq(deadlineRules.triggerEvent, input.triggerEvent),
          eq(deadlineRules.jurisdiction, input.jurisdiction),
          eq(deadlineRules.active, true),
        ),
      );

    if (rules.length === 0) return { triggerEventId: trigger.id, deadlinesCreated: 0 };

    const holidayRows = await this.db
      .select({ observedDate: courtHolidays.observedDate, name: courtHolidays.name })
      .from(courtHolidays)
      .where(eq(courtHolidays.jurisdiction, "FEDERAL"));
    const { set: holidays, names: holidayNames } = toHolidayMaps(holidayRows);

    const triggerDate = toDateFromIso(input.eventDate);
    const deadlineRows: NewCaseDeadline[] = rules.map((rule) => {
      const r = computeDeadlineDate({
        triggerDate,
        days: rule.days,
        dayType: rule.dayType as "calendar" | "court",
        shiftIfHoliday: rule.shiftIfHoliday,
        holidays,
        holidayNames,
      });
      return {
        caseId: input.caseId,
        title: rule.name,
        dueDate: isoFromDate(r.dueDate),
        source: "rule_generated",
        ruleId: rule.id,
        triggerEventId: trigger.id,
        rawDate: isoFromDate(r.raw),
        shiftedReason: r.shiftedReason,
        manualOverride: false,
        reminders: rule.defaultReminders,
      };
    });

    await this.db.insert(caseDeadlines).values(deadlineRows);
    return { triggerEventId: trigger.id, deadlinesCreated: deadlineRows.length };
  }

  async updateTriggerEventDate(input: {
    triggerEventId: string;
    newEventDate: string;
  }): Promise<{ recomputed: number; preserved: number }> {
    const [trigger] = await this.db
      .select()
      .from(caseTriggerEvents)
      .where(eq(caseTriggerEvents.id, input.triggerEventId))
      .limit(1);
    if (!trigger) throw new TRPCError({ code: "NOT_FOUND", message: "Trigger event not found" });

    await this.db
      .update(caseTriggerEvents)
      .set({ eventDate: input.newEventDate, updatedAt: new Date() })
      .where(eq(caseTriggerEvents.id, input.triggerEventId));

    const deadlines = await this.db
      .select()
      .from(caseDeadlines)
      .where(eq(caseDeadlines.triggerEventId, input.triggerEventId))
      .orderBy(caseDeadlines.dueDate);

    const overridden = deadlines.filter((d: any) => d.manualOverride);
    const recomputeTargets = deadlines.filter((d: any) => !d.manualOverride);

    if (recomputeTargets.length === 0) {
      return { recomputed: 0, preserved: overridden.length };
    }

    const rules = await this.db
      .select()
      .from(deadlineRules)
      .where(eq(deadlineRules.active, true));
    const rulesById = new Map(rules.map((r: any) => [r.id, r]));

    const holidayRows = await this.db
      .select({ observedDate: courtHolidays.observedDate, name: courtHolidays.name })
      .from(courtHolidays)
      .where(eq(courtHolidays.jurisdiction, "FEDERAL"));
    const { set: holidays, names: holidayNames } = toHolidayMaps(holidayRows);

    const triggerDate = toDateFromIso(input.newEventDate);
    let count = 0;
    for (const d of recomputeTargets as any[]) {
      if (!d.ruleId) continue;
      const rule = rulesById.get(d.ruleId);
      if (!rule) continue;
      const r = computeDeadlineDate({
        triggerDate,
        days: rule.days,
        dayType: rule.dayType,
        shiftIfHoliday: rule.shiftIfHoliday,
        holidays,
        holidayNames,
      });
      await this.db
        .update(caseDeadlines)
        .set({
          dueDate: isoFromDate(r.dueDate),
          rawDate: isoFromDate(r.raw),
          shiftedReason: r.shiftedReason,
          updatedAt: new Date(),
        })
        .where(eq(caseDeadlines.id, d.id));
      count++;
    }

    return { recomputed: count, preserved: overridden.length };
  }

  async regenerateFromTrigger(input: { triggerEventId: string }): Promise<{ recomputed: number }> {
    // Clear overrides on all child deadlines then re-run update
    await this.db
      .update(caseDeadlines)
      .set({ manualOverride: false })
      .where(eq(caseDeadlines.triggerEventId, input.triggerEventId));

    const [trigger] = await this.db
      .select()
      .from(caseTriggerEvents)
      .where(eq(caseTriggerEvents.id, input.triggerEventId))
      .limit(1);
    if (!trigger) throw new TRPCError({ code: "NOT_FOUND", message: "Trigger event not found" });

    const result = await this.updateTriggerEventDate({
      triggerEventId: input.triggerEventId,
      newEventDate: (trigger as any).eventDate,
    });
    return { recomputed: result.recomputed };
  }
}
```

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/integration/deadlines-service.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 5: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/deadlines/service.ts tests/integration/deadlines-service.test.ts
git commit -m "feat(2.4.1): DeadlinesService — createTriggerEvent + updateTriggerEventDate + regenerate"
```

---

### Task 4: Service — manual deadlines + list + complete + update + delete + rules CRUD

**Files:** Modify `src/server/services/deadlines/service.ts` + extend tests.

- [ ] **Step 1: Append methods inside `DeadlinesService`**

```ts
async createManualDeadline(input: {
  caseId: string;
  title: string;
  dueDate: string;
  reminders?: number[];
  notes?: string;
}): Promise<{ deadlineId: string }> {
  const newRow: NewCaseDeadline = {
    caseId: input.caseId,
    title: input.title,
    dueDate: input.dueDate,
    source: "manual",
    manualOverride: false,
    reminders: input.reminders ?? [7, 3, 1],
    notes: input.notes ?? null,
  };
  const [row] = await this.db.insert(caseDeadlines).values(newRow).returning();
  return { deadlineId: row.id };
}

async updateDeadline(input: {
  deadlineId: string;
  title?: string;
  dueDate?: string;
  reminders?: number[];
  notes?: string;
}): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date(), manualOverride: true };
  if (input.title !== undefined) patch.title = input.title;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
  if (input.reminders !== undefined) patch.reminders = input.reminders;
  if (input.notes !== undefined) patch.notes = input.notes;
  await this.db.update(caseDeadlines).set(patch).where(eq(caseDeadlines.id, input.deadlineId));
}

async markComplete(input: { deadlineId: string; userId: string }): Promise<void> {
  // Completion does NOT flip manual_override.
  await this.db
    .update(caseDeadlines)
    .set({ completedAt: new Date(), completedBy: input.userId, updatedAt: new Date() })
    .where(eq(caseDeadlines.id, input.deadlineId));
}

async uncomplete(input: { deadlineId: string }): Promise<void> {
  await this.db
    .update(caseDeadlines)
    .set({ completedAt: null, completedBy: null, updatedAt: new Date() })
    .where(eq(caseDeadlines.id, input.deadlineId));
}

async deleteDeadline(input: { deadlineId: string }): Promise<void> {
  await this.db.delete(caseDeadlines).where(eq(caseDeadlines.id, input.deadlineId));
}

async deleteTriggerEvent(input: { triggerEventId: string }): Promise<void> {
  // Cascades child deadlines via FK
  await this.db.delete(caseTriggerEvents).where(eq(caseTriggerEvents.id, input.triggerEventId));
}

async listForCase(input: { caseId: string }) {
  const triggers = await this.db
    .select()
    .from(caseTriggerEvents)
    .where(eq(caseTriggerEvents.caseId, input.caseId))
    .orderBy(caseTriggerEvents.eventDate);

  const deadlines = await this.db
    .select()
    .from(caseDeadlines)
    .where(eq(caseDeadlines.caseId, input.caseId))
    .orderBy(caseDeadlines.dueDate);

  return { triggers, deadlines };
}

async listForRange(input: { orgId: string; from: string; to: string }) {
  // Used by calendar aggregator. Join through cases to filter by org.
  // Simple impl: fetch all deadlines in range; filter by org via cases join.
  // For MVP we trust that ctx.db is already org-scoped; actual query follows.
  const rows = await this.db
    .select({
      id: caseDeadlines.id,
      caseId: caseDeadlines.caseId,
      title: caseDeadlines.title,
      dueDate: caseDeadlines.dueDate,
      source: caseDeadlines.source,
      completedAt: caseDeadlines.completedAt,
    })
    .from(caseDeadlines);
  const fromD = input.from;
  const toD = input.to;
  return rows.filter((r: any) => r.dueDate >= fromD && r.dueDate <= toD);
}
```

The `listForRange` implementation above is simplified to the in-app store, intentionally avoiding the org-join complexity in the service layer. The tRPC router (Task 6) will filter by `case.orgId` against `ctx.user.orgId` before returning. If the caller is at case scope, it should use `listForCase` instead.

- [ ] **Step 2: Add test for manual CRUD + complete**

Append to `tests/integration/deadlines-service.test.ts`:

```ts
describe("DeadlinesService.createManualDeadline + complete", () => {
  it("inserts manual deadline with source=manual", async () => {
    const { db, inserts } = makeMockDb({});
    const svc = new DeadlinesService({ db });
    await svc.createManualDeadline({
      caseId: "case-1",
      title: "Client check-in",
      dueDate: "2026-06-01",
      reminders: [5, 1],
    });
    const i = inserts.find((x) => x.table === "case_deadlines");
    expect(i).toBeTruthy();
    const v = Array.isArray(i!.values) ? i!.values[0] : i!.values;
    expect(v.source).toBe("manual");
    expect(v.title).toBe("Client check-in");
    expect(v.reminders).toEqual([5, 1]);
  });
});

describe("DeadlinesService.updateDeadline", () => {
  it("flips manualOverride=true", async () => {
    const { db, updates } = makeMockDb({});
    const svc = new DeadlinesService({ db });
    await svc.updateDeadline({ deadlineId: "d1", title: "Changed" });
    const u = updates.find((x) => x.table === "case_deadlines");
    expect(u).toBeTruthy();
    expect((u!.set as any).manualOverride).toBe(true);
    expect((u!.set as any).title).toBe("Changed");
  });
});

describe("DeadlinesService.markComplete", () => {
  it("sets completedAt without changing manualOverride", async () => {
    const { db, updates } = makeMockDb({});
    const svc = new DeadlinesService({ db });
    await svc.markComplete({ deadlineId: "d1", userId: "u1" });
    const u = updates.find((x) => x.table === "case_deadlines");
    expect(u).toBeTruthy();
    expect((u!.set as any).completedAt).toBeInstanceOf(Date);
    expect((u!.set as any).completedBy).toBe("u1");
    expect((u!.set as any).manualOverride).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/integration/deadlines-service.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 4: TypeScript + commit**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

```bash
git add src/server/services/deadlines/service.ts tests/integration/deadlines-service.test.ts
git commit -m "feat(2.4.1): service — manual CRUD + listForCase + listForRange + complete"
```

---

### Task 5: Inngest daily cron — deadline reminders

**Files:**
- Create: `src/server/inngest/functions/deadline-reminders.ts`
- Modify: `src/server/inngest/index.ts`

- [ ] **Step 1: Write cron function**

```ts
// src/server/inngest/functions/deadline-reminders.ts
import { inngest } from "../client";
import { db } from "@/server/db";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { notifications } from "@/server/db/schema/notifications";
import { and, eq, isNull, lt, gte } from "drizzle-orm";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export const deadlineRemindersDaily = inngest.createFunction(
  { id: "deadline-reminders-daily", retries: 3 },
  { cron: "0 12 * * *" },
  async ({ step }) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayIso = isoDate(today);

    const in14Iso = isoDate(addDays(today, 14));

    // Upcoming deadlines (not completed, due_date in [today, today+14])
    const upcoming = await step.run("fetch-upcoming", async () => {
      return db
        .select({
          id: caseDeadlines.id,
          caseId: caseDeadlines.caseId,
          title: caseDeadlines.title,
          dueDate: caseDeadlines.dueDate,
          reminders: caseDeadlines.reminders,
        })
        .from(caseDeadlines)
        .where(
          and(
            isNull(caseDeadlines.completedAt),
            gte(caseDeadlines.dueDate, todayIso),
            lt(caseDeadlines.dueDate, in14Iso),
          ),
        );
    });

    // Overdue: due_date < today, not completed
    const overdue = await step.run("fetch-overdue", async () => {
      return db
        .select({
          id: caseDeadlines.id,
          caseId: caseDeadlines.caseId,
          title: caseDeadlines.title,
          dueDate: caseDeadlines.dueDate,
        })
        .from(caseDeadlines)
        .where(
          and(
            isNull(caseDeadlines.completedAt),
            lt(caseDeadlines.dueDate, todayIso),
          ),
        );
    });

    // Build the set of all cases involved and fetch org members for each once.
    const caseIds = Array.from(new Set([...upcoming, ...overdue].map((d) => d.caseId)));
    if (caseIds.length === 0) return { upcomingCount: 0, overdueCount: 0 };

    const caseOrgMap = await step.run("fetch-case-orgs", async () => {
      const rows = await db
        .select({ id: cases.id, orgId: cases.orgId })
        .from(cases);
      const map = new Map<string, string | null>();
      for (const r of rows) map.set(r.id, r.orgId ?? null);
      return map;
    });

    const orgToUsers = await step.run("fetch-org-members", async () => {
      // Minimal model: all users belong to org via users.orgId column (confirm recon).
      // If your schema differs, adapt this query.
      const rows = await db.select({ id: users.id, orgId: users.orgId as any }).from(users as any);
      const m = new Map<string, string[]>();
      for (const r of rows as any[]) {
        if (!r.orgId) continue;
        const arr = m.get(r.orgId) ?? [];
        arr.push(r.id);
        m.set(r.orgId, arr);
      }
      return m;
    });

    let upcomingCount = 0;
    let overdueCount = 0;

    await step.run("insert-notifications", async () => {
      for (const d of upcoming) {
        const dueIso = d.dueDate as string;
        const due = new Date(dueIso + "T00:00:00.000Z");
        const daysBefore = Math.round((due.getTime() - today.getTime()) / 86400000);
        const configuredOffsets: number[] = Array.isArray((d as any).reminders) ? (d as any).reminders as number[] : [7, 3, 1];

        const orgId = caseOrgMap.get(d.caseId);
        if (!orgId) continue;
        const userIds = orgToUsers.get(orgId) ?? [];
        if (userIds.length === 0) continue;

        if (daysBefore === 0) {
          for (const uid of userIds) {
            try {
              await db.insert(notifications).values({
                userId: uid,
                type: "deadline_due_today",
                title: "Due today",
                body: `${d.title}`,
                caseId: d.caseId,
                dedupKey: `deadline:${d.id}:due_today`,
              });
              upcomingCount++;
            } catch { /* dedup hit */ }
          }
        } else if (configuredOffsets.includes(daysBefore)) {
          for (const uid of userIds) {
            try {
              await db.insert(notifications).values({
                userId: uid,
                type: "deadline_upcoming",
                title: `Deadline in ${daysBefore} day${daysBefore === 1 ? "" : "s"}`,
                body: `${d.title}`,
                caseId: d.caseId,
                dedupKey: `deadline:${d.id}:upcoming:${daysBefore}`,
              });
              upcomingCount++;
            } catch { /* dedup hit */ }
          }
        }
      }

      for (const d of overdue) {
        const orgId = caseOrgMap.get(d.caseId);
        if (!orgId) continue;
        const userIds = orgToUsers.get(orgId) ?? [];
        for (const uid of userIds) {
          try {
            await db.insert(notifications).values({
              userId: uid,
              type: "deadline_overdue",
              title: `OVERDUE: ${d.title}`,
              body: `Was due ${d.dueDate}`,
              caseId: d.caseId,
              dedupKey: `deadline:${d.id}:overdue:${todayIso}`,
            });
            overdueCount++;
          } catch { /* dedup hit */ }
        }
      }
    });

    return { upcomingCount, overdueCount, cases: caseIds.length };
  },
);
```

⚠ `users.orgId` may be indirect (via `org_memberships` join) depending on schema. Read `src/server/db/schema/users.ts` or related to confirm. If membership is via a separate table (e.g., `organization_members`), join through that instead. Keep the function logic; only the "fetch org members" query changes.

- [ ] **Step 2: Register in inngest index**

Read `src/server/inngest/index.ts` and append `import { deadlineRemindersDaily } from "./functions/deadline-reminders";` + include in exported array.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

Run: `npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/server/inngest/functions/deadline-reminders.ts src/server/inngest/index.ts
git commit -m "feat(2.4.1): inngest — daily deadline reminders cron"
```

---

### Task 6: tRPC router `deadlines`

**Files:**
- Create: `src/server/trpc/routers/deadlines.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Write router**

```ts
// src/server/trpc/routers/deadlines.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, lte, isNull, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { DeadlinesService } from "@/server/services/deadlines/service";
import { deadlineRules } from "@/server/db/schema/deadline-rules";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import { caseTriggerEvents } from "@/server/db/schema/case-trigger-events";
import { cases } from "@/server/db/schema/cases";

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd");

export const deadlinesRouter = router({
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId });
    }),

  listForRange: protectedProcedure
    .input(z.object({
      from: ISO_DATE,
      to: ISO_DATE,
      caseIds: z.array(z.string().uuid()).optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Load deadlines due in range. Filter by cases the user has access to.
      const accessibleCases = await ctx.db
        .select({ id: cases.id, name: cases.name })
        .from(cases)
        .where(ctx.user.orgId ? eq(cases.orgId, ctx.user.orgId) : eq(cases.id, "__none__"));
      const accessibleIds = new Set(accessibleCases.map((c) => c.id));
      const caseNameById = new Map(accessibleCases.map((c) => [c.id, c.name]));
      const targetIds = input.caseIds ? input.caseIds.filter((id) => accessibleIds.has(id)) : Array.from(accessibleIds);
      if (targetIds.length === 0) return [];

      const rows = await ctx.db
        .select({
          id: caseDeadlines.id,
          caseId: caseDeadlines.caseId,
          title: caseDeadlines.title,
          dueDate: caseDeadlines.dueDate,
          source: caseDeadlines.source,
          completedAt: caseDeadlines.completedAt,
        })
        .from(caseDeadlines)
        .where(
          and(
            inArray(caseDeadlines.caseId, targetIds),
            gte(caseDeadlines.dueDate, input.from),
            lte(caseDeadlines.dueDate, input.to),
          ),
        );
      return rows.map((r) => ({
        ...r,
        caseName: caseNameById.get(r.caseId) ?? "Case",
      }));
    }),

  createTriggerEvent: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      triggerEvent: z.string().min(1).max(100),
      eventDate: ISO_DATE,
      jurisdiction: z.string().max(50).default("FRCP"),
      notes: z.string().max(5_000).optional(),
      alsoPublishAsMilestone: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      let publishedMilestoneId: string | null = null;
      if (input.alsoPublishAsMilestone) {
        // Reuse caseMilestones.create via direct DB call (avoid cross-router cycling).
        // Import lazily to prevent circular dep.
        const { caseMilestones } = await import("@/server/db/schema/case-milestones");
        const [ms] = await ctx.db.insert(caseMilestones).values({
          caseId: input.caseId,
          title: input.triggerEvent.replace(/_/g, " "),
          eventDate: input.eventDate,
          publishedBy: ctx.user.id,
          status: "published",
        } as any).returning();
        publishedMilestoneId = ms.id;
      }

      const svc = new DeadlinesService({ db: ctx.db });
      return svc.createTriggerEvent({
        caseId: input.caseId,
        triggerEvent: input.triggerEvent,
        eventDate: input.eventDate,
        jurisdiction: input.jurisdiction,
        notes: input.notes,
        createdBy: ctx.user.id,
        publishedMilestoneId,
      });
    }),

  updateTriggerEventDate: protectedProcedure
    .input(z.object({ triggerEventId: z.string().uuid(), newEventDate: ISO_DATE }))
    .mutation(async ({ ctx, input }) => {
      const [te] = await ctx.db
        .select({ caseId: caseTriggerEvents.caseId })
        .from(caseTriggerEvents)
        .where(eq(caseTriggerEvents.id, input.triggerEventId))
        .limit(1);
      if (!te) throw new TRPCError({ code: "NOT_FOUND", message: "Trigger event not found" });
      await assertCaseAccess(ctx, te.caseId);

      const svc = new DeadlinesService({ db: ctx.db });
      return svc.updateTriggerEventDate({ triggerEventId: input.triggerEventId, newEventDate: input.newEventDate });
    }),

  regenerateFromTrigger: protectedProcedure
    .input(z.object({ triggerEventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [te] = await ctx.db
        .select({ caseId: caseTriggerEvents.caseId })
        .from(caseTriggerEvents)
        .where(eq(caseTriggerEvents.id, input.triggerEventId))
        .limit(1);
      if (!te) throw new TRPCError({ code: "NOT_FOUND", message: "Trigger event not found" });
      await assertCaseAccess(ctx, te.caseId);

      const svc = new DeadlinesService({ db: ctx.db });
      return svc.regenerateFromTrigger({ triggerEventId: input.triggerEventId });
    }),

  deleteTriggerEvent: protectedProcedure
    .input(z.object({ triggerEventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [te] = await ctx.db
        .select({ caseId: caseTriggerEvents.caseId })
        .from(caseTriggerEvents)
        .where(eq(caseTriggerEvents.id, input.triggerEventId))
        .limit(1);
      if (!te) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      await assertCaseAccess(ctx, te.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      await svc.deleteTriggerEvent({ triggerEventId: input.triggerEventId });
      return { ok: true as const };
    }),

  createManualDeadline: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      title: z.string().trim().min(1).max(500),
      dueDate: ISO_DATE,
      reminders: z.array(z.number().int().min(0).max(365)).max(5).optional(),
      notes: z.string().max(5_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      return svc.createManualDeadline(input);
    }),

  updateDeadline: protectedProcedure
    .input(z.object({
      deadlineId: z.string().uuid(),
      title: z.string().trim().min(1).max(500).optional(),
      dueDate: ISO_DATE.optional(),
      reminders: z.array(z.number().int().min(0).max(365)).max(5).optional(),
      notes: z.string().max(5_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db
        .select({ caseId: caseDeadlines.caseId })
        .from(caseDeadlines)
        .where(eq(caseDeadlines.id, input.deadlineId))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Deadline not found" });
      await assertCaseAccess(ctx, d.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      await svc.updateDeadline(input);
      return { ok: true as const };
    }),

  markComplete: protectedProcedure
    .input(z.object({ deadlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db
        .select({ caseId: caseDeadlines.caseId })
        .from(caseDeadlines)
        .where(eq(caseDeadlines.id, input.deadlineId))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Deadline not found" });
      await assertCaseAccess(ctx, d.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      await svc.markComplete({ deadlineId: input.deadlineId, userId: ctx.user.id });
      return { ok: true as const };
    }),

  uncomplete: protectedProcedure
    .input(z.object({ deadlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db
        .select({ caseId: caseDeadlines.caseId })
        .from(caseDeadlines)
        .where(eq(caseDeadlines.id, input.deadlineId))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Deadline not found" });
      await assertCaseAccess(ctx, d.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      await svc.uncomplete({ deadlineId: input.deadlineId });
      return { ok: true as const };
    }),

  deleteDeadline: protectedProcedure
    .input(z.object({ deadlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db
        .select({ caseId: caseDeadlines.caseId })
        .from(caseDeadlines)
        .where(eq(caseDeadlines.id, input.deadlineId))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Deadline not found" });
      await assertCaseAccess(ctx, d.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      await svc.deleteDeadline({ deadlineId: input.deadlineId });
      return { ok: true as const };
    }),

  listTriggerEventTypes: protectedProcedure.query(async ({ ctx }) => {
    const rules = await ctx.db
      .select({ triggerEvent: deadlineRules.triggerEvent, jurisdiction: deadlineRules.jurisdiction })
      .from(deadlineRules)
      .where(eq(deadlineRules.active, true));
    const unique = new Map<string, { triggerEvent: string; jurisdictions: string[] }>();
    for (const r of rules) {
      const existing = unique.get(r.triggerEvent);
      if (existing) existing.jurisdictions.push(r.jurisdiction);
      else unique.set(r.triggerEvent, { triggerEvent: r.triggerEvent, jurisdictions: [r.jurisdiction] });
    }
    return { triggerEvents: Array.from(unique.values()) };
  }),

  listRules: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.orgId) return { rules: [] };
    const rules = await ctx.db
      .select()
      .from(deadlineRules)
      .where(
        and(
          eq(deadlineRules.active, true),
          // Either global (org_id IS NULL) or firm-scoped
        ),
      );
    return { rules: rules.filter((r: any) => r.orgId == null || r.orgId === ctx.user.orgId) };
  }),

  createRule: protectedProcedure
    .input(z.object({
      triggerEvent: z.string().min(1).max(100),
      name: z.string().trim().min(1).max(200),
      description: z.string().max(2_000).optional(),
      days: z.number().int().min(-3650).max(3650),
      dayType: z.enum(["calendar", "court"]),
      shiftIfHoliday: z.boolean().default(true),
      defaultReminders: z.array(z.number().int().min(0).max(365)).max(5).default([7, 3, 1]),
      jurisdiction: z.string().min(1).max(50),
      citation: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Org required" });
      const [row] = await ctx.db.insert(deadlineRules).values({
        orgId: ctx.user.orgId,
        triggerEvent: input.triggerEvent,
        name: input.name,
        description: input.description ?? null,
        days: input.days,
        dayType: input.dayType,
        shiftIfHoliday: input.shiftIfHoliday,
        defaultReminders: input.defaultReminders,
        jurisdiction: input.jurisdiction,
        citation: input.citation ?? null,
      }).returning();
      return { ruleId: row.id };
    }),

  updateRule: protectedProcedure
    .input(z.object({
      ruleId: z.string().uuid(),
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(2_000).optional(),
      days: z.number().int().min(-3650).max(3650).optional(),
      dayType: z.enum(["calendar", "court"]).optional(),
      shiftIfHoliday: z.boolean().optional(),
      defaultReminders: z.array(z.number().int().min(0).max(365)).max(5).optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [rule] = await ctx.db
        .select({ id: deadlineRules.id, orgId: deadlineRules.orgId })
        .from(deadlineRules)
        .where(eq(deadlineRules.id, input.ruleId))
        .limit(1);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      if (rule.orgId !== ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot edit FRCP seed or another org's rule" });

      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;
      if (input.days !== undefined) patch.days = input.days;
      if (input.dayType !== undefined) patch.dayType = input.dayType;
      if (input.shiftIfHoliday !== undefined) patch.shiftIfHoliday = input.shiftIfHoliday;
      if (input.defaultReminders !== undefined) patch.defaultReminders = input.defaultReminders;
      if (input.active !== undefined) patch.active = input.active;

      await ctx.db.update(deadlineRules).set(patch).where(eq(deadlineRules.id, input.ruleId));
      return { ok: true as const };
    }),

  deleteRule: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [rule] = await ctx.db
        .select({ id: deadlineRules.id, orgId: deadlineRules.orgId })
        .from(deadlineRules)
        .where(eq(deadlineRules.id, input.ruleId))
        .limit(1);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      if (rule.orgId !== ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete FRCP seed" });
      await ctx.db.delete(deadlineRules).where(eq(deadlineRules.id, input.ruleId));
      return { ok: true as const };
    }),
});
```

- [ ] **Step 2: Register in `root.ts`**

Add:

```ts
import { deadlinesRouter } from "./routers/deadlines";
// inside router({...}):
  deadlines: deadlinesRouter,
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0. If `ctx.user.orgId` complains (nullable), match the `requireOrgId` pattern used in email-templates router — grep for precedent and adapt only the affected endpoints.

Run: `npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/deadlines.ts src/server/trpc/root.ts
git commit -m "feat(2.4.1): deadlines tRPC router — 13 endpoints"
```

---

### Task 7: Extend `useCalendarItems` to include deadlines

**Files:**
- Modify: `src/components/calendar/calendar-item-utils.ts`
- Modify: `src/components/calendar/use-calendar-items.ts`

- [ ] **Step 1: Read both files first**

```bash
cat src/components/calendar/calendar-item-utils.ts
cat src/components/calendar/use-calendar-items.ts
```

Understand `CalendarItem` type variants and `mergeToCalendarItems` signature. The following diffs assume the existing type has `source: "event" | "task"`; we add `"deadline"`.

- [ ] **Step 2: Add `deadline` variant to `CalendarItem`**

In `src/components/calendar/calendar-item-utils.ts`, add a new variant. Sample diff (adapt to actual structure):

```ts
// Append to existing type union:
export type CalendarItem =
  | { source: "event"; id: string; title: string; startsAt: Date; endsAt: Date; caseId?: string | null; /* ... existing */ }
  | { source: "task"; id: string; taskId: string; title: string; dueDate: Date; caseId?: string | null; status: string; priority?: string }
  | { source: "deadline"; id: string; title: string; dueDate: Date; caseId: string; caseName: string; deadlineSource: "rule_generated" | "manual"; completedAt: Date | null };

// Extend mergeToCalendarItems signature:
export function mergeToCalendarItems(
  events: RawEvent[] | undefined,
  tasks: RawTask[] | undefined,
  deadlines?: RawDeadline[] | undefined,  // NEW
): CalendarItem[] {
  const items: CalendarItem[] = [];
  // ... existing event + task mapping ...
  if (deadlines) {
    for (const d of deadlines) {
      items.push({
        source: "deadline",
        id: d.id,
        title: d.title,
        dueDate: new Date(d.dueDate + "T00:00:00.000Z"),
        caseId: d.caseId,
        caseName: d.caseName,
        deadlineSource: d.source,
        completedAt: d.completedAt ? new Date(d.completedAt) : null,
      });
    }
  }
  return items;
}

interface RawDeadline {
  id: string;
  caseId: string;
  caseName: string;
  title: string;
  dueDate: string;  // yyyy-mm-dd
  source: "rule_generated" | "manual";
  completedAt: Date | string | null;
}
```

⚠ Adapt the existing `RawEvent`/`RawTask` patterns — don't restructure them.

- [ ] **Step 3: Extend `useCalendarItems.ts`**

```ts
// Add alongside existing event + task queries:
const deadlinesQuery = trpc.deadlines.listForRange.useQuery(
  { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), caseIds: caseIds ?? (caseId ? [caseId] : undefined) },
);

// In mergeToCalendarItems call, add third arg:
const items = useMemo(
  () =>
    mergeToCalendarItems(
      rawEvents?.map((e) => ({ /* existing */ })),
      tasksQuery.data?.map((t) => ({ /* existing */ })),
      deadlinesQuery.data?.map((d) => ({
        id: d.id,
        caseId: d.caseId,
        caseName: d.caseName,
        title: d.title,
        dueDate: d.dueDate,
        source: d.source as "rule_generated" | "manual",
        completedAt: d.completedAt,
      })),
    ),
  [rawEvents, tasksQuery.data, deadlinesQuery.data],
);

// Combine isLoading / error:
isLoading: activeEventsQuery.isLoading || tasksQuery.isLoading || deadlinesQuery.isLoading,
error: activeEventsQuery.error ?? tasksQuery.error ?? deadlinesQuery.error,
// Refetch extends with:
refetch: () => {
  activeEventsQuery.refetch();
  tasksQuery.refetch();
  deadlinesQuery.refetch();
},
```

- [ ] **Step 4: Update CalendarView rendering**

If the view does `if (item.source === "event") { ... } else { /* task */ }`, add a third branch for `"deadline"`. Minimum: title, badge or icon indicating deadline, urgency color. Find the file (likely `src/components/calendar/calendar-view.tsx`) and add the branch following the existing pattern.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.
Run: `npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/components/calendar/calendar-item-utils.ts src/components/calendar/use-calendar-items.ts src/components/calendar/calendar-view.tsx
git commit -m "feat(2.4.1): extend useCalendarItems with deadlines source"
```

---

### Task 8: Case detail Deadlines tab UI

**Files:**
- Create: `src/components/cases/deadlines/deadline-row.tsx`
- Create: `src/components/cases/deadlines/trigger-events-list.tsx`
- Create: `src/components/cases/deadlines/add-trigger-event-modal.tsx`
- Create: `src/components/cases/deadlines/add-custom-deadline-modal.tsx`
- Create: `src/components/cases/deadlines/edit-deadline-modal.tsx`
- Create: `src/components/cases/deadlines/deadlines-tab.tsx`

- [ ] **Step 1: Write `<DeadlineRow>`**

```tsx
// src/components/cases/deadlines/deadline-row.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Pencil, Trash2, Undo2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export interface DeadlineRowData {
  id: string;
  title: string;
  dueDate: string;
  source: "rule_generated" | "manual";
  shiftedReason: string | null;
  manualOverride: boolean;
  completedAt: Date | string | null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function urgencyClass(days: number, completed: boolean): string {
  if (completed) return "bg-zinc-200 text-zinc-600";
  if (days < 0) return "bg-red-200 text-red-900";
  if (days < 3) return "bg-red-100 text-red-800";
  if (days < 7) return "bg-amber-100 text-amber-800";
  return "bg-green-100 text-green-800";
}

export function DeadlineRow({
  deadline,
  onEdit,
}: {
  deadline: DeadlineRowData;
  onEdit: (d: DeadlineRowData) => void;
}) {
  const utils = trpc.useUtils();
  const markComplete = trpc.deadlines.markComplete.useMutation({
    onSuccess: async () => {
      toast.success("Marked complete");
      await utils.deadlines.listForCase.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const uncomplete = trpc.deadlines.uncomplete.useMutation({
    onSuccess: async () => {
      toast.success("Reopened");
      await utils.deadlines.listForCase.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.deadlines.deleteDeadline.useMutation({
    onSuccess: async () => {
      toast.success("Deleted");
      await utils.deadlines.listForCase.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const due = new Date(deadline.dueDate + "T00:00:00.000Z");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = daysBetween(due, today);
  const completed = !!deadline.completedAt;
  const label =
    completed ? "Completed" :
    days < 0 ? `Overdue ${-days}d` :
    days === 0 ? "Due today" :
    `In ${days}d`;

  return (
    <div className={`flex items-center gap-3 border-b py-2 ${completed ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{deadline.title}</span>
          {deadline.manualOverride && (
            <Badge className="bg-blue-100 text-blue-800 text-xs">edited</Badge>
          )}
          {deadline.shiftedReason && (
            <span title={`Shifted: ${deadline.shiftedReason}`}>
              <AlertTriangle className="size-3 text-amber-600" />
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{format(due, "PPP")}</div>
      </div>
      <Badge className={urgencyClass(days, completed)}>{label}</Badge>
      <Button size="icon" variant="ghost" className="size-7" onClick={() => onEdit(deadline)}>
        <Pencil className="size-3.5" />
      </Button>
      {completed ? (
        <Button size="icon" variant="ghost" className="size-7" onClick={() => uncomplete.mutate({ deadlineId: deadline.id })}>
          <Undo2 className="size-3.5" />
        </Button>
      ) : (
        <Button size="icon" variant="ghost" className="size-7" onClick={() => markComplete.mutate({ deadlineId: deadline.id })}>
          <Check className="size-3.5" />
        </Button>
      )}
      <Button size="icon" variant="ghost" className="size-7" onClick={() => {
        if (confirm(`Delete "${deadline.title}"?`)) del.mutate({ deadlineId: deadline.id });
      }}>
        <Trash2 className="size-3.5 text-red-500" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Write `<TriggerEventsList>`**

```tsx
// src/components/cases/deadlines/trigger-events-list.tsx
"use client";

import { Button } from "@/components/ui/button";
import { format } from "date-fns";

export interface TriggerEventListItem {
  id: string;
  triggerEvent: string;
  eventDate: string;
  deadlineCount: number;
}

export function TriggerEventsList({
  items,
  selectedId,
  onSelect,
  onAdd,
}: {
  items: TriggerEventListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center justify-between">
        <h2 className="font-semibold">Triggers</h2>
        <Button size="sm" onClick={onAdd}>+ Add</Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No trigger events yet.</p>
        ) : (
          <ul>
            {items.map((t) => (
              <li
                key={t.id}
                className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${t.id === selectedId ? "bg-muted" : ""}`}
                onClick={() => onSelect(t.id)}
              >
                <div className="text-sm font-medium truncate">{t.triggerEvent.replace(/_/g, " ")}</div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(t.eventDate + "T00:00:00.000Z"), "PP")} · {t.deadlineCount} deadlines
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `<AddTriggerEventModal>`**

```tsx
// src/components/cases/deadlines/add-trigger-event-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

export function AddTriggerEventModal({
  caseId, open, onOpenChange,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [triggerEvent, setTriggerEvent] = React.useState("");
  const [eventDate, setEventDate] = React.useState("");
  const [jurisdiction, setJurisdiction] = React.useState("FRCP");
  const [notes, setNotes] = React.useState("");
  const [alsoPublish, setAlsoPublish] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTriggerEvent(""); setEventDate(""); setJurisdiction("FRCP"); setNotes(""); setAlsoPublish(false);
    }
  }, [open]);

  const types = trpc.deadlines.listTriggerEventTypes.useQuery(undefined, { enabled: open });

  const create = trpc.deadlines.createTriggerEvent.useMutation({
    onSuccess: async (res) => {
      toast.success(`Trigger created${res.deadlinesCreated > 0 ? ` — ${res.deadlinesCreated} deadlines generated` : ""}`);
      await utils.deadlines.listForCase.invalidate({ caseId });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmit = triggerEvent && eventDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add trigger event</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Event type</Label>
            <select className="w-full rounded border p-2" value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}>
              <option value="">Pick event…</option>
              {(types.data?.triggerEvents ?? []).map((t) => (
                <option key={t.triggerEvent} value={t.triggerEvent}>{t.triggerEvent.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div>
            <Label>Jurisdiction</Label>
            <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="FRCP" />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={5000} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={alsoPublish} onChange={(e) => setAlsoPublish(e.target.checked)} />
            Also publish as milestone to client portal
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() => create.mutate({
              caseId, triggerEvent, eventDate, jurisdiction,
              notes: notes || undefined,
              alsoPublishAsMilestone: alsoPublish,
            })}
          >
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write `<AddCustomDeadlineModal>`**

```tsx
// src/components/cases/deadlines/add-custom-deadline-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export function AddCustomDeadlineModal({
  caseId, open, onOpenChange,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [remindersStr, setRemindersStr] = React.useState("7,3,1");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) { setTitle(""); setDueDate(""); setRemindersStr("7,3,1"); setNotes(""); }
  }, [open]);

  const create = trpc.deadlines.createManualDeadline.useMutation({
    onSuccess: async () => {
      toast.success("Deadline added");
      await utils.deadlines.listForCase.invalidate({ caseId });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function parseReminders(s: string): number[] {
    return s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n) && n >= 0).slice(0, 5);
  }

  const canSubmit = title.trim() && dueDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add custom deadline</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} /></div>
          <div><Label>Due date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div>
            <Label>Reminders (days before, comma-separated)</Label>
            <Input value={remindersStr} onChange={(e) => setRemindersStr(e.target.value)} placeholder="7,3,1" />
          </div>
          <div><Label>Notes (optional)</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={5000} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() => create.mutate({
              caseId,
              title: title.trim(),
              dueDate,
              reminders: parseReminders(remindersStr),
              notes: notes || undefined,
            })}
          >
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Write `<EditDeadlineModal>`**

```tsx
// src/components/cases/deadlines/edit-deadline-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export function EditDeadlineModal({
  deadline,
  open,
  onOpenChange,
}: {
  deadline: { id: string; title: string; dueDate: string; notes?: string | null } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open && deadline) {
      setTitle(deadline.title);
      setDueDate(deadline.dueDate);
      setNotes(deadline.notes ?? "");
    }
  }, [open, deadline]);

  const update = trpc.deadlines.updateDeadline.useMutation({
    onSuccess: async () => {
      toast.success("Saved (manual override applied)");
      await utils.deadlines.listForCase.invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!deadline) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit deadline</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} /></div>
          <div><Label>Due date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={5000} /></div>
          <p className="text-xs text-muted-foreground">
            Saving flags this deadline as manually overridden — it won&apos;t recompute when the trigger date changes.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={update.isPending}
            onClick={() => update.mutate({
              deadlineId: deadline.id,
              title: title.trim(),
              dueDate,
              notes: notes || undefined,
            })}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Write `<DeadlinesTab>`**

```tsx
// src/components/cases/deadlines/deadlines-tab.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { RefreshCw, Plus } from "lucide-react";
import { toast } from "sonner";
import { TriggerEventsList, type TriggerEventListItem } from "./trigger-events-list";
import { DeadlineRow, type DeadlineRowData } from "./deadline-row";
import { AddTriggerEventModal } from "./add-trigger-event-modal";
import { AddCustomDeadlineModal } from "./add-custom-deadline-modal";
import { EditDeadlineModal } from "./edit-deadline-modal";

export function DeadlinesTab({ caseId }: { caseId: string }) {
  const utils = trpc.useUtils();
  const { data } = trpc.deadlines.listForCase.useQuery({ caseId });
  const [selectedTriggerId, setSelectedTriggerId] = React.useState<string | null>(null);
  const [addTriggerOpen, setAddTriggerOpen] = React.useState(false);
  const [addCustomOpen, setAddCustomOpen] = React.useState(false);
  const [editDeadline, setEditDeadline] = React.useState<DeadlineRowData | null>(null);

  const regenerate = trpc.deadlines.regenerateFromTrigger.useMutation({
    onSuccess: async (res) => {
      toast.success(`Regenerated ${res.recomputed} deadlines`);
      await utils.deadlines.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  const triggers = data?.triggers ?? [];
  const deadlines = data?.deadlines ?? [];

  const deadlineCountByTrigger = new Map<string, number>();
  for (const d of deadlines) {
    if (d.triggerEventId) {
      deadlineCountByTrigger.set(d.triggerEventId, (deadlineCountByTrigger.get(d.triggerEventId) ?? 0) + 1);
    }
  }

  const triggerItems: TriggerEventListItem[] = triggers.map((t: any) => ({
    id: t.id,
    triggerEvent: t.triggerEvent,
    eventDate: t.eventDate,
    deadlineCount: deadlineCountByTrigger.get(t.id) ?? 0,
  }));

  const shown = selectedTriggerId
    ? deadlines.filter((d: any) => d.triggerEventId === selectedTriggerId)
    : deadlines.filter((d: any) => d.source === "manual");

  const sectionTitle = selectedTriggerId
    ? `Deadlines (${shown.length})`
    : `Custom deadlines (${shown.length})`;

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-72 border-r">
        <TriggerEventsList items={triggerItems} selectedId={selectedTriggerId} onSelect={setSelectedTriggerId} onAdd={() => setAddTriggerOpen(true)} />
      </aside>
      <section className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{sectionTitle}</h3>
          <div className="flex gap-2">
            {selectedTriggerId && (
              <Button size="sm" variant="outline" onClick={() => {
                if (confirm("Regenerate all deadlines from this trigger? Manual overrides will be cleared.")) {
                  regenerate.mutate({ triggerEventId: selectedTriggerId });
                }
              }}>
                <RefreshCw className="size-3.5 mr-1" /> Regenerate
              </Button>
            )}
            <Button size="sm" onClick={() => setAddCustomOpen(true)}>
              <Plus className="size-3.5 mr-1" /> Custom deadline
            </Button>
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deadlines here yet.</p>
        ) : (
          <div>
            {shown.map((d: any) => (
              <DeadlineRow
                key={d.id}
                deadline={{
                  id: d.id,
                  title: d.title,
                  dueDate: d.dueDate,
                  source: d.source,
                  shiftedReason: d.shiftedReason ?? null,
                  manualOverride: d.manualOverride,
                  completedAt: d.completedAt,
                }}
                onEdit={(row) => setEditDeadline(row)}
              />
            ))}
          </div>
        )}
      </section>

      <AddTriggerEventModal caseId={caseId} open={addTriggerOpen} onOpenChange={setAddTriggerOpen} />
      <AddCustomDeadlineModal caseId={caseId} open={addCustomOpen} onOpenChange={setAddCustomOpen} />
      <EditDeadlineModal deadline={editDeadline} open={!!editDeadline} onOpenChange={(v) => { if (!v) setEditDeadline(null); }} />
    </div>
  );
}
```

- [ ] **Step 7: Mount tab on case detail**

Read `src/app/(app)/cases/[id]/page.tsx`. In TABS array after the `signatures` entry (from 2.3.6), append:

```ts
  { key: "deadlines", label: "Deadlines" },
```

Add import:

```ts
import { DeadlinesTab } from "@/components/cases/deadlines/deadlines-tab";
```

After `{activeTab === "signatures" && <SignaturesTab caseId={caseData.id} />}`, append:

```tsx
{activeTab === "deadlines" && <DeadlinesTab caseId={caseData.id} />}
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.
Run: `npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 9: Commit**

```bash
git add src/components/cases/deadlines/ "src/app/(app)/cases/[id]/page.tsx"
git commit -m "feat(2.4.1): case DeadlinesTab — list + modals + mount"
```

---

### Task 9: Settings page — deadline rules

**Files:**
- Create: `src/app/(app)/settings/deadline-rules/page.tsx`
- Create: `src/components/settings/deadline-rules/rules-table.tsx`
- Create: `src/components/settings/deadline-rules/rule-editor-modal.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Write page**

```tsx
// src/app/(app)/settings/deadline-rules/page.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { RulesTable } from "@/components/settings/deadline-rules/rules-table";
import { RuleEditorModal } from "@/components/settings/deadline-rules/rule-editor-modal";

export default function DeadlineRulesPage() {
  const { data } = trpc.deadlines.listRules.useQuery();
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingRuleId, setEditingRuleId] = React.useState<string | null>(null);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Deadline rules</h1>
        <Button onClick={() => { setEditingRuleId(null); setEditorOpen(true); }}>
          <Plus className="size-4 mr-1" /> New rule
        </Button>
      </div>
      <RulesTable rules={data?.rules ?? []} onEdit={(id) => { setEditingRuleId(id); setEditorOpen(true); }} />
      <RuleEditorModal ruleId={editingRuleId} open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}
```

- [ ] **Step 2: Write `<RulesTable>`**

```tsx
// src/components/settings/deadline-rules/rules-table.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";

export function RulesTable({
  rules,
  onEdit,
}: {
  rules: Array<{ id: string; orgId: string | null; name: string; triggerEvent: string; days: number; dayType: string; jurisdiction: string; citation: string | null; active: boolean }>;
  onEdit: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const del = trpc.deadlines.deleteRule.useMutation({
    onSuccess: async () => { toast.success("Rule deleted"); await utils.deadlines.listRules.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const create = trpc.deadlines.createRule.useMutation({
    onSuccess: async () => { toast.success("Rule cloned"); await utils.deadlines.listRules.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  function clone(r: typeof rules[number]) {
    create.mutate({
      triggerEvent: r.triggerEvent,
      name: `${r.name} (firm copy)`,
      days: r.days,
      dayType: r.dayType as "calendar" | "court",
      shiftIfHoliday: true,
      defaultReminders: [7, 3, 1],
      jurisdiction: r.jurisdiction,
      citation: r.citation ?? undefined,
    });
  }

  if (rules.length === 0) return <p className="text-sm text-muted-foreground">No rules.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="p-2">Name</th>
          <th className="p-2">Trigger</th>
          <th className="p-2">Days</th>
          <th className="p-2">Type</th>
          <th className="p-2">Jurisdiction</th>
          <th className="p-2">Citation</th>
          <th className="p-2">Source</th>
          <th className="p-2" />
        </tr>
      </thead>
      <tbody>
        {rules.map((r) => {
          const isSeed = r.orgId == null;
          return (
            <tr key={r.id} className="border-t">
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2">{r.triggerEvent}</td>
              <td className="p-2">{r.days}</td>
              <td className="p-2">{r.dayType}</td>
              <td className="p-2">{r.jurisdiction}</td>
              <td className="p-2 truncate max-w-xs">{r.citation}</td>
              <td className="p-2">{isSeed ? "FRCP seed" : "Firm"}</td>
              <td className="p-2 text-right">
                {isSeed ? (
                  <Button size="sm" variant="ghost" onClick={() => clone(r)} title="Copy as firm rule">
                    <Copy className="size-4" />
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => onEdit(r.id)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      if (confirm(`Delete rule "${r.name}"?`)) del.mutate({ ruleId: r.id });
                    }}>
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Write `<RuleEditorModal>`**

```tsx
// src/components/settings/deadline-rules/rule-editor-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export function RuleEditorModal({
  ruleId,
  open,
  onOpenChange,
}: {
  ruleId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [triggerEvent, setTriggerEvent] = React.useState("");
  const [name, setName] = React.useState("");
  const [days, setDays] = React.useState<string>("21");
  const [dayType, setDayType] = React.useState<"calendar" | "court">("calendar");
  const [jurisdiction, setJurisdiction] = React.useState("FRCP");
  const [citation, setCitation] = React.useState("");
  const [remindersStr, setRemindersStr] = React.useState("7,3,1");

  React.useEffect(() => {
    if (open && !ruleId) {
      setTriggerEvent(""); setName(""); setDays("21"); setDayType("calendar");
      setJurisdiction("FRCP"); setCitation(""); setRemindersStr("7,3,1");
    }
  }, [open, ruleId]);

  const create = trpc.deadlines.createRule.useMutation({
    onSuccess: async () => { toast.success("Rule created"); await utils.deadlines.listRules.invalidate(); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.deadlines.updateRule.useMutation({
    onSuccess: async () => { toast.success("Rule saved"); await utils.deadlines.listRules.invalidate(); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });

  const reminders = remindersStr.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n) && n >= 0).slice(0, 5);
  const daysN = parseInt(days, 10);

  function save() {
    if (!triggerEvent || !name || isNaN(daysN)) { toast.error("Trigger, name, and days are required"); return; }
    if (ruleId) {
      update.mutate({ ruleId, name, days: daysN, dayType, defaultReminders: reminders });
    } else {
      create.mutate({ triggerEvent, name, days: daysN, dayType, shiftIfHoliday: true, defaultReminders: reminders, jurisdiction, citation: citation || undefined });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{ruleId ? "Edit rule" : "New rule"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!ruleId && (
            <>
              <div><Label>Trigger event</Label><Input value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} placeholder="e.g. served_defendant" /></div>
              <div><Label>Jurisdiction</Label><Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} /></div>
              <div><Label>Citation (optional)</Label><Input value={citation} onChange={(e) => setCitation(e.target.value)} placeholder="e.g. CPLR 3012(a)" /></div>
            </>
          )}
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></div>
          <div><Label>Days</Label><Input type="number" value={days} onChange={(e) => setDays(e.target.value)} /></div>
          <div>
            <Label>Day type</Label>
            <div className="flex gap-3 mt-1">
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" checked={dayType === "calendar"} onChange={() => setDayType("calendar")} />
                Calendar days
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" checked={dayType === "court"} onChange={() => setDayType("court")} />
                Court days (skip weekends + holidays)
              </label>
            </div>
          </div>
          <div><Label>Default reminders</Label><Input value={remindersStr} onChange={(e) => setRemindersStr(e.target.value)} placeholder="7,3,1" /></div>
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

- [ ] **Step 4: Sidebar link**

Read `src/components/layout/sidebar.tsx`. After the existing `/settings/email-templates` entry at line 44, append:

```ts
  { href: "/settings/deadline-rules", label: "Deadline rules", icon: Clock },
```

Add `Clock` to the lucide-react imports at top if absent.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: EXIT 0.
Run: `npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/settings/deadline-rules/page.tsx" src/components/settings/deadline-rules/ src/components/layout/sidebar.tsx
git commit -m "feat(2.4.1): settings — deadline-rules page + sidebar link"
```

---

### Task 10: Register notification types

**Files:**
- Modify: `src/lib/notification-types.ts`
- Modify: `src/components/notifications/notification-preferences-matrix.tsx`

- [ ] **Step 1: Add types**

Read `src/lib/notification-types.ts`. Append to `NOTIFICATION_TYPES`:

```ts
"deadline_upcoming",
"deadline_due_today",
"deadline_overdue",
```

Add a new category `deadlines`:

```ts
export const NOTIFICATION_CATEGORIES = {
  // ... existing
  deadlines: ["deadline_upcoming", "deadline_due_today", "deadline_overdue"],
};
```

Extend `NotificationMetadata` with three variants:

```ts
deadline_upcoming: { caseId: string; deadlineId: string; offset: number };
deadline_due_today: { caseId: string; deadlineId: string };
deadline_overdue: { caseId: string; deadlineId: string };
```

- [ ] **Step 2: Add labels**

Read `src/components/notifications/notification-preferences-matrix.tsx`. Append to `TYPE_LABELS`:

```ts
deadline_upcoming: "Deadline coming up",
deadline_due_today: "Deadline due today",
deadline_overdue: "Deadline is overdue",
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

```bash
git add src/lib/notification-types.ts src/components/notifications/notification-preferences-matrix.tsx
git commit -m "feat(2.4.1): register 3 deadline notification types"
```

---

### Task 11: E2E smoke + final verification

**Files:** Create `e2e/deadlines-smoke.spec.ts`

- [ ] **Step 1: Write smoke**

```ts
// e2e/deadlines-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.4.1 deadlines smoke", () => {
  test("case tab returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=deadlines`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("settings/deadline-rules returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/settings/deadline-rules`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/calendar returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/calendar`);
    expect(resp?.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run smoke**

Run: `npx playwright test e2e/deadlines-smoke.spec.ts 2>&1 | tail -10`
Expected: 3/3 pass. Use `CI=true E2E_BASE_URL=http://localhost:3000` pattern if webServer timeout.

- [ ] **Step 3: Full-repo verification**

```bash
npx vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -3
npx next build 2>&1 | tail -20
```

Expected:
- Vitest: ≥620 tests (598 baseline + ~22 new).
- tsc: EXIT 0.
- Build: success.

- [ ] **Step 4: Commit**

```bash
git add e2e/deadlines-smoke.spec.ts
git commit -m "test(2.4.1): E2E smoke for deadlines routes"
```

---

### Task 12: Service-level UAT (post-implementation)

**Files:** Create (temporary) `.tmp-uat-241.mjs`

- [ ] **Step 1: Write UAT**

Script does:
1. Load `.env.local`, connect `postgres` client.
2. Verify seeds: 15 FRCP rules + 33 federal holidays present.
3. Create trigger event `served_defendant` on dev CASE_ID, event_date `2026-04-15`.
4. Verify deadlines generated (at least 2 — Answer Due + Waiver Response). Check Answer Due = `2026-05-06`.
5. Create trigger with date producing weekend-landing Answer Due. Verify `shifted_reason='weekend'` and `due_date` moved forward.
6. Create trigger with date producing holiday-landing Answer Due (e.g., trigger `2026-11-05` + 21 days = `2026-11-26` Thanksgiving → shift to `2026-11-27`). Verify `shifted_reason` contains "holiday".
7. Edit one rule-generated deadline's title → verify `manual_override=true`.
8. Change trigger date → non-overridden recomputes, overridden preserved.
9. `regenerateFromTrigger` → all recomputed (overrides cleared).
10. Create manual deadline → verify `source='manual'`.
11. Mark complete → verify `completed_at` set, `manual_override` NOT flipped.
12. Synthesize cron logic: insert test deadline `due_date = today+3`, run inline the same SELECT as the cron, expect it returns the row. (Don't actually trigger inngest — test the query shape.)
13. Cleanup: delete all seeded test rows.

Expected: ≥15 ✓ / 0 ✗.

- [ ] **Step 2: Run**

Run: `npx tsx .tmp-uat-241.mjs`
Expected: ≥15 ✓, 0 ✗. Fix bugs in `fix(2.4.1): ...` commits and re-run.

- [ ] **Step 3: Remove script**

```bash
rm .tmp-uat-241.mjs
```

---

## Self-Review

**Spec coverage:**
- §3 decisions → T1 (seed + migration), T2 (compute), T3 (recompute), T4 (manual), T5 (cron), T6 (router), T7 (calendar), T8 (UI), T9 (settings), T10 (notifs). All 10 decisions mapped.
- §4 data model → T1 (4 tables + migration).
- §5 compute + service → T2, T3, T4.
- §6 UI → T7 (calendar), T8 (case tab), T9 (settings).
- §7 reminders → T5 (cron) + T10 (types).
- §8 files → all 22 creates + 8 modifies covered.
- §9 testing → T2 (unit), T3/T4 (integration), T11 (E2E), T12 (UAT).
- §10 manual UAT criteria → T12 mirrors service-level; browser UAT separate.
- §11 rollout/ops → out of plan scope (no external keys).
- §12 security → T6 (assertCaseAccess on all endpoints).
- §13 open items → T1 recon confirmed `react-big-calendar` present (dedicated page scrapped; use existing `/calendar`); FRCP rule list in T1 step 5 migration; federal holidays for 3 years in T1; cron at 12 UTC per spec.

**Placeholder scan:** No "TBD". One conditional STOP in T5 if `users.orgId` is via a separate memberships table — real escalation guard, not a placeholder.

**Type consistency:**
- `computeDeadlineDate` signature consistent between T2 implementation, T3 service usage, tests.
- `status` column values unchanged between schema (T1), service (T3/T4), UI (T8 — doesn't expose status, uses due_date math).
- Deadline source literal `"rule_generated" | "manual"` consistent across schema, service, tRPC, UI.
- Rule `dayType` literal `"calendar" | "court"` consistent.
- Notification types: 3 strings consistent across T5 cron inserts, T10 type registration, dedup keys.
- `DeadlinesService` method names consistent across T3, T4, T6.

**No red flags.** Plan ready.
