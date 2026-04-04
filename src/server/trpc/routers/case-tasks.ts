import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { and, asc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { cases } from "@/server/db/schema/cases";
import { caseTasks } from "@/server/db/schema/case-tasks";
import { caseStages } from "@/server/db/schema/case-stages";

async function assertCaseOwnership(
  ctx: { db: typeof import("@/server/db").db; user: { id: string } },
  caseId: string,
) {
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
