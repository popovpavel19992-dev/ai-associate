// src/server/trpc/routers/push-subscriptions.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { pushSubscriptions } from "@/server/db/schema/push-subscriptions";
import {
  getVapidPublicKey,
  sendNotificationToUser,
} from "@/server/services/push";

export const pushSubscriptionsRouter = router({
  /** Returns the VAPID public key for the browser's pushManager.subscribe call. */
  getVapidPublicKey: protectedProcedure.query(() => {
    return { publicKey: getVapidPublicKey() };
  }),

  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
        userAgent: z.string().max(512).optional(),
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
          userAgent: input.userAgent ?? null,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
          set: {
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent ?? null,
            isActive: true,
          },
        });
      return { success: true };
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, input.endpoint),
            eq(pushSubscriptions.userId, ctx.user.id),
          ),
        );
      return { success: true };
    }),

  /** Lists devices currently subscribed for the signed-in user. */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        userAgent: pushSubscriptions.userAgent,
        isActive: pushSubscriptions.isActive,
        createdAt: pushSubscriptions.createdAt,
        lastUsedAt: pushSubscriptions.lastUsedAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.user.id))
      .orderBy(desc(pushSubscriptions.createdAt));
    return rows;
  }),

  /** Sends a test notification to all active devices for the signed-in user. */
  sendTest: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await sendNotificationToUser(ctx.db, ctx.user.id, {
      title: "ClearTerms",
      body: "Test notification — your push subscription is working.",
      url: "/dashboard",
      tag: "clearterms-test",
    });
    if (result.sent === 0 && result.failed === 0 && result.deactivated === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "No active devices subscribed. Enable push notifications first.",
      });
    }
    return result;
  }),
});
