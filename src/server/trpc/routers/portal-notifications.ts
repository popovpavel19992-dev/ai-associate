import { z } from "zod/v4";
import { and, eq, desc, sql } from "drizzle-orm";
import { router, portalProcedure } from "../trpc";
import { portalNotifications } from "@/server/db/schema/portal-notifications";

export const portalNotificationsRouter = router({
  list: portalProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const conditions = [eq(portalNotifications.portalUserId, ctx.portalUser.id)];

      if (input?.cursor) {
        const [cursorRow] = await ctx.db
          .select({ createdAt: portalNotifications.createdAt })
          .from(portalNotifications)
          .where(eq(portalNotifications.id, input.cursor))
          .limit(1);
        if (cursorRow) {
          conditions.push(sql`${portalNotifications.createdAt} < ${cursorRow.createdAt}`);
        }
      }

      const rows = await ctx.db
        .select()
        .from(portalNotifications)
        .where(and(...conditions))
        .orderBy(desc(portalNotifications.createdAt))
        .limit(limit + 1);

      return {
        notifications: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : undefined,
      };
    }),

  getUnreadCount: portalProcedure.query(async ({ ctx }) => {
    const [result] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(portalNotifications)
      .where(and(
        eq(portalNotifications.portalUserId, ctx.portalUser.id),
        eq(portalNotifications.isRead, false),
      ));
    return result?.count ?? 0;
  }),

  markRead: portalProcedure
    .input(z.object({ notificationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(portalNotifications)
        .set({ isRead: true })
        .where(and(
          eq(portalNotifications.id, input.notificationId),
          eq(portalNotifications.portalUserId, ctx.portalUser.id),
        ));
      return { success: true };
    }),

  markAllRead: portalProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(portalNotifications)
      .set({ isRead: true })
      .where(and(
        eq(portalNotifications.portalUserId, ctx.portalUser.id),
        eq(portalNotifications.isRead, false),
      ));
    return { success: true };
  }),
});
