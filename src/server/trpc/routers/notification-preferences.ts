// src/server/trpc/routers/notification-preferences.ts
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { notificationPreferences } from "@/server/db/schema/notification-preferences";
import { NOTIFICATION_TYPES, NOTIFICATION_CHANNELS } from "@/lib/notification-types";

export const notificationPreferencesRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, ctx.user.id));

    const matrix: Record<string, Record<string, boolean>> = {};
    for (const type of NOTIFICATION_TYPES) {
      matrix[type] = {};
      for (const channel of NOTIFICATION_CHANNELS) {
        matrix[type][channel] = true;
      }
    }

    for (const row of rows) {
      if (matrix[row.notificationType]?.[row.channel] !== undefined) {
        matrix[row.notificationType][row.channel] = row.enabled;
      }
    }

    return matrix;
  }),

  update: protectedProcedure
    .input(
      z.object({
        type: z.enum(NOTIFICATION_TYPES),
        channel: z.enum(NOTIFICATION_CHANNELS),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(notificationPreferences)
        .values({
          userId: ctx.user.id,
          notificationType: input.type,
          channel: input.channel,
          enabled: input.enabled,
        })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.userId,
            notificationPreferences.notificationType,
            notificationPreferences.channel,
          ],
          set: { enabled: input.enabled },
        });
      return { success: true };
    }),

  resetDefaults: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.userId, ctx.user.id));
    return { success: true };
  }),
});
