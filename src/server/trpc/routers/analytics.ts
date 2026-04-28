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
import {
  getCasesPerAttorney,
  getHoursPerAttorney,
  getRevenuePerAttorney,
  getAvgCaseDurationPerAttorney,
  getDeadlineCompliancePerAttorney,
} from "@/server/services/analytics/per-attorney";

const dateRangeInput = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

function scopeFor(ctx: { user: { id: string; orgId: string | null } }): OrgScope {
  return { orgId: ctx.user.orgId, userId: ctx.user.id };
}

/**
 * Per-attorney breakdowns are owner/admin only. Members and solo users
 * receive [] (the page hides the section client-side anyway).
 */
function isOwnerOrAdmin(ctx: { user: { orgId: string | null; role: string | null } }) {
  return Boolean(ctx.user.orgId) && (ctx.user.role === "owner" || ctx.user.role === "admin");
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

  // -------------------------------------------------------------------------
  // 3.3b — Per-attorney breakdowns (owner/admin only)
  // -------------------------------------------------------------------------

  getCasesPerAttorney: protectedProcedure.query(async ({ ctx }) => {
    if (!isOwnerOrAdmin(ctx)) return [];
    return getCasesPerAttorney(ctx.db, scopeFor(ctx));
  }),

  getHoursPerAttorney: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      if (!isOwnerOrAdmin(ctx)) return [];
      return getHoursPerAttorney(ctx.db, scopeFor(ctx), {
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      });
    }),

  getRevenuePerAttorney: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      if (!isOwnerOrAdmin(ctx)) return [];
      return getRevenuePerAttorney(ctx.db, scopeFor(ctx), {
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      });
    }),

  getAvgCaseDurationPerAttorney: protectedProcedure.query(async ({ ctx }) => {
    if (!isOwnerOrAdmin(ctx)) return [];
    return getAvgCaseDurationPerAttorney(ctx.db, scopeFor(ctx));
  }),

  getDeadlineCompliancePerAttorney: protectedProcedure
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      if (!isOwnerOrAdmin(ctx)) return [];
      return getDeadlineCompliancePerAttorney(ctx.db, scopeFor(ctx), {
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      });
    }),
});
