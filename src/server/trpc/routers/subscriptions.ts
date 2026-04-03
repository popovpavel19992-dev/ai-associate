import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { subscriptions } from "../../db/schema/subscriptions";
import { stripe, STRIPE_PRICE_IDS } from "@/lib/stripe";
import { PLAN_LIMITS } from "@/lib/constants";
import type { Plan } from "@/lib/types";

export const subscriptionsRouter = router({
  getUsage: protectedProcedure.query(async ({ ctx }) => {
    const plan = (ctx.user.plan ?? "trial") as Plan;
    const limits = PLAN_LIMITS[plan];
    const creditsUsed = ctx.user.creditsUsedThisMonth;

    const [sub] = await ctx.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, ctx.user.id))
      .limit(1);

    return {
      plan,
      creditsUsed,
      creditsLimit: limits.credits === Infinity ? null : limits.credits,
      subscriptionStatus: ctx.user.subscriptionStatus ?? "trialing",
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    };
  }),

  createCheckout: protectedProcedure
    .input(
      z.object({
        plan: z.enum(["solo", "small_firm", "firm_plus"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const priceId = STRIPE_PRICE_IDS[input.plan];

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: ctx.user.email,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { userId: ctx.user.id },
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?success=true`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?cancelled=true`,
      });

      return { url: session.url };
    }),

  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    const customerId = ctx.user.stripeCustomerId;

    if (!customerId) {
      return { url: null };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
    });

    return { url: session.url };
  }),
});
