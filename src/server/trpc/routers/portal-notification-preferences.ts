import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { router, portalProcedure } from "../trpc";
import { portalNotificationPreferences } from "@/server/db/schema/portal-notification-preferences";

const PORTAL_NOTIFICATION_TYPES = [
  "message_received",
  "document_uploaded",
  "invoice_sent",
  "case_stage_changed",
  "task_assigned",
  "event_reminder",
  "payment_confirmed",
] as const;

export const portalNotificationPreferencesRouter = router({
  list: portalProcedure.query(async ({ ctx }) => {
    const prefs = await ctx.db
      .select()
      .from(portalNotificationPreferences)
      .where(eq(portalNotificationPreferences.portalUserId, ctx.portalUser.id));

    return PORTAL_NOTIFICATION_TYPES.map((type) => {
      const pref = prefs.find((p) => p.type === type);
      return { type, emailEnabled: pref?.emailEnabled ?? true };
    });
  }),

  update: portalProcedure
    .input(z.object({
      type: z.enum(PORTAL_NOTIFICATION_TYPES),
      emailEnabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(portalNotificationPreferences)
        .values({
          portalUserId: ctx.portalUser.id,
          type: input.type,
          emailEnabled: input.emailEnabled,
        })
        .onConflictDoUpdate({
          target: [portalNotificationPreferences.portalUserId, portalNotificationPreferences.type],
          set: { emailEnabled: input.emailEnabled, updatedAt: new Date() },
        });
      return { success: true };
    }),

  resetDefaults: portalProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .delete(portalNotificationPreferences)
      .where(eq(portalNotificationPreferences.portalUserId, ctx.portalUser.id));
    return { success: true };
  }),
});
