# 2.1.3a Native Calendar & Deadlines Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a native in-app calendar for ClearTerms that unifies explicit calendar events (court dates, filing deadlines, meetings) with virtual events derived from `task.dueDate`, accessible via a case-scoped Calendar tab on `/cases/[id]` and a global `/calendar` page.

**Architecture:** New `case_calendar_events` table + `calendar_event_kind` enum. New `calendarRouter` with 6 CRUD procedures. Extension of `caseTasksRouter` with `listWithDueDate`. Shared `verifyCaseOwnership`-style helpers extracted to `src/server/trpc/lib/case-auth.ts`. Client uses `react-big-calendar` (dynamically imported) with a unified `CalendarItem` type merged on the client from two tRPC queries. No notifications, no external sync, no recurrence — those are future subphases.

**Tech Stack:** Next.js 16, Drizzle ORM (PostgreSQL), tRPC 11 (`zod/v4`), Vitest, shadcn/ui, lucide-react, `react-big-calendar`, `date-fns` 4, superjson.

**Spec:** `docs/superpowers/specs/2026-04-05-calendar-deadlines-design.md`

---

## File Structure

### New Files (Create)

| File | Responsibility |
|------|---------------|
| `src/server/db/schema/case-calendar-events.ts` | `calendarEventKindEnum` + `caseCalendarEvents` table + indexes + TS types |
| `src/server/trpc/lib/case-auth.ts` | Shared `assertCaseOwnership` + `assertTaskOwnership` helpers (extracted from `case-tasks.ts`) |
| `src/server/trpc/routers/calendar.ts` | `calendarRouter`: `list`, `listByDateRange`, `getById`, `create`, `update`, `delete` |
| `src/lib/calendar-events.ts` | `CALENDAR_EVENT_KINDS`, `CalendarEventKind` type, `calendarEventCreateSchema`, `calendarEventUpdateSchema`, metadata maps |
| `src/components/calendar/calendar-item-utils.ts` | `mergeToCalendarItems`, `isOverdue`, `isUpcoming24h`, `getItemColor`, `getItemIcon`, `CalendarItem` type |
| `src/components/calendar/use-calendar-items.ts` | React hook merging `calendar.*` + `caseTasks.listWithDueDate` queries |
| `src/components/calendar/calendar-view.tsx` | Thin `next/dynamic` boundary — one-liner that lazy-loads `calendar-view-inner.tsx` |
| `src/components/calendar/calendar-view-inner.tsx` | Actual `react-big-calendar` wrapper + localizer + CSS imports (isolated so RBC stays out of non-calendar bundles) |
| `src/components/calendar/calendar-event-card.tsx` | Custom event renderer (color/icon by kind, overdue/upcoming border) |
| `src/components/calendar/calendar-toolbar.tsx` | Custom RBC toolbar: nav buttons + view switcher + "+ Add Event" |
| `src/components/calendar/event-form.tsx` | Shared form (react-hook-form + zodResolver) for create + edit |
| `src/components/calendar/event-create-modal.tsx` | Create modal wrapping `<EventForm>` |
| `src/components/calendar/event-edit-modal.tsx` | Edit modal wrapping `<EventForm>` |
| `src/components/calendar/case-calendar.tsx` | `<CaseCalendar caseId />` for case tab |
| `src/components/calendar/global-calendar.tsx` | `<GlobalCalendar />` for `/calendar` page, with case filter |
| `src/components/calendar/calendar-theme.css` | Dark-theme CSS overrides for react-big-calendar |
| `src/app/(app)/calendar/page.tsx` | Global calendar page |
| `src/app/(app)/cases/page.tsx` | Cases list page (if not already present — see Task 15 check) |
| `tests/integration/case-calendar-events-schema.test.ts` | Schema + type exports test |
| `tests/integration/calendar-event-kinds.test.ts` | Constants/metadata test |
| `tests/integration/calendar-event-validators.test.ts` | Zod schema validation test |

### Modified Files

| File | Change |
|------|--------|
| `src/server/db/schema/case-tasks.ts` | No change to columns; file reads fine as-is (for reference) |
| `src/server/trpc/routers/case-tasks.ts` | Remove inline `assertCaseOwnership`/`assertTaskOwnership`, import from `lib/case-auth.ts`; add new `listWithDueDate` procedure |
| `src/server/trpc/root.ts` | Register `calendarRouter` as `calendar` |
| `src/components/layout/sidebar.tsx` | Add `Cases` + `Calendar` entries to `navItems` after Dashboard |
| `src/app/(app)/cases/[id]/page.tsx` | Add `calendar` to `TABS` between `tasks` and `report`; render `<CaseCalendar>` for it |
| `src/components/cases/tasks/task-detail-panel.tsx` | Extend update/delete mutation `onSuccess` to invalidate `caseTasks.listWithDueDate` |
| `src/components/cases/tasks/kanban-board.tsx` | Same invalidation extension after task mutations |
| `src/components/cases/tasks/task-create-modal.tsx` | Same invalidation extension |
| `package.json` | Add `react-big-calendar` + `@types/react-big-calendar` (dev) |

### Migration

Generated via `drizzle-kit generate` — next sequential file after `src/server/db/migrations/0001_rls_policies.sql`.

---

## Chunk 1: Data Layer & Validators

### Task 1: Drizzle schema for `case_calendar_events`

**Files:**
- Create: `src/server/db/schema/case-calendar-events.ts`

- [ ] **Step 1: Create the schema file**

```ts
// src/server/db/schema/case-calendar-events.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { caseTasks } from "./case-tasks";
import { users } from "./users";

export const calendarEventKindEnum = pgEnum("calendar_event_kind", [
  "court_date",
  "filing_deadline",
  "meeting",
  "reminder",
  "other",
]);

export type CalendarEventKindDb =
  (typeof calendarEventKindEnum.enumValues)[number];

export const caseCalendarEvents = pgTable(
  "case_calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    kind: calendarEventKindEnum("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location"),
    linkedTaskId: uuid("linked_task_id").references(() => caseTasks.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("calendar_events_case_id_idx").on(table.caseId),
    index("calendar_events_starts_at_idx").on(table.startsAt),
    index("calendar_events_case_starts_idx").on(table.caseId, table.startsAt),
    index("calendar_events_linked_task_idx").on(table.linkedTaskId),
  ],
);

export type CaseCalendarEvent = typeof caseCalendarEvents.$inferSelect;
export type NewCaseCalendarEvent = typeof caseCalendarEvents.$inferInsert;
```

> **Note:** `title` and `location` use `text` (unbounded at DB level). Max lengths (200/300) are enforced by Zod validators in Task 3. This matches the 2.1.2 pattern where text fields are bounded in validators, not in DB types. **Exception:** `case-tasks.ts` uses `varchar(500)` for `title` — we deliberately prefer `text` here because the business rule for calendar events is stricter (200) and future tweaks shouldn't require a migration.

- [ ] **Step 2: Commit**

```bash
git add src/server/db/schema/case-calendar-events.ts
git commit -m "feat(db): add case_calendar_events schema and enum"
```

---

### Task 2: Generate and apply migration

**Files:**
- Create: `src/server/db/migrations/0002_<auto>.sql`
- Create: `src/server/db/migrations/meta/<snapshot>.json` (drizzle-kit auto-generated)

- [ ] **Step 1: Run drizzle-kit generate**

```bash
pnpm drizzle-kit generate
```

Expected: a new file `src/server/db/migrations/0002_*.sql` appears containing `CREATE TYPE calendar_event_kind AS ENUM (...)`, `CREATE TABLE case_calendar_events (...)`, and four `CREATE INDEX` statements.

- [ ] **Step 2: Inspect the generated SQL**

Open the generated file. Verify:
- `CREATE TYPE "public"."calendar_event_kind" AS ENUM (...)` with 5 values in the correct order
- `CREATE TABLE "case_calendar_events"` with all columns
- Four `CREATE INDEX` statements matching our index names
- FKs: `case_id` → `cases(id)` ON DELETE CASCADE; `linked_task_id` → `case_tasks(id)` ON DELETE SET NULL; `created_by` → `users(id)`

If anything is missing or wrong, fix the schema file and re-run generate. Do NOT hand-edit the generated SQL.

- [ ] **Step 3: Apply the migration locally**

```bash
pnpm drizzle-kit migrate
```

Expected: "Migration applied" output. No errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/migrations/
git commit -m "feat(db): migration for case_calendar_events"
```

---

### Task 3: Constants, types, and Zod validators

**Files:**
- Create: `src/lib/calendar-events.ts`

- [ ] **Step 1: Create `src/lib/calendar-events.ts`**

```ts
// src/lib/calendar-events.ts
import { z } from "zod/v4";
import type { LucideIcon } from "lucide-react";
import { Gavel, FileClock, Users, Bell, Circle } from "lucide-react";

export const CALENDAR_EVENT_KINDS = [
  "court_date",
  "filing_deadline",
  "meeting",
  "reminder",
  "other",
] as const;

export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export const CALENDAR_EVENT_KIND_META: Record<
  CalendarEventKind,
  { label: string; colorClass: string; icon: LucideIcon }
> = {
  court_date: {
    label: "Court Date",
    colorClass: "bg-red-950 text-red-300 border-red-800",
    icon: Gavel,
  },
  filing_deadline: {
    label: "Filing Deadline",
    colorClass: "bg-amber-950 text-amber-300 border-amber-800",
    icon: FileClock,
  },
  meeting: {
    label: "Meeting",
    colorClass: "bg-blue-950 text-blue-300 border-blue-800",
    icon: Users,
  },
  reminder: {
    label: "Reminder",
    colorClass: "bg-violet-950 text-violet-300 border-violet-800",
    icon: Bell,
  },
  other: {
    label: "Other",
    colorClass: "bg-zinc-800 text-zinc-300 border-zinc-700",
    icon: Circle,
  },
};

/** Kinds whose overdue/upcoming status should be visually surfaced. */
export const DEADLINE_KINDS: ReadonlySet<CalendarEventKind> = new Set([
  "court_date",
  "filing_deadline",
]);

const kindEnum = z.enum(CALENDAR_EVENT_KINDS);

export const calendarEventCreateSchema = z
  .object({
    caseId: z.string().uuid(),
    kind: kindEnum,
    title: z.string().min(1).max(200),
    description: z.string().max(5000).nullish(),
    startsAt: z.date(),
    endsAt: z.date().nullish(),
    location: z.string().max(300).nullish(),
    linkedTaskId: z.string().uuid().nullish(),
  })
  .refine((d) => d.endsAt == null || d.endsAt > d.startsAt, {
    path: ["endsAt"],
    message: "End time must be after start time",
  });

export const calendarEventUpdateSchema = z
  .object({
    id: z.string().uuid(),
    kind: kindEnum.optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullish(),
    startsAt: z.date().optional(),
    endsAt: z.date().nullish(),
    location: z.string().max(300).nullish(),
    linkedTaskId: z.string().uuid().nullish(),
  })
  .refine(
    (d) =>
      d.startsAt == null ||
      d.endsAt == null ||
      d.endsAt === undefined ||
      d.endsAt > d.startsAt,
    { path: ["endsAt"], message: "End time must be after start time" },
  );

export type CalendarEventCreateInput = z.infer<
  typeof calendarEventCreateSchema
>;
export type CalendarEventUpdateInput = z.infer<
  typeof calendarEventUpdateSchema
>;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/calendar-events.ts
git commit -m "feat(lib): add calendar event constants, metadata, and validators"
```

---

### Task 4: Validators unit tests

**Files:**
- Create: `tests/integration/calendar-event-validators.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/calendar-event-validators.test.ts
import { describe, it, expect } from "vitest";
import {
  calendarEventCreateSchema,
  calendarEventUpdateSchema,
  CALENDAR_EVENT_KINDS,
} from "@/lib/calendar-events";

const baseInput = {
  caseId: "11111111-1111-1111-1111-111111111111",
  kind: "meeting" as const,
  title: "Client call",
  startsAt: new Date("2026-05-01T10:00:00Z"),
};

describe("calendarEventCreateSchema", () => {
  it("accepts minimum valid input", () => {
    expect(calendarEventCreateSchema.safeParse(baseInput).success).toBe(true);
  });

  it("rejects empty title", () => {
    const r = calendarEventCreateSchema.safeParse({ ...baseInput, title: "" });
    expect(r.success).toBe(false);
  });

  it("rejects title longer than 200 chars", () => {
    const r = calendarEventCreateSchema.safeParse({
      ...baseInput,
      title: "x".repeat(201),
    });
    expect(r.success).toBe(false);
  });

  it("rejects location longer than 300 chars", () => {
    const r = calendarEventCreateSchema.safeParse({
      ...baseInput,
      location: "x".repeat(301),
    });
    expect(r.success).toBe(false);
  });

  it("accepts null endsAt (all-day/moment)", () => {
    const r = calendarEventCreateSchema.safeParse({ ...baseInput, endsAt: null });
    expect(r.success).toBe(true);
  });

  it("rejects endsAt <= startsAt", () => {
    const r = calendarEventCreateSchema.safeParse({
      ...baseInput,
      endsAt: new Date("2026-05-01T10:00:00Z"),
    });
    expect(r.success).toBe(false);
  });

  it("accepts endsAt > startsAt", () => {
    const r = calendarEventCreateSchema.safeParse({
      ...baseInput,
      endsAt: new Date("2026-05-01T11:00:00Z"),
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid caseId uuid", () => {
    const r = calendarEventCreateSchema.safeParse({
      ...baseInput,
      caseId: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("accepts all 5 kinds", () => {
    for (const kind of CALENDAR_EVENT_KINDS) {
      expect(
        calendarEventCreateSchema.safeParse({ ...baseInput, kind }).success,
      ).toBe(true);
    }
  });
});

describe("calendarEventUpdateSchema", () => {
  it("requires id", () => {
    const r = calendarEventUpdateSchema.safeParse({ title: "x" } as unknown);
    expect(r.success).toBe(false);
  });

  it("accepts id-only patch", () => {
    const r = calendarEventUpdateSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
    });
    expect(r.success).toBe(true);
  });

  it("rejects endsAt <= startsAt on patch when both present", () => {
    const r = calendarEventUpdateSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      startsAt: new Date("2026-05-01T10:00:00Z"),
      endsAt: new Date("2026-05-01T09:00:00Z"),
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm vitest run tests/integration/calendar-event-validators.test.ts
```

Expected: all tests pass (validators already exist from Task 3).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/calendar-event-validators.test.ts
git commit -m "test(calendar): validators test for create/update schemas"
```

---

### Task 5: Constants/metadata test

**Files:**
- Create: `tests/integration/calendar-event-kinds.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/calendar-event-kinds.test.ts
import { describe, it, expect } from "vitest";
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_EVENT_KIND_META,
  DEADLINE_KINDS,
  type CalendarEventKind,
} from "@/lib/calendar-events";

describe("calendar event kinds", () => {
  it("has exactly 5 kinds in the expected order", () => {
    expect(CALENDAR_EVENT_KINDS).toEqual([
      "court_date",
      "filing_deadline",
      "meeting",
      "reminder",
      "other",
    ]);
  });

  it("every kind has label, colorClass, icon", () => {
    for (const kind of CALENDAR_EVENT_KINDS) {
      const meta = CALENDAR_EVENT_KIND_META[kind];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.colorClass).toMatch(/bg-\w/);
      expect(meta.colorClass).toMatch(/text-\w/);
      expect(meta.colorClass).toMatch(/border-\w/);
      expect(typeof meta.icon).toBe("object");
    }
  });

  it("DEADLINE_KINDS contains exactly court_date and filing_deadline", () => {
    expect(DEADLINE_KINDS.size).toBe(2);
    expect(DEADLINE_KINDS.has("court_date")).toBe(true);
    expect(DEADLINE_KINDS.has("filing_deadline")).toBe(true);
  });

  it("CalendarEventKind type is constrained to the tuple", () => {
    const sample: CalendarEventKind = "meeting";
    expect(CALENDAR_EVENT_KINDS).toContain(sample);
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
pnpm vitest run tests/integration/calendar-event-kinds.test.ts
git add tests/integration/calendar-event-kinds.test.ts
git commit -m "test(calendar): metadata and kinds list test"
```

---

### Task 6: Schema import smoke test

**Files:**
- Create: `tests/integration/case-calendar-events-schema.test.ts`

- [ ] **Step 1: Write the test** (mirrors `case-tasks-schema.test.ts`)

```ts
// tests/integration/case-calendar-events-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  caseCalendarEvents,
  calendarEventKindEnum,
  type CaseCalendarEvent,
  type NewCaseCalendarEvent,
} from "@/server/db/schema/case-calendar-events";

describe("case_calendar_events schema", () => {
  it("exports the table object", () => {
    expect(caseCalendarEvents).toBeDefined();
  });

  it("enum has all 5 kinds", () => {
    expect(calendarEventKindEnum.enumValues).toEqual([
      "court_date",
      "filing_deadline",
      "meeting",
      "reminder",
      "other",
    ]);
  });

  it("types are assignable", () => {
    const insert: NewCaseCalendarEvent = {
      caseId: "11111111-1111-1111-1111-111111111111",
      kind: "meeting",
      title: "Test",
      startsAt: new Date(),
      createdBy: "22222222-2222-2222-2222-222222222222",
    };
    expect(insert.kind).toBe("meeting");
    const selectSample = {} as CaseCalendarEvent;
    expect(typeof selectSample).toBe("object");
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
pnpm vitest run tests/integration/case-calendar-events-schema.test.ts
git add tests/integration/case-calendar-events-schema.test.ts
git commit -m "test(calendar): schema import and type smoke test"
```

---

## Chunk 2: Server / tRPC

### Task 7: Extract shared auth helpers

**Files:**
- Create: `src/server/trpc/lib/case-auth.ts`
- Modify: `src/server/trpc/routers/case-tasks.ts` (remove inline helpers, import from new file)

- [ ] **Step 1: Create `src/server/trpc/lib/case-auth.ts`**

Copy the EXACT helpers from `case-tasks.ts` (lines 10-35):

```ts
// src/server/trpc/lib/case-auth.ts
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { cases } from "@/server/db/schema/cases";
import { caseTasks } from "@/server/db/schema/case-tasks";

type Ctx = {
  db: typeof import("@/server/db").db;
  user: { id: string };
};

export async function assertCaseOwnership(ctx: Ctx, caseId: string) {
  const [c] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.userId, ctx.user.id)))
    .limit(1);
  if (!c)
    throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
  return c;
}

export async function assertTaskOwnership(ctx: Ctx, taskId: string) {
  const [row] = await ctx.db
    .select({ task: caseTasks, case: cases })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .where(and(eq(caseTasks.id, taskId), eq(cases.userId, ctx.user.id)))
    .limit(1);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  return row.task;
}
```

- [ ] **Step 2: Update `case-tasks.ts` router to import from new module**

In `src/server/trpc/routers/case-tasks.ts`:
1. Delete the inline `assertCaseOwnership` and `assertTaskOwnership` functions (lines 10-35).
2. Add an import: `import { assertCaseOwnership, assertTaskOwnership } from "../lib/case-auth";`
3. Leave all other call sites untouched — they already use the correct names.

- [ ] **Step 3: Run the existing task tests to verify no regression**

```bash
pnpm vitest run tests/integration/case-tasks-schema.test.ts tests/integration/case-tasks-router.test.ts
```

Expected: all existing task tests still pass.

- [ ] **Step 4: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/lib/case-auth.ts src/server/trpc/routers/case-tasks.ts
git commit -m "refactor(trpc): extract assertCaseOwnership/assertTaskOwnership to shared lib"
```

---

### Task 8: `caseTasks.listWithDueDate` procedure

**Files:**
- Modify: `src/server/trpc/routers/case-tasks.ts`

- [ ] **Step 1: Add imports if missing**

Verify `and`, `eq`, `gte`, `lte`, `isNotNull` are imported from `drizzle-orm`. If `gte`/`lte`/`isNotNull` are missing, add them.

- [ ] **Step 2: Add the procedure at the end of `caseTasksRouter` (before the closing `})`)**

```ts
  listWithDueDate: protectedProcedure
    .input(
      z.object({
        from: z.date(),
        to: z.date(),
        caseId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(cases.userId, ctx.user.id),
        isNotNull(caseTasks.dueDate),
        gte(caseTasks.dueDate, input.from),
        lte(caseTasks.dueDate, input.to),
      ];
      if (input.caseId) {
        await assertCaseOwnership(ctx, input.caseId);
        conditions.push(eq(caseTasks.caseId, input.caseId));
      }

      const rows = await ctx.db
        .select({ task: caseTasks })
        .from(caseTasks)
        .innerJoin(cases, eq(cases.id, caseTasks.caseId))
        .where(and(...conditions))
        .orderBy(asc(caseTasks.dueDate))
        .limit(500);

      return rows.map((r) => r.task);
    }),
```

- [ ] **Step 3: Typecheck**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/case-tasks.ts
git commit -m "feat(trpc): caseTasks.listWithDueDate procedure for calendar"
```

---

### Task 9: `calendarRouter` with 6 procedures

**Files:**
- Create: `src/server/trpc/routers/calendar.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Create the router file**

```ts
// src/server/trpc/routers/calendar.ts
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { and, asc, eq, gte, lte, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { caseCalendarEvents } from "@/server/db/schema/case-calendar-events";
import { cases } from "@/server/db/schema/cases";
import { assertCaseOwnership } from "../lib/case-auth";
import {
  calendarEventCreateSchema,
  calendarEventUpdateSchema,
} from "@/lib/calendar-events";

async function assertEventOwnership(
  ctx: { db: typeof import("@/server/db").db; user: { id: string } },
  eventId: string,
) {
  const [row] = await ctx.db
    .select({ event: caseCalendarEvents })
    .from(caseCalendarEvents)
    .innerJoin(cases, eq(cases.id, caseCalendarEvents.caseId))
    .where(
      and(
        eq(caseCalendarEvents.id, eventId),
        eq(cases.userId, ctx.user.id),
      ),
    )
    .limit(1);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
  return row.event;
}

export const calendarRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseOwnership(ctx, input.caseId);
      return ctx.db
        .select()
        .from(caseCalendarEvents)
        .where(eq(caseCalendarEvents.caseId, input.caseId))
        .orderBy(asc(caseCalendarEvents.startsAt));
    }),

  listByDateRange: protectedProcedure
    .input(
      z.object({
        from: z.date(),
        to: z.date(),
        caseIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(cases.userId, ctx.user.id),
        gte(caseCalendarEvents.startsAt, input.from),
        lte(caseCalendarEvents.startsAt, input.to),
      ];
      if (input.caseIds && input.caseIds.length > 0) {
        conditions.push(inArray(caseCalendarEvents.caseId, input.caseIds));
      }

      const rows = await ctx.db
        .select({ event: caseCalendarEvents })
        .from(caseCalendarEvents)
        .innerJoin(cases, eq(cases.id, caseCalendarEvents.caseId))
        .where(and(...conditions))
        .orderBy(asc(caseCalendarEvents.startsAt))
        .limit(500);

      return rows.map((r) => r.event);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return assertEventOwnership(ctx, input.id);
    }),

  create: protectedProcedure
    .input(calendarEventCreateSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCaseOwnership(ctx, input.caseId);
      const [event] = await ctx.db
        .insert(caseCalendarEvents)
        .values({
          caseId: input.caseId,
          kind: input.kind,
          title: input.title,
          description: input.description ?? null,
          startsAt: input.startsAt,
          endsAt: input.endsAt ?? null,
          location: input.location ?? null,
          linkedTaskId: input.linkedTaskId ?? null,
          createdBy: ctx.user.id,
        })
        .returning();
      return event;
    }),

  update: protectedProcedure
    .input(calendarEventUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await assertEventOwnership(ctx, input.id);

      // Cross-field validation when the patch updates only one side of the range
      const mergedStart = input.startsAt ?? existing.startsAt;
      const mergedEnd =
        input.endsAt === undefined ? existing.endsAt : input.endsAt;
      if (mergedEnd && mergedEnd <= mergedStart) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End time must be after start time",
        });
      }

      const { id, ...rest } = input;
      const [updated] = await ctx.db
        .update(caseCalendarEvents)
        .set({ ...rest, updatedAt: new Date() })
        .where(eq(caseCalendarEvents.id, id))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertEventOwnership(ctx, input.id);
      await ctx.db
        .delete(caseCalendarEvents)
        .where(eq(caseCalendarEvents.id, input.id));
      return { success: true };
    }),
});
```

- [ ] **Step 2: Register in `src/server/trpc/root.ts`**

Add import: `import { calendarRouter } from "./routers/calendar";`
Add to `appRouter`: `calendar: calendarRouter,`

Place the `calendar` key directly after `caseTasks` for consistency.

- [ ] **Step 3: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/calendar.ts src/server/trpc/root.ts
git commit -m "feat(trpc): calendarRouter with 6 CRUD procedures"
```

---

## Chunk 3: Client Foundation

### Task 10: Install `react-big-calendar`

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install**

```bash
pnpm add react-big-calendar
pnpm add -D @types/react-big-calendar
```

- [ ] **Step 2: Verify versions**

```bash
pnpm list react-big-calendar @types/react-big-calendar
```

Expected: both packages listed, `react-big-calendar` ≥ 1.19.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add react-big-calendar for 2.1.3a"
```

---

### Task 11: `CalendarItem` type, merge util, deadline helpers

**Files:**
- Create: `src/components/calendar/calendar-item-utils.ts`

- [ ] **Step 1: Verify upstream type exports exist**

```bash
grep -n "export type TaskStatus\b" src/lib/case-tasks.ts
grep -n "export type TaskPriority\b" src/lib/case-tasks.ts
grep -n "export const CALENDAR_EVENT_KIND_META\b" src/lib/calendar-events.ts
grep -n "export const DEADLINE_KINDS\b" src/lib/calendar-events.ts
```

Expected: each grep returns exactly one hit. Also confirm (by opening `src/lib/calendar-events.ts` from Chunk 1) that each entry in `CALENDAR_EVENT_KIND_META` has both an `icon` (lucide component) and a `colorClass` (string) field — this task depends on both.

- [ ] **Step 2: Create the utility module**

```ts
// src/components/calendar/calendar-item-utils.ts
import type { CalendarEventKind } from "@/lib/calendar-events";
import {
  CALENDAR_EVENT_KIND_META,
  DEADLINE_KINDS,
} from "@/lib/calendar-events";
import type { TaskStatus, TaskPriority } from "@/lib/case-tasks";

export type CalendarEventItem = {
  source: "event";
  id: string;
  kind: CalendarEventKind;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  caseId: string;
  linkedTaskId: string | null;
  location: string | null;
  description: string | null;
};

export type CalendarTaskItem = {
  source: "task";
  id: string; // synthetic: `task:${taskId}`
  taskId: string;
  title: string;
  startsAt: Date;
  endsAt: null;
  caseId: string;
  status: TaskStatus;
  priority: TaskPriority;
};

export type CalendarItem = CalendarEventItem | CalendarTaskItem;

type RawEvent = {
  id: string;
  kind: CalendarEventKind;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  caseId: string;
  linkedTaskId: string | null;
  location: string | null;
  description: string | null;
};

type RawTask = {
  id: string;
  title: string;
  dueDate: Date | null;
  caseId: string;
  status: TaskStatus;
  priority: TaskPriority;
};

export function mergeToCalendarItems(
  events: RawEvent[] | undefined,
  tasks: RawTask[] | undefined,
): CalendarItem[] {
  const out: CalendarItem[] = [];

  for (const e of events ?? []) {
    out.push({
      source: "event",
      id: e.id,
      kind: e.kind,
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      caseId: e.caseId,
      linkedTaskId: e.linkedTaskId,
      location: e.location,
      description: e.description,
    });
  }

  for (const t of tasks ?? []) {
    if (!t.dueDate) continue;
    out.push({
      source: "task",
      id: `task:${t.id}`,
      taskId: t.id,
      title: t.title,
      startsAt: t.dueDate,
      endsAt: null,
      caseId: t.caseId,
      status: t.status,
      priority: t.priority,
    });
  }

  out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return out;
}

export function isOverdue(item: CalendarItem, now: Date = new Date()): boolean {
  if (item.source === "task") {
    return item.status !== "done" && item.startsAt.getTime() < now.getTime();
  }
  if (!DEADLINE_KINDS.has(item.kind)) return false;
  const end = item.endsAt ?? item.startsAt;
  return end.getTime() < now.getTime();
}

export function isUpcoming24h(
  item: CalendarItem,
  now: Date = new Date(),
): boolean {
  if (isOverdue(item, now)) return false;
  if (item.source === "task") {
    if (item.status === "done") return false;
  } else if (!DEADLINE_KINDS.has(item.kind)) {
    return false;
  }
  const target = item.startsAt.getTime();
  const diff = target - now.getTime();
  return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
}

export function getItemColorClass(item: CalendarItem): string {
  if (item.source === "event") {
    return CALENDAR_EVENT_KIND_META[item.kind].colorClass;
  }
  // Tasks use a neutral slate look so they read as "linked task" not "event"
  return "bg-zinc-800 text-zinc-200 border-zinc-600";
}

export function getBorderClass(
  item: CalendarItem,
  now: Date = new Date(),
): string {
  if (isOverdue(item, now)) return "border-l-[3px] border-l-red-500";
  if (isUpcoming24h(item, now)) return "border-l-[3px] border-l-yellow-500";
  return "";
}

// Shared react-big-calendar event shape, kept here so both the dynamic inner
// view module and the event-card component can import it without pulling
// react-big-calendar into non-calendar bundles.
export interface RBCEvent {
  title: string;
  start: Date;
  end: Date;
  resource: CalendarItem;
  allDay?: boolean;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/calendar/calendar-item-utils.ts
git commit -m "feat(calendar): CalendarItem type, merge, and deadline helpers"
```

---

### Task 12: `useCalendarItems` hook

**Files:**
- Create: `src/components/calendar/use-calendar-items.ts`

- [ ] **Step 1: Create the hook**

```ts
// src/components/calendar/use-calendar-items.ts
"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  mergeToCalendarItems,
  type CalendarItem,
} from "./calendar-item-utils";

interface Args {
  caseId?: string;
  from: Date;
  to: Date;
  caseIds?: string[];
}

interface Result {
  items: CalendarItem[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

export function useCalendarItems({
  caseId,
  from,
  to,
  caseIds,
}: Args): Result {
  // Case-scoped path uses calendar.list (no date filter — full case events),
  // global path uses listByDateRange.
  const caseEventsQuery = trpc.calendar.list.useQuery(
    { caseId: caseId ?? "" },
    { enabled: !!caseId },
  );
  const globalEventsQuery = trpc.calendar.listByDateRange.useQuery(
    { from, to, caseIds },
    { enabled: !caseId },
  );

  const tasksQuery = trpc.caseTasks.listWithDueDate.useQuery({
    from,
    to,
    caseId,
  });

  const rawEvents = caseId ? caseEventsQuery.data : globalEventsQuery.data;

  const items = useMemo(
    () =>
      mergeToCalendarItems(
        rawEvents?.map((e) => ({
          id: e.id,
          kind: e.kind,
          title: e.title,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          caseId: e.caseId,
          linkedTaskId: e.linkedTaskId,
          location: e.location,
          description: e.description,
        })),
        tasksQuery.data?.map((t) => ({
          id: t.id,
          title: t.title,
          dueDate: t.dueDate,
          caseId: t.caseId,
          status: t.status,
          priority: t.priority,
        })),
      ),
    [rawEvents, tasksQuery.data],
  );

  const activeEventsQuery = caseId ? caseEventsQuery : globalEventsQuery;

  return {
    items,
    isLoading: activeEventsQuery.isLoading || tasksQuery.isLoading,
    error: activeEventsQuery.error ?? tasksQuery.error,
    refetch: () => {
      activeEventsQuery.refetch();
      tasksQuery.refetch();
    },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/calendar/use-calendar-items.ts
git commit -m "feat(calendar): useCalendarItems hook merging events + tasks"
```

---

### Task 13: `CalendarView` base (react-big-calendar wrapper)

**Files:**
- Create: `src/components/calendar/calendar-view.tsx` (thin dynamic-import boundary)
- Create: `src/components/calendar/calendar-view-inner.tsx` (actual RBC wrapper — isolated so `next/dynamic` keeps RBC + its CSS out of non-calendar bundles)
- Create: `src/components/calendar/calendar-event-card.tsx`
- Create: `src/components/calendar/calendar-toolbar.tsx`
- Create: `src/components/calendar/calendar-theme.css`

> **Important (bundle splitting):** `next/dynamic` only code-splits when it wraps a **separate module** via `() => import("./path")`. Wrapping a locally-defined component in `Promise.resolve(...)` does NOT create a chunk boundary — the imports at the top of the file are still evaluated eagerly. That is why the inner component lives in its own file below and `calendar-view.tsx` is a one-liner.

- [ ] **Step 1: Create `calendar-event-card.tsx`**

```tsx
// src/components/calendar/calendar-event-card.tsx
"use client";

import type { EventProps } from "react-big-calendar";
import { cn } from "@/lib/utils";
import { CALENDAR_EVENT_KIND_META } from "@/lib/calendar-events";
import {
  getBorderClass,
  getItemColorClass,
  type RBCEvent,
} from "./calendar-item-utils";

export function CalendarEventCard({ event }: EventProps<RBCEvent>) {
  const item = event.resource;
  const color = getItemColorClass(item);
  const border = getBorderClass(item);
  const Icon =
    item.source === "event"
      ? CALENDAR_EVENT_KIND_META[item.kind].icon
      : null;

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs truncate border",
        color,
        border,
      )}
      title={event.title}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      <span className="truncate">{event.title}</span>
    </div>
  );
}
```

- [ ] **Step 2: Create `calendar-toolbar.tsx`**

```tsx
// src/components/calendar/calendar-toolbar.tsx
"use client";

import type { ToolbarProps, View } from "react-big-calendar";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RBCEvent } from "./calendar-item-utils";

const VIEW_LABELS: Record<View, string> = {
  month: "Month",
  week: "Week",
  work_week: "Work Week",
  day: "Day",
  agenda: "Agenda",
};

interface Props extends ToolbarProps<RBCEvent> {
  onAddEvent: () => void;
  availableViews: View[];
}

export function CalendarToolbar(props: Props) {
  const { label, onNavigate, onView, view, availableViews, onAddEvent } = props;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onNavigate("PREV")}
          aria-label="Previous"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate("TODAY")}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onNavigate("NEXT")}
          aria-label="Next"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-2 text-sm font-medium text-zinc-200">{label}</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-zinc-800 overflow-hidden">
          {availableViews.map((v) => (
            <button
              key={v}
              className={cn(
                "px-3 py-1 text-xs",
                view === v
                  ? "bg-zinc-800 text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-900",
              )}
              onClick={() => onView(v)}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={onAddEvent}>
          <Plus className="h-4 w-4 mr-1" /> Add Event
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `calendar-theme.css`**

```css
/* src/components/calendar/calendar-theme.css */
/* Dark theme overrides for react-big-calendar.
   Scoped via the `.ct-calendar` wrapper class on CalendarView. */

.ct-calendar .rbc-calendar {
  background-color: transparent;
  color: rgb(228 228 231); /* zinc-200 */
}
.ct-calendar .rbc-month-view,
.ct-calendar .rbc-time-view,
.ct-calendar .rbc-agenda-view {
  border: 1px solid rgb(39 39 42); /* zinc-800 */
  border-radius: 6px;
}
.ct-calendar .rbc-header,
.ct-calendar .rbc-time-header,
.ct-calendar .rbc-time-header-content,
.ct-calendar .rbc-time-content,
.ct-calendar .rbc-day-bg,
.ct-calendar .rbc-month-row,
.ct-calendar .rbc-row {
  border-color: rgb(39 39 42);
}
.ct-calendar .rbc-off-range-bg {
  background-color: rgb(9 9 11); /* zinc-950 */
}
.ct-calendar .rbc-today {
  background-color: rgba(59, 130, 246, 0.08); /* blue-500/8% */
}
.ct-calendar .rbc-event {
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
}
.ct-calendar .rbc-event-content {
  padding: 0;
}
.ct-calendar .rbc-show-more {
  color: rgb(161 161 170); /* zinc-400 */
  background: transparent;
}
.ct-calendar .rbc-agenda-view table.rbc-agenda-table tbody > tr > td {
  border-color: rgb(39 39 42);
  color: rgb(228 228 231);
}
.ct-calendar .rbc-agenda-empty {
  color: rgb(113 113 122); /* zinc-500 */
}
```

- [ ] **Step 4: Create `calendar-view-inner.tsx` (contains all react-big-calendar imports)**

```tsx
// src/components/calendar/calendar-view-inner.tsx
"use client";

import { useMemo } from "react";
import {
  Calendar as RBCalendar,
  dateFnsLocalizer,
  type Components,
  type SlotInfo,
  type View,
} from "react-big-calendar";
// date-fns v4: use named imports from "date-fns" (deep subpath default imports
// like "date-fns/format" were removed in v3 and do not work in v4).
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { CalendarEventCard } from "./calendar-event-card";
import { CalendarToolbar } from "./calendar-toolbar";
import type { CalendarItem, RBCEvent } from "./calendar-item-utils";

import "react-big-calendar/lib/css/react-big-calendar.css";
import "./calendar-theme.css";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales,
});

export interface CalendarViewProps {
  items: CalendarItem[];
  defaultView?: View;
  onSelectItem: (item: CalendarItem) => void;
  onSelectSlot: (slot: SlotInfo) => void;
  onAddEvent: () => void;
  onRangeChange?: (range: { from: Date; to: Date }) => void;
}

const AVAILABLE_VIEWS: View[] = ["month", "week", "agenda"];

export default function CalendarViewInner({
  items,
  defaultView = "month",
  onSelectItem,
  onSelectSlot,
  onAddEvent,
  onRangeChange,
}: CalendarViewProps) {
  const rbcEvents = useMemo<RBCEvent[]>(
    () =>
      items.map((i) => ({
        title: i.title,
        start: i.startsAt,
        end: i.endsAt ?? i.startsAt,
        allDay: i.endsAt === null,
        resource: i,
      })),
    [items],
  );

  const components: Components<RBCEvent> = useMemo(
    () => ({
      event: CalendarEventCard,
      toolbar: (props) => (
        <CalendarToolbar
          {...props}
          availableViews={AVAILABLE_VIEWS}
          onAddEvent={onAddEvent}
        />
      ),
    }),
    [onAddEvent],
  );

  return (
    <div className="ct-calendar h-full px-4 py-4">
      <RBCalendar<RBCEvent>
        localizer={localizer}
        events={rbcEvents}
        startAccessor="start"
        endAccessor="end"
        views={AVAILABLE_VIEWS}
        defaultView={defaultView}
        selectable
        popup
        onSelectEvent={(e) => onSelectItem(e.resource)}
        onSelectSlot={onSelectSlot}
        onRangeChange={(range) => {
          if (!onRangeChange) return;
          if (Array.isArray(range)) {
            const sorted = [...range].sort(
              (a, b) => a.getTime() - b.getTime(),
            );
            onRangeChange({ from: sorted[0], to: sorted[sorted.length - 1] });
          } else {
            onRangeChange({ from: range.start, to: range.end });
          }
        }}
        components={components}
        style={{ height: "100%" }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Create `calendar-view.tsx` (thin dynamic-import boundary)**

```tsx
// src/components/calendar/calendar-view.tsx
"use client";

// This file MUST stay minimal. `next/dynamic` only creates a separate chunk
// when it wraps a module via `() => import("...")`. Inlining the component or
// using `Promise.resolve(Component)` would re-introduce react-big-calendar +
// its CSS into every bundle that imports CalendarView.
import dynamic from "next/dynamic";

export type { CalendarViewProps } from "./calendar-view-inner";

export const CalendarView = dynamic(() => import("./calendar-view-inner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      Loading calendar…
    </div>
  ),
});
```

- [ ] **Step 6: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: clean exit. Common gotchas if it fails:
- `Components<RBCEvent>["event"]` expects a component taking `EventProps<RBCEvent>`; `CalendarEventCard` is now typed that way directly — no cast needed.
- `ToolbarProps<RBCEvent>` is the correct generic (not `{ resource: CalendarItem }`) because RBC passes the full event shape.
- If `format`/`parse`/`startOfWeek`/`getDay` fail to resolve, you are on an older date-fns; verify `pnpm list date-fns` returns v4+.

- [ ] **Step 7: Smoke render check**

Temporarily add `<CalendarView items={[]} onSelectItem={()=>{}} onSelectSlot={()=>{}} onAddEvent={()=>{}} />` to any existing page (e.g. `/dashboard`), run `pnpm dev`, confirm the empty calendar renders with dark theme and no console errors, then revert the temporary edit before committing. Do NOT commit the scratch edit.

- [ ] **Step 8: Commit**

```bash
git add src/components/calendar/calendar-view.tsx \
        src/components/calendar/calendar-view-inner.tsx \
        src/components/calendar/calendar-event-card.tsx \
        src/components/calendar/calendar-toolbar.tsx \
        src/components/calendar/calendar-theme.css
git commit -m "feat(calendar): CalendarView wrapper + theme + event card + toolbar"
```

---

## Chunk 4: Forms, Modals, and Calendars

### Task 14: `EventForm` shared form

**Files:**
- Create: `src/components/calendar/event-form.tsx`

- [ ] **Step 1: Create the form**

```tsx
// src/components/calendar/event-form.tsx
"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_EVENT_KIND_META,
} from "@/lib/calendar-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/**
 * Form-local schema. Uses datetime-local strings that we convert to Date on submit.
 * The server-side schema (`calendarEventCreateSchema`) is the source of truth.
 */
const formSchema = z
  .object({
    caseId: z.string().uuid(),
    kind: z.enum(CALENDAR_EVENT_KINDS),
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(5000).optional().or(z.literal("")),
    startsAt: z.string().min(1, "Start is required"),
    endsAt: z.string().optional().or(z.literal("")),
    location: z.string().max(300).optional().or(z.literal("")),
    linkedTaskId: z.string().uuid().optional().or(z.literal("")),
  })
  .refine(
    (d) => !d.endsAt || new Date(d.endsAt) > new Date(d.startsAt),
    { path: ["endsAt"], message: "End must be after start" },
  );

export type EventFormValues = z.infer<typeof formSchema>;

export interface EventFormSubmit {
  caseId: string;
  kind: (typeof CALENDAR_EVENT_KINDS)[number];
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  linkedTaskId: string | null;
}

interface Props {
  defaults?: Partial<EventFormValues>;
  caseOptions?: Array<{ id: string; name: string }>;
  disableCaseSelect?: boolean;
  submitLabel: string;
  onSubmit: (values: EventFormSubmit) => Promise<void> | void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function EventForm({
  defaults,
  caseOptions,
  disableCaseSelect,
  submitLabel,
  onSubmit,
  onCancel,
  isSubmitting,
}: Props) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<EventFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      kind: "meeting",
      ...defaults,
    },
  });

  const submit = handleSubmit(async (values) => {
    await onSubmit({
      caseId: values.caseId,
      kind: values.kind,
      title: values.title,
      description: values.description?.trim() ? values.description : null,
      startsAt: new Date(values.startsAt),
      endsAt: values.endsAt ? new Date(values.endsAt) : null,
      location: values.location?.trim() ? values.location : null,
      linkedTaskId: values.linkedTaskId || null,
    });
  });

  return (
    <form onSubmit={submit} className="space-y-4">
      {!disableCaseSelect && caseOptions && (
        <div>
          <Label htmlFor="caseId">Case</Label>
          <Controller
            control={control}
            name="caseId"
            render={({ field }) => (
              <select
                id="caseId"
                {...field}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 text-sm"
              >
                <option value="">Select a case…</option>
                {caseOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          />
          {errors.caseId && (
            <p className="mt-1 text-xs text-red-500">Case is required</p>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="title">Title</Label>
        <Input id="title" {...register("title")} />
        {errors.title && (
          <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="kind">Kind</Label>
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <select
              id="kind"
              {...field}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 text-sm"
            >
              {CALENDAR_EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CALENDAR_EVENT_KIND_META[k].label}
                </option>
              ))}
            </select>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="startsAt">Starts</Label>
          <Input
            id="startsAt"
            type="datetime-local"
            {...register("startsAt")}
          />
          {errors.startsAt && (
            <p className="mt-1 text-xs text-red-500">
              {errors.startsAt.message}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="endsAt">Ends (optional)</Label>
          <Input id="endsAt" type="datetime-local" {...register("endsAt")} />
          {errors.endsAt && (
            <p className="mt-1 text-xs text-red-500">{errors.endsAt.message}</p>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor="location">Location (optional)</Label>
        <Input id="location" {...register("location")} />
      </div>

      <div>
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea id="description" rows={3} {...register("description")} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
```

> **Verify before writing:** confirm `@hookform/resolvers`, `react-hook-form`, `@/components/ui/textarea` and `@/components/ui/label` exist in the project. They are used by the Tasks module (2.1.2) — check imports in `src/components/cases/tasks/task-create-modal.tsx` if unsure. If Textarea/Label aren't present, either add them via `pnpm dlx shadcn add textarea label` or use plain HTML elements with matching classes from neighboring forms.

- [ ] **Step 2: Typecheck**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/calendar/event-form.tsx
git commit -m "feat(calendar): shared EventForm with zod resolver"
```

---

### Task 15: Create + Edit modals

**Files:**
- Create: `src/components/calendar/event-create-modal.tsx`
- Create: `src/components/calendar/event-edit-modal.tsx`

- [ ] **Step 1: Create `event-create-modal.tsx`**

```tsx
// src/components/calendar/event-create-modal.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EventForm, type EventFormSubmit } from "./event-form";

interface Props {
  open: boolean;
  onClose: () => void;
  caseId?: string;
  caseOptions?: Array<{ id: string; name: string }>;
  defaultStartsAt?: Date;
}

function toDatetimeLocal(d: Date | undefined): string | undefined {
  if (!d) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventCreateModal({
  open,
  onClose,
  caseId,
  caseOptions,
  defaultStartsAt,
}: Props) {
  const utils = trpc.useUtils();
  const createMutation = trpc.calendar.create.useMutation({
    onSuccess: (created) => {
      toast.success("Event created");
      utils.calendar.list.invalidate({ caseId: created.caseId });
      utils.calendar.listByDateRange.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = async (values: EventFormSubmit) => {
    await createMutation.mutateAsync(values);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
        </DialogHeader>
        <EventForm
          defaults={{
            caseId: caseId ?? "",
            startsAt: toDatetimeLocal(defaultStartsAt) ?? "",
          }}
          caseOptions={caseOptions}
          disableCaseSelect={!!caseId}
          submitLabel="Create"
          onSubmit={handleSubmit}
          onCancel={onClose}
          isSubmitting={createMutation.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `event-edit-modal.tsx`**

```tsx
// src/components/calendar/event-edit-modal.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EventForm, type EventFormSubmit } from "./event-form";

interface Props {
  eventId: string | null;
  onClose: () => void;
}

function toDatetimeLocal(d: Date | null | undefined): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventEditModal({ eventId, onClose }: Props) {
  const utils = trpc.useUtils();
  const { data: event, isLoading } = trpc.calendar.getById.useQuery(
    { id: eventId! },
    { enabled: !!eventId },
  );

  const updateMutation = trpc.calendar.update.useMutation({
    onSuccess: (updated) => {
      toast.success("Event updated");
      utils.calendar.list.invalidate({ caseId: updated.caseId });
      utils.calendar.listByDateRange.invalidate();
      utils.calendar.getById.invalidate({ id: updated.id });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.calendar.delete.useMutation({
    onSuccess: () => {
      toast.success("Event deleted");
      if (event) {
        utils.calendar.list.invalidate({ caseId: event.caseId });
      }
      utils.calendar.listByDateRange.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = async (values: EventFormSubmit) => {
    if (!event) return;
    await updateMutation.mutateAsync({
      id: event.id,
      kind: values.kind,
      title: values.title,
      description: values.description,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      location: values.location,
      linkedTaskId: values.linkedTaskId,
    });
  };

  const handleDelete = () => {
    if (!event) return;
    if (!confirm("Delete this event?")) return;
    deleteMutation.mutate({ id: event.id });
  };

  return (
    <Dialog open={!!eventId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit event</DialogTitle>
        </DialogHeader>
        {isLoading || !event ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <EventForm
              defaults={{
                caseId: event.caseId,
                kind: event.kind,
                title: event.title,
                description: event.description ?? "",
                startsAt: toDatetimeLocal(event.startsAt),
                endsAt: toDatetimeLocal(event.endsAt),
                location: event.location ?? "",
                linkedTaskId: event.linkedTaskId ?? "",
              }}
              disableCaseSelect
              submitLabel="Save"
              onSubmit={handleSubmit}
              onCancel={onClose}
              isSubmitting={updateMutation.isPending}
            />
            <DialogFooter>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                Delete
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/calendar/event-create-modal.tsx src/components/calendar/event-edit-modal.tsx
git commit -m "feat(calendar): create and edit event modals"
```

---

### Task 16: `<CaseCalendar>` + case tab integration

**Files:**
- Create: `src/components/calendar/case-calendar.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Create `case-calendar.tsx`**

```tsx
// src/components/calendar/case-calendar.tsx
"use client";

import { useState } from "react";
import type { SlotInfo } from "react-big-calendar";
import { CalendarView } from "./calendar-view";
import { EventCreateModal } from "./event-create-modal";
import { EventEditModal } from "./event-edit-modal";
import { TaskDetailPanel } from "@/components/cases/tasks/task-detail-panel";
import { useCalendarItems } from "./use-calendar-items";
import type { CalendarItem } from "./calendar-item-utils";

interface Props {
  caseId: string;
}

export function CaseCalendar({ caseId }: Props) {
  // Broad range — case-scoped list doesn't date-filter server-side anyway.
  const [range, setRange] = useState<{ from: Date; to: Date }>(() => {
    const now = new Date();
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth() + 2, 0),
    };
  });

  const { items, isLoading, error } = useCalendarItems({
    caseId,
    from: range.from,
    to: range.to,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createSlot, setCreateSlot] = useState<Date | undefined>();
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const handleSelectItem = (item: CalendarItem) => {
    if (item.source === "event") setEditingEventId(item.id);
    else setOpenTaskId(item.taskId);
  };

  const handleSelectSlot = (slot: SlotInfo) => {
    setCreateSlot(slot.start);
    setCreateOpen(true);
  };

  if (error) {
    return (
      <div className="p-6 text-sm text-red-400">
        Failed to load calendar. Please try again.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="flex-1 min-h-0">
          <CalendarView
            items={items}
            onSelectItem={handleSelectItem}
            onSelectSlot={handleSelectSlot}
            onAddEvent={() => {
              setCreateSlot(undefined);
              setCreateOpen(true);
            }}
            onRangeChange={setRange}
          />
        </div>
      )}

      <EventCreateModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateSlot(undefined);
        }}
        caseId={caseId}
        defaultStartsAt={createSlot}
      />
      <EventEditModal
        eventId={editingEventId}
        onClose={() => setEditingEventId(null)}
      />
      <TaskDetailPanel
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add Calendar tab to case page**

In `src/app/(app)/cases/[id]/page.tsx`:

1. Import: `import { CaseCalendar } from "@/components/calendar/case-calendar";`
2. Update `TABS` array to insert `{ key: "calendar", label: "Calendar" }` between `tasks` and `report`:

```ts
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "tasks", label: "Tasks" },
  { key: "calendar", label: "Calendar" },
  { key: "report", label: "Report" },
  { key: "timeline", label: "Timeline" },
  { key: "contracts", label: "Contracts" },
] as const;
```

3. Add tab content below the existing `tasks` tab block:

```tsx
{activeTab === "calendar" && <CaseCalendar caseId={caseData.id} />}
```

- [ ] **Step 3: Typecheck + dev smoke test**

```bash
pnpm tsc --noEmit
pnpm dev
```

Manually: navigate to any case, click Calendar tab. Expect an empty calendar with working nav/view switcher. Click "+ Add Event", fill form, submit — event should appear.

- [ ] **Step 4: Commit**

```bash
git add src/components/calendar/case-calendar.tsx src/app/(app)/cases/[id]/page.tsx
git commit -m "feat(calendar): CaseCalendar + case page tab integration"
```

---

### Task 17: `<GlobalCalendar>` + `/calendar` page

**Files:**
- Create: `src/components/calendar/global-calendar.tsx`
- Create: `src/app/(app)/calendar/page.tsx`

- [ ] **Step 1: Create `global-calendar.tsx`**

```tsx
// src/components/calendar/global-calendar.tsx
"use client";

import { useState } from "react";
import type { SlotInfo } from "react-big-calendar";
import { trpc } from "@/lib/trpc";
import { CalendarView } from "./calendar-view";
import { EventCreateModal } from "./event-create-modal";
import { EventEditModal } from "./event-edit-modal";
import { TaskDetailPanel } from "@/components/cases/tasks/task-detail-panel";
import { useCalendarItems } from "./use-calendar-items";
import type { CalendarItem } from "./calendar-item-utils";

export function GlobalCalendar() {
  const [range, setRange] = useState<{ from: Date; to: Date }>(() => {
    const now = new Date();
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth() + 2, 0),
    };
  });

  // For case filter + case selector in create form.
  const { data: userCases } = trpc.cases.list.useQuery();
  const caseOptions = (userCases ?? []).map((c) => ({ id: c.id, name: c.name }));

  const { items, isLoading, error } = useCalendarItems({
    from: range.from,
    to: range.to,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createSlot, setCreateSlot] = useState<Date | undefined>();
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const handleSelectItem = (item: CalendarItem) => {
    if (item.source === "event") setEditingEventId(item.id);
    else setOpenTaskId(item.taskId);
  };
  const handleSelectSlot = (slot: SlotInfo) => {
    setCreateSlot(slot.start);
    setCreateOpen(true);
  };

  if (error) {
    return (
      <div className="p-6 text-sm text-red-400">
        Failed to load calendar.
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="flex-1 min-h-0">
          <CalendarView
            items={items}
            onSelectItem={handleSelectItem}
            onSelectSlot={handleSelectSlot}
            onAddEvent={() => {
              setCreateSlot(undefined);
              setCreateOpen(true);
            }}
            onRangeChange={setRange}
          />
        </div>
      )}

      <EventCreateModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateSlot(undefined);
        }}
        caseOptions={caseOptions}
        defaultStartsAt={createSlot}
      />
      <EventEditModal
        eventId={editingEventId}
        onClose={() => setEditingEventId(null)}
      />
      <TaskDetailPanel
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  );
}
```

> **Note:** `trpc.cases.list.useQuery()` — verify the exact procedure name by inspecting `src/server/trpc/routers/cases.ts`. If the procedure is named differently (e.g., `list`, `listForUser`, `getAll`), use the correct name and ensure the returned shape has `id` + `name` fields. If nothing matches, pick the closest existing query and map its output accordingly.

- [ ] **Step 2: Create the page**

```tsx
// src/app/(app)/calendar/page.tsx
import { GlobalCalendar } from "@/components/calendar/global-calendar";

export default function CalendarPage() {
  return <GlobalCalendar />;
}
```

- [ ] **Step 3: Typecheck + dev smoke test**

```bash
pnpm tsc --noEmit
```

Navigate to `/calendar` in the browser. Expect a full-screen calendar with items from all cases. "+ Add Event" should show a case selector as the first field.

- [ ] **Step 4: Commit**

```bash
git add src/components/calendar/global-calendar.tsx src/app/(app)/calendar/page.tsx
git commit -m "feat(calendar): GlobalCalendar + /calendar page"
```

---

## Chunk 5: Navigation & Invalidation

### Task 18: Sidebar — add Cases and Calendar entries

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Update `navItems`**

Open `src/components/layout/sidebar.tsx`. Add imports and two entries:

```tsx
import {
  LayoutDashboard,
  FileText,
  Settings,
  Zap,
  Menu,
  FileCheck,
  PenLine,
  Briefcase,        // NEW
  Calendar as CalendarIcon, // NEW
} from "lucide-react";
```

Update `navItems`:

```tsx
const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases", label: "Cases", icon: Briefcase },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/contracts", label: "Contracts", icon: FileCheck },
  { href: "/drafts", label: "Drafts", icon: PenLine },
  { href: "/quick-analysis", label: "Quick Analysis", icon: Zap },
  { href: "/settings/templates", label: "Templates", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];
```

- [ ] **Step 2: Verify `/cases` route exists**

```bash
ls src/app/\(app\)/cases/page.tsx 2>/dev/null && echo "exists" || echo "missing"
```

If **missing**, create a minimal list page in Task 18b below. If **exists**, skip 18b.

- [ ] **Step 2b (only if missing): Create `/cases` list page**

```tsx
// src/app/(app)/cases/page.tsx
"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

export default function CasesPage() {
  const { data, isLoading } = trpc.cases.list.useQuery();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Cases</h1>
      <ul className="space-y-2">
        {(data ?? []).map((c) => (
          <li key={c.id}>
            <Link
              href={`/cases/${c.id}`}
              className="block rounded-md border border-zinc-800 p-3 hover:bg-zinc-900"
            >
              <div className="font-medium">{c.name}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Again — verify `trpc.cases.list` is the correct procedure before writing.

- [ ] **Step 3: Typecheck + dev smoke test**

```bash
pnpm tsc --noEmit
```

Visit `/dashboard` and confirm the sidebar shows Cases and Calendar entries. Click each — Cases should show the list, Calendar should show the global view.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/sidebar.tsx src/app/\(app\)/cases/page.tsx 2>/dev/null || git add src/components/layout/sidebar.tsx
git commit -m "feat(nav): add Cases and Calendar sidebar entries"
```

---

### Task 19: Widen task mutation invalidations to include `listWithDueDate`

**Files:**
- Modify: `src/components/cases/tasks/task-detail-panel.tsx`
- Modify: `src/components/cases/tasks/kanban-board.tsx`
- Modify: `src/components/cases/tasks/task-create-modal.tsx`

- [ ] **Step 1: Task detail panel**

In `src/components/cases/tasks/task-detail-panel.tsx`, find every `onSuccess` callback on `trpc.caseTasks.update.useMutation`, `toggleAssign.useMutation`, and `delete.useMutation`. Add a namespace-wide invalidation call alongside the existing ones:

```ts
utils.caseTasks.listWithDueDate.invalidate();
```

Example for `updateMutation.onSuccess`:

```ts
onSuccess: () => {
  if (task) {
    utils.caseTasks.listByCaseId.invalidate({ caseId: task.caseId });
    utils.caseTasks.getById.invalidate({ taskId: task.id });
    utils.caseTasks.listWithDueDate.invalidate();
  }
},
```

- [ ] **Step 2: Kanban board**

In `src/components/cases/tasks/kanban-board.tsx`, find `reorder` mutation's `onSuccess` and add `utils.caseTasks.listWithDueDate.invalidate();` next to the existing `listByCaseId` invalidation.

- [ ] **Step 3: Create modal**

In `src/components/cases/tasks/task-create-modal.tsx`, find the `create` mutation's `onSuccess` and add the same invalidation.

- [ ] **Step 4: Typecheck**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/cases/tasks/task-detail-panel.tsx \
        src/components/cases/tasks/kanban-board.tsx \
        src/components/cases/tasks/task-create-modal.tsx
git commit -m "feat(tasks): invalidate listWithDueDate on task mutations"
```

---

### Task 20: Final typecheck, test run, and manual UAT smoke

- [ ] **Step 1: Full typecheck and test run**

```bash
pnpm tsc --noEmit
pnpm vitest run
```

Expected: no type errors; all tests pass (3 new calendar tests + existing 2.1.2 tests).

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: successful build. `react-big-calendar` should only appear in chunks for `/calendar` and the case tab route, not in the root bundle. If the bundle report shows rbc in unrelated chunks, re-verify the `dynamic()` wrap on `CalendarView`.

- [ ] **Step 3: Manual UAT checklist** (to run under `/gsd-verify-work` later)

Record these as pending UAT checks — don't check them off in this plan; they're for the verify step:

- Create court_date, filing_deadline, meeting, reminder, and other — each shows the correct color/icon in month view
- Overdue court_date shows red left border; upcoming-24h meeting does NOT (meetings aren't deadline kinds); upcoming-24h filing_deadline shows yellow border
- Task with past dueDate shows red border; done task does not
- Click task on calendar → opens TaskDetailPanel (not event modal)
- Click event → opens EventEditModal with prefilled data
- Edit event with endsAt < startsAt → toast error, modal stays open
- Delete event → disappears from calendar
- Slot click → create modal with startsAt prefilled
- Global `/calendar` shows events from multiple cases
- Creating event on `/calendar` requires case selection
- Sidebar Cases/Calendar entries highlight correctly on case detail pages and /calendar

- [ ] **Step 4: Final commit if anything was touched during smoke**

```bash
git status
# if clean:
git log --oneline -20
```

---

## Summary

20 tasks across 5 chunks. All user-facing behavior from the spec is covered. Every task is self-contained, testable, and commits independently. The plan preserves every design decision from `2026-04-05-calendar-deadlines-design.md` and matches the actual repo layout verified during spec review.
