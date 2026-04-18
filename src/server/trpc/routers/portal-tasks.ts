import { z } from "zod/v4";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { caseTasks } from "@/server/db/schema/case-tasks";
import { cases } from "@/server/db/schema/cases";

export const portalTasksRouter = router({
  list: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      cursor: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const [caseRow] = await ctx.db
        .select({ id: cases.id, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
      const vis = caseRow.portalVisibility as Record<string, boolean> | null;
      if (!vis || vis.tasks === false) throw new TRPCError({ code: "FORBIDDEN" });

      const rows = await ctx.db
        .select({
          id: caseTasks.id,
          title: caseTasks.title,
          description: caseTasks.description,
          status: caseTasks.status,
          dueDate: caseTasks.dueDate,
          createdAt: caseTasks.createdAt,
        })
        .from(caseTasks)
        .where(eq(caseTasks.caseId, input.caseId))
        .orderBy(desc(caseTasks.createdAt))
        .limit(21);

      return {
        tasks: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      };
    }),
});
