import { z } from "zod/v4";
import { and, asc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { caseTasks } from "@/server/db/schema/case-tasks";
import { caseStages, caseEvents, stageTaskTemplates } from "@/server/db/schema/case-stages";
import { checklistSchema } from "@/lib/case-tasks";
import { assertCaseOwnership, assertTaskOwnership } from "../lib/case-auth";

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

  getById: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return assertTaskOwnership(ctx, input.taskId);
    }),

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

  createFromTemplates: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), stageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseOwnership(ctx, input.caseId);
      return createTasksFromTemplatesInternal(ctx.db, input.caseId, input.stageId);
    }),
});

// Accepts either the root db or a transaction handle
type DbOrTx =
  | Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0]
  | typeof import("@/server/db").db;

export async function createTasksFromTemplatesInternal(
  db: DbOrTx,
  caseId: string,
  stageId: string,
) {
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

  const validCategories = [
    "filing",
    "research",
    "client_communication",
    "evidence",
    "court",
    "administrative",
  ] as const;
  type ValidCategory = (typeof validCategories)[number];

  const insertValues = templates.map((t) => ({
    caseId,
    stageId,
    templateId: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    category: (validCategories.includes(t.category as ValidCategory)
      ? (t.category as ValidCategory)
      : null) as ValidCategory | null,
    sortOrder: t.sortOrder,
    status: "todo" as const,
  }));

  await db.insert(caseTasks).values(insertValues);
  return { created: insertValues.length };
}
