import { z } from "zod/v4";
import { and, eq, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { cases } from "@/server/db/schema/cases";

export const portalCasesRouter = router({
  list: portalProcedure
    .input(z.object({ cursor: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(cases.clientId, ctx.portalUser.clientId)];

      // Cursor-based pagination
      if (input?.cursor) {
        const [cursorRow] = await ctx.db
          .select({ createdAt: cases.createdAt })
          .from(cases)
          .where(eq(cases.id, input.cursor))
          .limit(1);
        if (cursorRow) {
          conditions.push(sql`${cases.createdAt} < ${cursorRow.createdAt}`);
        }
      }

      const rows = await ctx.db
        .select({
          id: cases.id,
          name: cases.name,
          status: cases.status,
          detectedCaseType: cases.detectedCaseType,
          portalVisibility: cases.portalVisibility,
          createdAt: cases.createdAt,
          updatedAt: cases.updatedAt,
        })
        .from(cases)
        .where(and(...conditions))
        .orderBy(desc(cases.createdAt))
        .limit(21);

      return {
        cases: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      };
    }),

  get: portalProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(cases)
        .where(and(
          eq(cases.id, input.caseId),
          eq(cases.clientId, ctx.portalUser.clientId),
        ))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      return row;
    }),
});
