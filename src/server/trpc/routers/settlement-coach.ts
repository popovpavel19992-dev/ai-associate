import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { assertCaseAccess } from "../lib/permissions";
import { db } from "@/server/db";
import {
  computeBatnaFlow,
  recommendCounterFlow,
  NotBetaOrgError,
  InsufficientCreditsError,
  NeedsBatnaError,
  OfferNotFoundError,
} from "@/server/services/settlement-coach";
import { settlementCoachBatnas } from "@/server/db/schema/settlement-coach-batnas";
import { settlementCoachCounters } from "@/server/db/schema/settlement-coach-counters";

function requireOrg(orgId: string | null | undefined): string {
  if (!orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Organization required",
    });
  }
  return orgId;
}

function mapErr(e: unknown): never {
  if (e instanceof NotBetaOrgError) {
    throw new TRPCError({ code: "FORBIDDEN", message: e.message });
  }
  if (e instanceof InsufficientCreditsError) {
    throw new TRPCError({
      code: "PAYMENT_REQUIRED",
      message: e.message,
    });
  }
  if (e instanceof NeedsBatnaError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: JSON.stringify({ kind: "needsBatna" }),
    });
  }
  if (e instanceof OfferNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  }
  throw e;
}

const ComponentInput = z.object({
  label: z.string().min(1),
  lowCents: z.number().int().nonnegative(),
  likelyCents: z.number().int().nonnegative(),
  highCents: z.number().int().nonnegative(),
  source: z.string(),
});

const OverridesInput = z.object({
  damagesLowCents: z.number().int().nonnegative().optional(),
  damagesLikelyCents: z.number().int().nonnegative().optional(),
  damagesHighCents: z.number().int().nonnegative().optional(),
  damagesComponents: z.array(ComponentInput).optional(),
  winProbLow: z.number().min(0).max(1).optional(),
  winProbLikely: z.number().min(0).max(1).optional(),
  winProbHigh: z.number().min(0).max(1).optional(),
  costsRemainingCents: z.number().int().nonnegative().optional(),
  timeToTrialMonths: z.number().int().nonnegative().optional(),
  discountRateAnnual: z.number().min(0).max(1).optional(),
});

export const settlementCoachRouter = router({
  computeBatna: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        caseSummary: z.string().min(1),
        overrides: OverridesInput.optional(),
        regenerate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await computeBatnaFlow({
          orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          caseSummary: input.caseSummary,
          overrides: input.overrides,
          regenerateSalt: input.regenerate ? Date.now() : undefined,
        });
      } catch (e) {
        return mapErr(e);
      }
    }),

  recommendCounter: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        offerId: z.string().uuid(),
        regenerate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await recommendCounterFlow({
          orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          offerId: input.offerId,
          regenerateSalt: input.regenerate ? Date.now() : undefined,
        });
      } catch (e) {
        return mapErr(e);
      }
    }),

  getBatna: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      const [row] = await db
        .select()
        .from(settlementCoachBatnas)
        .where(
          and(
            eq(settlementCoachBatnas.orgId, orgId),
            eq(settlementCoachBatnas.caseId, input.caseId),
          ),
        )
        .orderBy(desc(settlementCoachBatnas.createdAt))
        .limit(1);
      return row ?? null;
    }),

  listCounters: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        offerId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      const where = input.offerId
        ? and(
            eq(settlementCoachCounters.orgId, orgId),
            eq(settlementCoachCounters.caseId, input.caseId),
            eq(settlementCoachCounters.offerId, input.offerId),
          )
        : and(
            eq(settlementCoachCounters.orgId, orgId),
            eq(settlementCoachCounters.caseId, input.caseId),
          );
      return await db
        .select()
        .from(settlementCoachCounters)
        .where(where)
        .orderBy(desc(settlementCoachCounters.createdAt))
        .limit(25);
    }),
});
