// src/server/trpc/routers/billing-rates.ts
import { z } from "zod/v4";
import { and, eq, isNull, asc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { billingRates } from "@/server/db/schema/billing-rates";
import { users } from "@/server/db/schema/users";
import { assertBillingRateManage } from "../lib/permissions";

export const billingRatesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    assertBillingRateManage(ctx);

    const conditions = ctx.user.orgId
      ? [eq(billingRates.orgId, ctx.user.orgId)]
      : [eq(billingRates.userId, ctx.user.id), isNull(billingRates.orgId)];

    const rows = await ctx.db
      .select({
        id: billingRates.id,
        orgId: billingRates.orgId,
        userId: billingRates.userId,
        caseId: billingRates.caseId,
        rateCents: billingRates.rateCents,
        createdAt: billingRates.createdAt,
        updatedAt: billingRates.updatedAt,
        userName: users.name,
      })
      .from(billingRates)
      .innerJoin(users, eq(users.id, billingRates.userId))
      .where(and(...conditions))
      .orderBy(asc(users.name), asc(billingRates.caseId));

    return { rates: rows };
  }),

  getEffectiveRate: protectedProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        caseId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Case-specific rate first, then default (caseId IS NULL)
      // ORDER BY caseId NULLS LAST → case-specific comes first
      const conditions = [eq(billingRates.userId, input.userId)];
      if (input.caseId) {
        conditions.push(
          sql`(${billingRates.caseId} = ${input.caseId} OR ${billingRates.caseId} IS NULL)`,
        );
      } else {
        conditions.push(isNull(billingRates.caseId));
      }

      const rows = await ctx.db
        .select({ rateCents: billingRates.rateCents, caseId: billingRates.caseId })
        .from(billingRates)
        .where(and(...conditions))
        .orderBy(sql`${billingRates.caseId} NULLS LAST`)
        .limit(1);

      return { rateCents: rows[0]?.rateCents ?? 0 };
    }),

  upsert: protectedProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        rateCents: z.number().int().min(0),
        caseId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertBillingRateManage(ctx);

      // Check for existing rate
      const existingConditions = [eq(billingRates.userId, input.userId)];
      if (input.caseId) {
        existingConditions.push(eq(billingRates.caseId, input.caseId));
      } else {
        existingConditions.push(isNull(billingRates.caseId));
      }

      const existing = await ctx.db
        .select({ id: billingRates.id })
        .from(billingRates)
        .where(and(...existingConditions))
        .limit(1);

      if (existing[0]) {
        const [updated] = await ctx.db
          .update(billingRates)
          .set({ rateCents: input.rateCents, updatedAt: new Date() })
          .where(eq(billingRates.id, existing[0].id))
          .returning();
        return { rate: updated };
      }

      const [created] = await ctx.db
        .insert(billingRates)
        .values({
          orgId: ctx.user.orgId,
          userId: input.userId,
          caseId: input.caseId ?? null,
          rateCents: input.rateCents,
        })
        .returning();

      return { rate: created };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertBillingRateManage(ctx);

      await ctx.db.delete(billingRates).where(eq(billingRates.id, input.id));

      return { success: true };
    }),
});
