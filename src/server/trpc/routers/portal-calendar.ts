import { z } from "zod/v4";
import { and, eq, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { caseCalendarEvents } from "@/server/db/schema/case-calendar-events";
import { cases } from "@/server/db/schema/cases";

export const portalCalendarRouter = router({
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
      if (!vis || vis.calendar === false) throw new TRPCError({ code: "FORBIDDEN" });

      const rows = await ctx.db
        .select({
          id: caseCalendarEvents.id,
          title: caseCalendarEvents.title,
          description: caseCalendarEvents.description,
          kind: caseCalendarEvents.kind,
          startsAt: caseCalendarEvents.startsAt,
          endsAt: caseCalendarEvents.endsAt,
          location: caseCalendarEvents.location,
        })
        .from(caseCalendarEvents)
        .where(and(
          eq(caseCalendarEvents.caseId, input.caseId),
          gte(caseCalendarEvents.endsAt, new Date()),
        ))
        .orderBy(caseCalendarEvents.startsAt)
        .limit(21);

      return {
        events: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      };
    }),
});
