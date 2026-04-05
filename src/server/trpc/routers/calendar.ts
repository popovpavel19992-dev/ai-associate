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
