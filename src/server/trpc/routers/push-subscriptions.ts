// src/server/trpc/routers/push-subscriptions.ts
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { pushSubscriptions } from "@/server/db/schema/push-subscriptions";

export const pushSubscriptionsRouter = router({
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(pushSubscriptions)
        .values({
          userId: ctx.user.id,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
        })
        .onConflictDoUpdate({
          target: [pushSubscriptions.endpoint],
          set: {
            userId: ctx.user.id,
            p256dh: input.p256dh,
            auth: input.auth,
          },
        });
      return { success: true };
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.userId, ctx.user.id)));
      return { success: true };
    }),
});
