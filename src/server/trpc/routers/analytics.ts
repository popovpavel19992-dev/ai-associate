// src/server/trpc/routers/analytics.ts
import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import {
  getKpis,
  getActiveCasesByStage,
  getCaseVelocity,
  getBillingTrend,
  getDeadlineCompliance,
  getPipelineFunnel,
  type OrgScope,
} from "@/server/services/analytics/queries";

const dateRangeInput = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

function scopeFor(ctx: { user: { id: string; orgId: string | null } }): OrgScope {
  return { orgId: ctx.user.orgId, userId: ctx.user.id };
}

export const analyticsRouter = router({
  getKpis: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      return getKpis(ctx.db, scopeFor(ctx), {
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      });
    }),

  getActiveCasesByStage: protectedProcedure.query(async ({ ctx }) => {
    return getActiveCasesByStage(ctx.db, scopeFor(ctx));
  }),

  getCaseVelocity: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      return getCaseVelocity(ctx.db, scopeFor(ctx), {
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      });
    }),

  getBillingTrend: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      return getBillingTrend(ctx.db, scopeFor(ctx), {
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      });
    }),

  getDeadlineCompliance: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      return getDeadlineCompliance(ctx.db, scopeFor(ctx), {
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      });
    }),

  getPipelineFunnel: protectedProcedure.query(async ({ ctx }) => {
    return getPipelineFunnel(ctx.db, scopeFor(ctx));
  }),
});
