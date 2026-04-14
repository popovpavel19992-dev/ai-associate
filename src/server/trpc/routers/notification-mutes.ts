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
