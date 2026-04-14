// src/server/trpc/routers/notifications.ts
import { z } from "zod/v4";
import { and, eq, desc, isNull, inArray, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { notifications } from "@/server/db/schema/notifications";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notification-types";

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        filter: z.enum(["all", "unread"]).default("all"),
        category: z.enum(["cases", "billing", "team", "calendar"]).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(notifications.userId, ctx.user.id),
        isNull(notifications.deletedAt),
      ];

      if (input.filter === "unread") {
        conditions.push(eq(notifications.isRead, false));
      }

      if (input.category) {
        const types = NOTIFICATION_CATEGORIES[input.category as NotificationCategory] as readonly string[];
        conditions.push(inArray(notifications.type, [...types]));
      }

      const rows = await ctx.db
        .select({
          id: notifications.id,
          type: notifications.type,
          title: notifications.title,
          body: notifications.body,
          caseId: notifications.caseId,
          actionUrl: notifications.actionUrl,
          isRead: notifications.isRead,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [result] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.user.id),
          eq(notifications.isRead, false),
          isNull(notifications.deletedAt),
        ),
      );
    return result?.count ?? 0;
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)))
        .returning({ id: notifications.id });
      return { success: !!updated };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, ctx.user.id),
          eq(notifications.isRead, false),
          isNull(notifications.deletedAt),
        ),
      );
    return { success: true };
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(notifications)
        .set({ deletedAt: new Date() })
        .where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)))
        .returning({ id: notifications.id });
      return { success: !!updated };
    }),
});
