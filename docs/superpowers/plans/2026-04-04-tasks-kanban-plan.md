# 2.1.2 Tasks & Kanban Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build task management + Kanban board for ClearTerms cases, instantiating tasks from stage templates and supporting drag-and-drop with switchable grouping (by status / by stage).

**Architecture:** New `case_tasks` table (jsonb checklist), new `caseTasks` tRPC router, integration with existing `changeStage` for auto-creation, new `Tasks` tab on case detail page with `@dnd-kit`-powered Kanban board and slide-over detail panel.

**Tech Stack:** Next.js 16, React 19, tRPC 11, Drizzle ORM, PostgreSQL (Supabase), `@dnd-kit/core` + `@dnd-kit/sortable`, Zod v4, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-04-tasks-kanban-design.md`

**Conventions:**
- Follow existing patterns in `src/server/db/schema/case-stages.ts` for Drizzle schema
- Follow `src/server/trpc/routers/cases.ts` for tRPC procedure style (protectedProcedure + ownership check)
- Follow `src/components/cases/*.tsx` for UI conventions (dark theme zinc-950/zinc-800, shadcn/ui, client components)
- Commit after every completed step
- TDD where practical: schema → types → router procedures → UI

---

## Chunk 1: Data Model & Migration

### Task 1: Add task enums and extend event enum

**Files:**
- Modify: `src/server/db/schema/case-stages.ts` (add new enums, extend `eventTypeEnum`)

- [ ] **Step 1: Extend `eventTypeEnum`**

Edit `src/server/db/schema/case-stages.ts` — add `task_added`, `task_completed`, `task_removed` to the existing `eventTypeEnum` array:

```ts
export const eventTypeEnum = pgEnum("event_type", [
  "stage_changed",
  "document_added",
  "analysis_completed",
  "manual",
  "contract_linked",
  "draft_linked",
  "task_added",
  "task_completed",
  "task_removed",
]);
```

- [ ] **Step 2: Add `taskStatusEnum` and `taskCategoryEnum`**

In the same file, after `taskPriorityEnum`:

```ts
export const taskStatusEnum = pgEnum("task_status", ["todo", "in_progress", "done"]);

export const taskCategoryEnum = pgEnum("task_category", [
  "filing",
  "research",
  "client_communication",
  "evidence",
  "court",
  "administrative",
]);
```

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/case-stages.ts
git commit -m "feat(tasks): add task status/category enums and extend event enum"
```

---

### Task 2: Create `case_tasks` table schema

**Files:**
- Create: `src/server/db/schema/case-tasks.ts`
- Modify: `src/server/db/schema/case-stages.ts` (export imports if needed)

- [ ] **Step 1: Create schema file**

Create `src/server/db/schema/case-tasks.ts`:

```ts
import { pgTable, uuid, text, timestamp, jsonb, integer, index, varchar } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { caseStages, stageTaskTemplates, taskStatusEnum, taskPriorityEnum, taskCategoryEnum } from "./case-stages";
import { users } from "./users";

export type ChecklistItem = {
  id: string;
  title: string;
  completed: boolean;
};

export const caseTasks = pgTable(
  "case_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    stageId: uuid("stage_id").references(() => caseStages.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => stageTaskTemplates.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: taskStatusEnum("status").default("todo").notNull(),
    priority: taskPriorityEnum("priority").default("medium").notNull(),
    category: taskCategoryEnum("category"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    checklist: jsonb("checklist").$type<ChecklistItem[]>().default([]).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_tasks_case_status_idx").on(table.caseId, table.status),
    index("case_tasks_case_stage_idx").on(table.caseId, table.stageId),
    index("case_tasks_case_stage_template_idx").on(table.caseId, table.stageId, table.templateId),
  ],
);
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Push migration to database**

```bash
npx drizzle-kit push
```

Expected: prompts about adding new enum values and new table; accept. Verify no data loss warnings.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema/case-tasks.ts
git commit -m "feat(tasks): add case_tasks table schema with jsonb checklist"
```

---

### Task 3: Write schema smoke test

**Files:**
- Create: `tests/integration/case-tasks-schema.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { caseTasks, type ChecklistItem } from "@/server/db/schema/case-tasks";

describe("case_tasks schema", () => {
  it("exports caseTasks table object", () => {
    expect(caseTasks).toBeDefined();
  });

  it("ChecklistItem type has id, title, completed", () => {
    const item: ChecklistItem = { id: "x", title: "t", completed: false };
    expect(item.id).toBe("x");
    expect(item.title).toBe("t");
    expect(item.completed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run tests/integration/case-tasks-schema.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/case-tasks-schema.test.ts
git commit -m "test(tasks): add case_tasks schema smoke test"
```

---

## Chunk 2: Shared Types & Zod Schemas

### Task 4: Add shared constants and Zod schemas

**Files:**
- Create: `src/lib/case-tasks.ts`

- [ ] **Step 1: Write the module**

```ts
import { z } from "zod/v4";

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_CATEGORIES_LIST = [
  "filing",
  "research",
  "client_communication",
  "evidence",
  "court",
  "administrative",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES_LIST)[number];

export const TASK_PRIORITIES_LIST = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES_LIST)[number];

export const checklistItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  completed: z.boolean(),
});

export const checklistSchema = z.array(checklistItemSchema);

export const TASK_STATUS_META: Record<TaskStatus, { label: string; dotColor: string }> = {
  todo: { label: "To Do", dotColor: "bg-zinc-500" },
  in_progress: { label: "In Progress", dotColor: "bg-blue-500" },
  done: { label: "Done", dotColor: "bg-green-500" },
};

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  filing: "Filing",
  research: "Research",
  client_communication: "Client Comm.",
  evidence: "Evidence",
  court: "Court",
  administrative: "Admin",
};

export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "bg-lime-950 text-lime-400",
  medium: "bg-blue-950 text-blue-400",
  high: "bg-amber-950 text-amber-400",
  urgent: "bg-red-950 text-red-400",
};
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/case-tasks.ts
git commit -m "feat(tasks): add task constants, types, and Zod schemas"
```

---

## Chunk 3: tRPC Router — `caseTasks`

### Task 5: Scaffold `caseTasks` router with `listByCaseId` query

**Files:**
- Create: `src/server/trpc/routers/case-tasks.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Create router with `listByCaseId`**

```ts
// src/server/trpc/routers/case-tasks.ts
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { and, asc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { cases } from "@/server/db/schema/cases";
import { caseTasks } from "@/server/db/schema/case-tasks";
import { caseStages } from "@/server/db/schema/case-stages";

async function assertCaseOwnership(ctx: { db: typeof import("@/server/db").db; user: { id: string } }, caseId: string) {
  const [c] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.userId, ctx.user.id)))
    .limit(1);
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
  return c;
}

async function assertTaskOwnership(
  ctx: { db: typeof import("@/server/db").db; user: { id: string } },
  taskId: string,
) {
  const [row] = await ctx.db
    .select({ task: caseTasks, case: cases })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .where(and(eq(caseTasks.id, taskId), eq(cases.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  return row.task;
}

export const caseTasksRouter = router({
  listByCaseId: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        groupBy: z.enum(["status", "stage"]).default("status"),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCaseOwnership(ctx, input.caseId);

      const rows = await ctx.db
        .select({
          task: caseTasks,
          stageName: caseStages.name,
          stageColor: caseStages.color,
          stageSortOrder: caseStages.sortOrder,
        })
        .from(caseTasks)
        .leftJoin(caseStages, eq(caseStages.id, caseTasks.stageId))
        .where(eq(caseTasks.caseId, input.caseId))
        .orderBy(asc(caseTasks.sortOrder));

      return rows.map((r) => ({
        ...r.task,
        stageName: r.stageName,
        stageColor: r.stageColor,
        stageSortOrder: r.stageSortOrder,
      }));
    }),
});
```

- [ ] **Step 2: Register router in root**

Edit `src/server/trpc/root.ts`:

```ts
import { caseTasksRouter } from "./routers/case-tasks";

export const appRouter = router({
  // ... existing routers
  caseTasks: caseTasksRouter,
});
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/case-tasks.ts src/server/trpc/root.ts
git commit -m "feat(tasks): scaffold caseTasks tRPC router with listByCaseId query"
```

---

### Task 6: Add `getById` and `create` procedures

**Files:**
- Modify: `src/server/trpc/routers/case-tasks.ts`

- [ ] **Step 1: Add `getById` query**

Add to the router object:

```ts
getById: protectedProcedure
  .input(z.object({ taskId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    return assertTaskOwnership(ctx, input.taskId);
  }),
```

- [ ] **Step 2: Add `create` mutation**

```ts
create: protectedProcedure
  .input(
    z.object({
      caseId: z.string().uuid(),
      title: z.string().min(1).max(500),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      category: z
        .enum(["filing", "research", "client_communication", "evidence", "court", "administrative"])
        .optional(),
      dueDate: z.date().optional(),
      stageId: z.string().uuid().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    await assertCaseOwnership(ctx, input.caseId);

    const result = await ctx.db.transaction(async (tx) => {
      const [task] = await tx
        .insert(caseTasks)
        .values({
          caseId: input.caseId,
          stageId: input.stageId ?? null,
          title: input.title,
          description: input.description,
          priority: input.priority,
          category: input.category,
          dueDate: input.dueDate,
          status: "todo",
          templateId: null,
        })
        .returning();

      await tx.insert(caseEvents).values({
        caseId: input.caseId,
        type: "task_added",
        title: `Task added: ${input.title}`,
        metadata: { taskId: task.id },
        actorId: ctx.user.id,
      });

      return task;
    });

    return result;
  }),
```

Also add import at top: `import { caseEvents } from "@/server/db/schema/case-stages";`

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/case-tasks.ts
git commit -m "feat(tasks): add getById and create procedures to caseTasks router"
```

---

### Task 7: Add `update`, `toggleAssign`, `delete` procedures

**Files:**
- Modify: `src/server/trpc/routers/case-tasks.ts`

- [ ] **Step 1: Add `update` mutation**

```ts
update: protectedProcedure
  .input(
    z.object({
      taskId: z.string().uuid(),
      title: z.string().min(1).max(500).optional(),
      description: z.string().nullable().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      status: z.enum(["todo", "in_progress", "done"]).optional(),
      category: z
        .enum(["filing", "research", "client_communication", "evidence", "court", "administrative"])
        .nullable()
        .optional(),
      dueDate: z.date().nullable().optional(),
      assignedTo: z.string().uuid().nullable().optional(),
      checklist: checklistSchema.optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const existing = await assertTaskOwnership(ctx, input.taskId);

    const now = new Date();
    let completedAt: Date | null | undefined;
    const wasCompleted = existing.status === "done";
    const willBeCompleted = input.status === "done";

    if (!wasCompleted && willBeCompleted) completedAt = now;
    else if (wasCompleted && input.status && input.status !== "done") completedAt = null;

    const { taskId, ...updates } = input;
    const [updated] = await ctx.db
      .update(caseTasks)
      .set({
        ...updates,
        ...(completedAt !== undefined ? { completedAt } : {}),
        updatedAt: now,
      })
      .where(eq(caseTasks.id, taskId))
      .returning();

    // Log completion event
    if (!wasCompleted && willBeCompleted) {
      await ctx.db.insert(caseEvents).values({
        caseId: existing.caseId,
        type: "task_completed",
        title: `Task completed: ${updated.title}`,
        metadata: { taskId: updated.id },
        actorId: ctx.user.id,
      });
    }

    return updated;
  }),
```

Also import `checklistSchema` at top: `import { checklistSchema } from "@/lib/case-tasks";`

- [ ] **Step 2: Add `toggleAssign` mutation**

```ts
toggleAssign: protectedProcedure
  .input(z.object({ taskId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const task = await assertTaskOwnership(ctx, input.taskId);
    const newAssignee = task.assignedTo === ctx.user.id ? null : ctx.user.id;

    const [updated] = await ctx.db
      .update(caseTasks)
      .set({ assignedTo: newAssignee, updatedAt: new Date() })
      .where(eq(caseTasks.id, input.taskId))
      .returning();
    return updated;
  }),
```

- [ ] **Step 3: Add `delete` mutation**

```ts
delete: protectedProcedure
  .input(z.object({ taskId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const task = await assertTaskOwnership(ctx, input.taskId);

    await ctx.db.transaction(async (tx) => {
      await tx.delete(caseTasks).where(eq(caseTasks.id, input.taskId));
      await tx.insert(caseEvents).values({
        caseId: task.caseId,
        type: "task_removed",
        title: `Task removed: ${task.title}`,
        metadata: { taskId: task.id },
        actorId: ctx.user.id,
      });
    });

    return { success: true };
  }),
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/server/trpc/routers/case-tasks.ts
git commit -m "feat(tasks): add update, toggleAssign, delete procedures"
```

---

### Task 8: Add `reorder` and `createFromTemplates` procedures

**Files:**
- Modify: `src/server/trpc/routers/case-tasks.ts`

- [ ] **Step 1: Add `reorder` mutation**

```ts
reorder: protectedProcedure
  .input(
    z.object({
      caseId: z.string().uuid(),
      columnItems: z.array(
        z.object({
          taskId: z.string().uuid(),
          sortOrder: z.number().int(),
        }),
      ),
      targetStageId: z.string().uuid().nullable().optional(),
      movedTaskId: z.string().uuid().optional(),
      targetStatus: z.enum(["todo", "in_progress", "done"]).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    await assertCaseOwnership(ctx, input.caseId);

    await ctx.db.transaction(async (tx) => {
      for (const item of input.columnItems) {
        await tx
          .update(caseTasks)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(and(eq(caseTasks.id, item.taskId), eq(caseTasks.caseId, input.caseId)));
      }

      // If a task was moved between columns (stage or status changed)
      if (input.movedTaskId && (input.targetStageId !== undefined || input.targetStatus)) {
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (input.targetStageId !== undefined) updates.stageId = input.targetStageId;
        if (input.targetStatus) {
          updates.status = input.targetStatus;
          if (input.targetStatus === "done") updates.completedAt = new Date();
          else updates.completedAt = null;
        }
        await tx
          .update(caseTasks)
          .set(updates)
          .where(and(eq(caseTasks.id, input.movedTaskId), eq(caseTasks.caseId, input.caseId)));
      }
    });

    return { success: true };
  }),
```

- [ ] **Step 2: Add `createFromTemplates` mutation**

```ts
createFromTemplates: protectedProcedure
  .input(z.object({ caseId: z.string().uuid(), stageId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    await assertCaseOwnership(ctx, input.caseId);
    return createTasksFromTemplatesInternal(ctx.db, input.caseId, input.stageId);
  }),
```

- [ ] **Step 3: Add internal helper exported for reuse**

At the bottom of the file, above the router export:

```ts
export async function createTasksFromTemplatesInternal(
  db: typeof import("@/server/db").db,
  caseId: string,
  stageId: string,
) {
  // Check if any tasks already exist for this (caseId, stageId)
  const existing = await db
    .select({ id: caseTasks.id })
    .from(caseTasks)
    .where(and(eq(caseTasks.caseId, caseId), eq(caseTasks.stageId, stageId)))
    .limit(1);

  if (existing.length > 0) return { created: 0 };

  const templates = await db
    .select()
    .from(stageTaskTemplates)
    .where(eq(stageTaskTemplates.stageId, stageId))
    .orderBy(asc(stageTaskTemplates.sortOrder));

  if (templates.length === 0) return { created: 0 };

  const validCategories = ["filing", "research", "client_communication", "evidence", "court", "administrative"] as const;
  type ValidCategory = (typeof validCategories)[number];

  const insertValues = templates.map((t) => ({
    caseId,
    stageId,
    templateId: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    category: (validCategories.includes(t.category as ValidCategory) ? t.category : null) as ValidCategory | null,
    sortOrder: t.sortOrder,
    status: "todo" as const,
  }));

  await db.insert(caseTasks).values(insertValues);
  return { created: insertValues.length };
}
```

Also add import: `import { stageTaskTemplates } from "@/server/db/schema/case-stages";`

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/server/trpc/routers/case-tasks.ts
git commit -m "feat(tasks): add reorder and createFromTemplates procedures"
```

---

### Task 9: Integrate auto-task creation into `changeStage`

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Import the helper**

At the top of `cases.ts`, add:

```ts
import { createTasksFromTemplatesInternal } from "./case-tasks";
```

- [ ] **Step 2: Call it inside the `changeStage` transaction**

Inside the `ctx.db.transaction` block of `changeStage`, after the `caseEvents` insert and before `return updated`, add:

```ts
const templateResult = await createTasksFromTemplatesInternal(tx as typeof ctx.db, input.caseId, input.stageId);

if (templateResult.created > 0) {
  await tx.insert(caseEvents).values({
    caseId: input.caseId,
    type: "manual",
    title: `${templateResult.created} tasks created for stage ${newStage.name}`,
    metadata: { stageId: input.stageId, taskCount: templateResult.created },
    actorId: ctx.user.id,
  });
}
```

Note: we use existing `manual` event type for the aggregate; individual task additions use `task_added`.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. Note: the helper accepts `typeof db`; if tx type is different, cast as shown.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat(tasks): auto-create tasks from templates on stage change"
```

---

### Task 10: Integration tests for tRPC procedures

**Files:**
- Create: `tests/integration/case-tasks-router.test.ts`

- [ ] **Step 1: Write unit tests for shared constants**

Start with simple, no-DB tests for `src/lib/case-tasks.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  TASK_STATUSES,
  TASK_CATEGORIES_LIST,
  TASK_PRIORITIES_LIST,
  checklistSchema,
} from "@/lib/case-tasks";

describe("case-tasks constants", () => {
  it("has 3 statuses", () => {
    expect(TASK_STATUSES).toEqual(["todo", "in_progress", "done"]);
  });

  it("has 6 categories", () => {
    expect(TASK_CATEGORIES_LIST).toHaveLength(6);
  });

  it("has 4 priorities", () => {
    expect(TASK_PRIORITIES_LIST).toHaveLength(4);
  });

  it("checklistSchema validates valid items", () => {
    const result = checklistSchema.safeParse([{ id: "1", title: "step", completed: false }]);
    expect(result.success).toBe(true);
  });

  it("checklistSchema rejects empty title", () => {
    const result = checklistSchema.safeParse([{ id: "1", title: "", completed: false }]);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/integration/case-tasks-router.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/case-tasks-router.test.ts
git commit -m "test(tasks): add case-tasks constants and Zod schema tests"
```

---

## Chunk 4: UI — Kanban Board Foundation

### Task 11: Install `@dnd-kit` dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected: adds 3 packages, no peer dep warnings related to React.

- [ ] **Step 2: Verify install**

```bash
npm ls @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected: all 3 listed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(tasks): install @dnd-kit for kanban drag-and-drop"
```

---

### Task 12: Create `task-card.tsx`

**Files:**
- Create: `src/components/cases/tasks/task-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { format, isPast } from "date-fns";
import { cn } from "@/lib/utils";
import {
  TASK_PRIORITY_COLORS,
  TASK_CATEGORY_LABELS,
  type TaskStatus,
  type TaskPriority,
  type TaskCategory,
} from "@/lib/case-tasks";

export type TaskCardData = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory | null;
  dueDate: Date | null;
  checklist: { id: string; title: string; completed: boolean }[];
  assignedTo: string | null;
};

interface Props {
  task: TaskCardData;
  onClick?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function TaskCard({ task, onClick, dragHandleProps }: Props) {
  const overdue = task.dueDate && isPast(task.dueDate) && task.status !== "done";
  const done = task.status === "done";
  const checklistTotal = task.checklist.length;
  const checklistDone = task.checklist.filter((c) => c.completed).length;

  return (
    <div
      {...dragHandleProps}
      onClick={onClick}
      className={cn(
        "rounded-lg border bg-zinc-900 p-3 mb-2 cursor-pointer transition-colors hover:border-zinc-700",
        overdue ? "border-red-600" : "border-zinc-800",
        done && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={cn("text-sm font-medium text-zinc-50", done && "line-through")}>
          {task.title}
        </span>
        <span className={cn("text-[11px] px-2 py-0.5 rounded whitespace-nowrap", TASK_PRIORITY_COLORS[task.priority])}>
          {task.priority}
        </span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        {task.category && <span>{TASK_CATEGORY_LABELS[task.category]}</span>}
        {task.dueDate && (
          <span className={cn(overdue && "text-red-400")}>
            {overdue && "⚠ "}
            {format(task.dueDate, "MMM d")}
          </span>
        )}
      </div>

      {checklistTotal > 0 && (
        <div className="flex items-center gap-1 mt-2">
          <div className="flex-1 h-[3px] bg-zinc-800 rounded">
            <div
              className="h-full bg-blue-500 rounded"
              style={{ width: `${(checklistDone / checklistTotal) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-zinc-600">
            {checklistDone}/{checklistTotal}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/tasks/task-card.tsx
git commit -m "feat(tasks): add TaskCard component"
```

---

### Task 13: Create `kanban-column.tsx`

**Files:**
- Create: `src/components/cases/tasks/kanban-column.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { TaskCard, type TaskCardData } from "./task-card";
import { cn } from "@/lib/utils";

interface Props {
  id: string;
  label: string;
  dotColor: string;
  tasks: TaskCardData[];
  onTaskClick: (taskId: string) => void;
}

function SortableTask({ task, onClick }: { task: TaskCardData; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} onClick={onClick} />
    </div>
  );
}

export function KanbanColumn({ id, label, dotColor, tasks, onTaskClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex-1 min-w-[240px]">
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("w-2 h-2 rounded-full", dotColor)} />
        <span className="text-sm font-medium text-zinc-50">{label}</span>
        <span className="text-xs text-zinc-500">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "min-h-[200px] rounded p-1 transition-colors",
            isOver && "bg-zinc-900/50",
          )}
        >
          {tasks.map((task) => (
            <SortableTask key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/cases/tasks/kanban-column.tsx
git commit -m "feat(tasks): add KanbanColumn with droppable + sortable"
```

---

### Task 14: Create `kanban-board.tsx`

**Files:**
- Create: `src/components/cases/tasks/kanban-board.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, useMemo } from "react";
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "./kanban-column";
import type { TaskCardData } from "./task-card";
import { trpc } from "@/lib/trpc/client";
import { TASK_STATUS_META, type TaskStatus } from "@/lib/case-tasks";
import { toast } from "sonner";

interface Props {
  caseId: string;
  onTaskClick: (taskId: string) => void;
  onAddTask: () => void;
}

type TaskWithStage = TaskCardData & {
  stageId: string | null;
  stageName: string | null;
  stageColor: string | null;
  stageSortOrder: number | null;
  sortOrder: number;
};

export function KanbanBoard({ caseId, onTaskClick, onAddTask }: Props) {
  const [groupBy, setGroupBy] = useState<"status" | "stage">("status");
  const utils = trpc.useUtils();

  const { data: tasks = [] } = trpc.caseTasks.listByCaseId.useQuery({ caseId, groupBy });
  const reorderMutation = trpc.caseTasks.reorder.useMutation({
    onSuccess: () => utils.caseTasks.listByCaseId.invalidate({ caseId }),
    onError: (e) => toast.error(e.message),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const typedTasks = tasks as unknown as TaskWithStage[];

  const overdue = useMemo(
    () =>
      typedTasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done",
      ).length,
    [typedTasks],
  );

  const columns = useMemo(() => {
    if (groupBy === "status") {
      return (Object.keys(TASK_STATUS_META) as TaskStatus[]).map((status) => ({
        id: `status:${status}`,
        label: TASK_STATUS_META[status].label,
        dotColor: TASK_STATUS_META[status].dotColor,
        tasks: typedTasks
          .filter((t) => t.status === status)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }));
    }
    // group by stage
    const stageMap = new Map<string, { name: string; color: string; order: number; tasks: TaskWithStage[] }>();
    for (const t of typedTasks) {
      const key = t.stageId ?? "no-stage";
      if (!stageMap.has(key)) {
        stageMap.set(key, {
          name: t.stageName ?? "No stage",
          color: t.stageColor ?? "#71717a",
          order: t.stageSortOrder ?? 999,
          tasks: [],
        });
      }
      stageMap.get(key)!.tasks.push(t);
    }
    return Array.from(stageMap.entries())
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([key, val]) => ({
        id: `stage:${key}`,
        label: val.name,
        dotColor: "bg-zinc-500",
        tasks: val.tasks.sort((a, b) => a.sortOrder - b.sortOrder),
      }));
  }, [typedTasks, groupBy]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;

    const activeTask = typedTasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overId = String(over.id);
    const overTask = typedTasks.find((t) => t.id === overId);

    let targetColumnId: string | null = null;
    if (overId.startsWith("status:") || overId.startsWith("stage:")) {
      targetColumnId = overId;
    } else if (overTask) {
      targetColumnId =
        groupBy === "status" ? `status:${overTask.status}` : `stage:${overTask.stageId ?? "no-stage"}`;
    }
    if (!targetColumnId) return;

    const targetColumn = columns.find((c) => c.id === targetColumnId);
    if (!targetColumn) return;

    // Build new ordered list for target column
    const withoutActive = targetColumn.tasks.filter((t) => t.id !== activeTask.id);
    const overIndex = overTask ? withoutActive.findIndex((t) => t.id === overTask.id) : withoutActive.length;
    const newList = [...withoutActive];
    newList.splice(overIndex >= 0 ? overIndex : newList.length, 0, activeTask);

    const columnItems = newList.map((t, idx) => ({ taskId: t.id, sortOrder: idx }));
    const payload: Parameters<typeof reorderMutation.mutate>[0] = {
      caseId,
      columnItems,
      movedTaskId: activeTask.id,
    };

    if (groupBy === "status") {
      const newStatus = targetColumnId.replace("status:", "") as TaskStatus;
      if (newStatus !== activeTask.status) payload.targetStatus = newStatus;
    } else {
      const newStageId = targetColumnId.replace("stage:", "");
      const resolvedStageId = newStageId === "no-stage" ? null : newStageId;
      if (resolvedStageId !== activeTask.stageId) payload.targetStageId = resolvedStageId;
    }

    reorderMutation.mutate(payload);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-md text-xs">
            <button
              onClick={() => setGroupBy("status")}
              className={`px-3 py-1.5 rounded ${groupBy === "status" ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"}`}
            >
              By Status
            </button>
            <button
              onClick={() => setGroupBy("stage")}
              className={`px-3 py-1.5 rounded ${groupBy === "stage" ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"}`}
            >
              By Stage
            </button>
          </div>
          <span className="text-xs text-zinc-500">
            {typedTasks.length} tasks · {overdue} overdue
          </span>
        </div>
        <button
          onClick={onAddTask}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
        >
          + Add Task
        </button>
      </div>

      {/* Columns */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="flex-1 flex gap-3 p-5 overflow-x-auto">
          {columns.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              label={col.label}
              dotColor={col.dotColor}
              tasks={col.tasks}
              onTaskClick={onTaskClick}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/cases/tasks/kanban-board.tsx
git commit -m "feat(tasks): add KanbanBoard with DnD and groupBy toggle"
```

---

## Chunk 5: UI — Task Detail Panel & Create Modal

### Task 15: Create `task-checklist.tsx`

**Files:**
- Create: `src/components/cases/tasks/task-checklist.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "@/server/db/schema/case-tasks";

interface Props {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}

export function TaskChecklist({ items, onChange }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const doneCount = items.filter((i) => i.completed).length;

  function toggle(id: string) {
    onChange(items.map((i) => (i.id === id ? { ...i, completed: !i.completed } : i)));
  }

  function remove(id: string) {
    onChange(items.filter((i) => i.id !== id));
  }

  function add() {
    if (!newTitle.trim()) return;
    onChange([
      ...items,
      { id: crypto.randomUUID(), title: newTitle.trim(), completed: false },
    ]);
    setNewTitle("");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500">
          Checklist <span className="text-zinc-700">{doneCount}/{items.length}</span>
        </div>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 p-1.5 bg-zinc-900 rounded group">
            <button
              onClick={() => toggle(item.id)}
              className={cn(
                "w-4 h-4 rounded border flex items-center justify-center text-[10px]",
                item.completed ? "bg-blue-600 border-blue-600 text-white" : "border-zinc-700",
              )}
            >
              {item.completed && "✓"}
            </button>
            <span className={cn("text-xs flex-1 text-zinc-200", item.completed && "line-through text-zinc-500")}>
              {item.title}
            </span>
            <button onClick={() => remove(item.id)} className="text-xs text-zinc-600 opacity-0 group-hover:opacity-100">
              ✕
            </button>
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add item..."
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-700"
          />
          <button onClick={add} className="px-2 py-1 text-xs text-blue-400 hover:text-blue-300">
            + Add
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/cases/tasks/task-checklist.tsx
git commit -m "feat(tasks): add TaskChecklist component"
```

---

### Task 16: Create `task-detail-panel.tsx`

**Files:**
- Create: `src/components/cases/tasks/task-detail-panel.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc/client";
import { TaskChecklist } from "./task-checklist";
import {
  TASK_STATUSES,
  TASK_CATEGORIES_LIST,
  TASK_PRIORITIES_LIST,
  TASK_STATUS_META,
  TASK_CATEGORY_LABELS,
  TASK_PRIORITY_COLORS,
  type TaskStatus,
  type TaskCategory,
  type TaskPriority,
} from "@/lib/case-tasks";
import type { ChecklistItem } from "@/server/db/schema/case-tasks";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  taskId: string | null;
  onClose: () => void;
}

export function TaskDetailPanel({ taskId, onClose }: Props) {
  const utils = trpc.useUtils();
  const { data: task } = trpc.caseTasks.getById.useQuery(
    { taskId: taskId! },
    { enabled: !!taskId },
  );

  const updateMutation = trpc.caseTasks.update.useMutation({
    onSuccess: () => {
      if (task) {
        utils.caseTasks.listByCaseId.invalidate({ caseId: task.caseId });
        utils.caseTasks.getById.invalidate({ taskId: task.id });
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const toggleAssignMutation = trpc.caseTasks.toggleAssign.useMutation({
    onSuccess: () => {
      if (task) utils.caseTasks.getById.invalidate({ taskId: task.id });
    },
  });
  const deleteMutation = trpc.caseTasks.delete.useMutation({
    onSuccess: () => {
      if (task) utils.caseTasks.listByCaseId.invalidate({ caseId: task.caseId });
      onClose();
      toast.success("Task deleted");
    },
  });

  // Local state for inline editing
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setChecklist((task.checklist as ChecklistItem[]) ?? []);
    }
  }, [task?.id]);

  function scheduleSave(updates: Record<string, unknown>) {
    if (!task) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateMutation.mutate({ taskId: task.id, ...updates });
    }, 500);
  }

  function flushSave() {
    if (!task || !debounceRef.current) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = null;
    const pendingUpdates: Record<string, unknown> = {};
    if (title !== task.title) pendingUpdates.title = title;
    if (description !== (task.description ?? "")) pendingUpdates.description = description;
    if (Object.keys(pendingUpdates).length > 0) {
      updateMutation.mutate({ taskId: task.id, ...pendingUpdates });
    }
  }

  // Flush on unmount / close
  useEffect(() => {
    return () => flushSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!taskId) return null;
  if (!task) {
    return (
      <div className="fixed right-0 top-0 h-full w-[400px] bg-zinc-950 border-l border-zinc-800 z-50 flex items-center justify-center text-zinc-500 text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="fixed right-0 top-0 h-full w-[400px] bg-zinc-950 border-l border-zinc-800 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <span className="text-sm font-semibold text-zinc-50">Task Details</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (confirm("Delete this task?")) deleteMutation.mutate({ taskId: task.id });
            }}
            className="text-xs text-red-500 hover:text-red-400"
          >
            Delete
          </button>
          <button onClick={() => { flushSave(); onClose(); }} className="text-zinc-600 hover:text-zinc-400">
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Title */}
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave({ title: e.target.value });
          }}
          className="bg-transparent border-none text-zinc-50 text-base font-semibold w-full outline-none mb-5 border-b border-dashed border-zinc-700 pb-1"
        />

        {/* Meta grid */}
        <div className="grid grid-cols-[100px_1fr] gap-x-2 gap-y-3 mb-5 text-xs">
          <span className="text-zinc-500">Status</span>
          <select
            value={task.status}
            onChange={(e) =>
              updateMutation.mutate({ taskId: task.id, status: e.target.value as TaskStatus })
            }
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-50 outline-none w-fit"
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_META[s].label}
              </option>
            ))}
          </select>

          <span className="text-zinc-500">Priority</span>
          <select
            value={task.priority}
            onChange={(e) =>
              updateMutation.mutate({ taskId: task.id, priority: e.target.value as TaskPriority })
            }
            className={cn(
              "border rounded px-2 py-1 outline-none w-fit",
              TASK_PRIORITY_COLORS[task.priority],
              "border-transparent",
            )}
          >
            {TASK_PRIORITIES_LIST.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <span className="text-zinc-500">Category</span>
          <select
            value={task.category ?? ""}
            onChange={(e) =>
              updateMutation.mutate({
                taskId: task.id,
                category: (e.target.value || null) as TaskCategory | null,
              })
            }
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 outline-none w-fit"
          >
            <option value="">—</option>
            {TASK_CATEGORIES_LIST.map((c) => (
              <option key={c} value={c}>
                {TASK_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>

          <span className="text-zinc-500">Due date</span>
          <input
            type="date"
            value={task.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd") : ""}
            onChange={(e) =>
              updateMutation.mutate({
                taskId: task.id,
                dueDate: e.target.value ? new Date(e.target.value) : null,
              })
            }
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 outline-none w-fit"
          />

          <span className="text-zinc-500">Assigned</span>
          <button
            onClick={() => toggleAssignMutation.mutate({ taskId: task.id })}
            className="text-blue-400 hover:text-blue-300 text-left w-fit"
          >
            {task.assignedTo ? "Assigned to you — unassign" : "Assign to me"}
          </button>
        </div>

        {/* Description */}
        <div className="mb-5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">Description</div>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              scheduleSave({ description: e.target.value });
            }}
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-xs text-zinc-200 outline-none focus:border-zinc-700"
          />
        </div>

        {/* Checklist */}
        <div className="mb-5">
          <TaskChecklist
            items={checklist}
            onChange={(items) => {
              setChecklist(items);
              updateMutation.mutate({ taskId: task.id, checklist: items });
            }}
          />
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-900 pt-3 text-[11px] text-zinc-700">
          Created {format(new Date(task.createdAt), "MMM d, yyyy")} ·{" "}
          {task.templateId ? "From template" : "Manual"}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/cases/tasks/task-detail-panel.tsx
git commit -m "feat(tasks): add TaskDetailPanel with inline editing and autosave"
```

---

### Task 17: Create `task-create-modal.tsx`

**Files:**
- Create: `src/components/cases/tasks/task-create-modal.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import {
  TASK_CATEGORIES_LIST,
  TASK_PRIORITIES_LIST,
  TASK_CATEGORY_LABELS,
  type TaskPriority,
  type TaskCategory,
} from "@/lib/case-tasks";
import { toast } from "sonner";

interface Props {
  caseId: string;
  currentStageId: string | null;
  open: boolean;
  onClose: () => void;
}

export function TaskCreateModal({ caseId, currentStageId, open, onClose }: Props) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [category, setCategory] = useState<TaskCategory | "">("");
  const [dueDate, setDueDate] = useState("");

  const createMutation = trpc.caseTasks.create.useMutation({
    onSuccess: () => {
      utils.caseTasks.listByCaseId.invalidate({ caseId });
      toast.success("Task created");
      reset();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function reset() {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setCategory("");
    setDueDate("");
  }

  function submit() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    createMutation.mutate({
      caseId,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      category: category || undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      stageId: currentStageId ?? undefined,
    });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-md p-5"
      >
        <div className="text-sm font-semibold text-zinc-50 mb-4">Add task</div>

        <div className="space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title *"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-2 text-xs text-zinc-200 outline-none"
            >
              {TASK_PRIORITIES_LIST.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TaskCategory | "")}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-2 text-xs text-zinc-200 outline-none"
            >
              <option value="">No category</option>
              {TASK_CATEGORIES_LIST.map((c) => (
                <option key={c} value={c}>
                  {TASK_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-zinc-200 outline-none"
          />
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={createMutation.isPending}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/cases/tasks/task-create-modal.tsx
git commit -m "feat(tasks): add TaskCreateModal for manual task creation"
```

---

## Chunk 6: Integration — Tasks Tab on Case Page

### Task 18: Add Tasks tab to case detail page

**Files:**
- Modify: `src/app/(app)/cases/[id]/page.tsx`
- Create: `src/components/cases/tasks/tasks-tab.tsx`

- [ ] **Step 1: Create wrapper `tasks-tab.tsx`**

```tsx
"use client";

import { useState } from "react";
import { KanbanBoard } from "./kanban-board";
import { TaskDetailPanel } from "./task-detail-panel";
import { TaskCreateModal } from "./task-create-modal";

interface Props {
  caseId: string;
  currentStageId: string | null;
}

export function TasksTab({ caseId, currentStageId }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <KanbanBoard
        caseId={caseId}
        onTaskClick={setSelectedTaskId}
        onAddTask={() => setCreateOpen(true)}
      />
      <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      <TaskCreateModal
        caseId={caseId}
        currentStageId={currentStageId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}
```

- [ ] **Step 2: Integrate into case detail page**

Read `src/app/(app)/cases/[id]/page.tsx` to find the tabs array and tab content switch. Add:

1. Import: `import { TasksTab } from "@/components/cases/tasks/tasks-tab";`
2. Insert `"tasks"` into the tabs array at index 1 (between overview and report)
3. Add label `Tasks` and corresponding tab content rendering `<TasksTab caseId={caseId} currentStageId={caseRecord.stageId} />`

Exact edits will depend on current file structure — preserve existing tab logic, just add the new tab.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

Open a case → verify:
1. "Tasks" tab appears between Overview and Report
2. Kanban board renders (empty if no tasks yet)
3. Changing stage auto-creates template tasks
4. "+ Add Task" opens modal
5. Clicking a card opens detail panel
6. Drag-and-drop between columns works
7. Edits in detail panel autosave

- [ ] **Step 5: Commit**

```bash
git add src/components/cases/tasks/tasks-tab.tsx src/app/\(app\)/cases/\[id\]/page.tsx
git commit -m "feat(tasks): add Tasks tab with Kanban, detail panel, and create modal"
```

---

### Task 19: Run full build + test suite

**Files:** n/a

- [ ] **Step 1: Run build**

```bash
npm run build
```

Expected: success (or pre-existing Stripe webhook error; verify no new errors from this feature).

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```

Expected: all tests pass (84+ from 2.1.1 + new 2.1.2 tests).

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no new errors from files created in this plan.

- [ ] **Step 4: Final commit if fixes needed**

If any step required fixes:

```bash
git add .
git commit -m "fix(tasks): resolve build/lint issues"
```

---

## Summary

**Chunks:**
1. Data Model & Migration — Tasks 1–3
2. Shared Types & Zod Schemas — Task 4
3. tRPC Router — Tasks 5–10
4. UI — Kanban Board Foundation — Tasks 11–14
5. UI — Task Detail Panel & Create Modal — Tasks 15–17
6. Integration — Tasks Tab on Case Page — Tasks 18–19

**Key files created:**
- `src/server/db/schema/case-tasks.ts`
- `src/server/trpc/routers/case-tasks.ts`
- `src/lib/case-tasks.ts`
- `src/components/cases/tasks/{kanban-board,kanban-column,task-card,task-detail-panel,task-create-modal,task-checklist,tasks-tab}.tsx`
- `tests/integration/case-tasks-{schema,router}.test.ts`

**Key files modified:**
- `src/server/db/schema/case-stages.ts` (new enums + extended eventTypeEnum)
- `src/server/trpc/routers/cases.ts` (integrate auto-task creation)
- `src/server/trpc/root.ts` (register router)
- `src/app/(app)/cases/[id]/page.tsx` (new tab)
- `package.json` (add @dnd-kit)

**Commits expected:** ~19 (one per task step cluster).
