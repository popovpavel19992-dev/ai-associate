import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { and, desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { assertCaseAccess } from "../lib/permissions";
import {
  predictResponse,
  getPosture,
  attachAttorney,
  NotBetaOrgError,
  NeedsAttorneyError,
  NeedsAttorneyChoiceError,
  InsufficientCreditsError,
} from "@/server/services/opposing-counsel";
import { caseParties } from "@/server/db/schema/case-parties";
import { opposingCounselProfiles } from "@/server/db/schema/opposing-counsel-profiles";
import { opposingCounselPredictions } from "@/server/db/schema/opposing-counsel-predictions";

const targetKindEnum = z.enum(["motion", "demand_letter", "discovery_set"]);

function requireOrg(orgId: string | null | undefined): string {
  if (!orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Organization required for opposing-counsel features",
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
      message: "Insufficient credits.",
    });
  }
  if (e instanceof NeedsAttorneyError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: JSON.stringify({ kind: "needsAttorney" }),
    });
  }
  if (e instanceof NeedsAttorneyChoiceError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: JSON.stringify({
        kind: "needsAttorneyChoice",
        options: e.options,
      }),
    });
  }
  throw e;
}

function isBetaOrg(orgId: string | null | undefined): boolean {
  if (!orgId) return false;
  const allowed = (process.env.STRATEGY_BETA_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(orgId);
}

export const opposingCounselRouter = router({
  isBetaEnabled: protectedProcedure.query(({ ctx }) => {
    return { enabled: isBetaOrg(ctx.user.orgId) };
  }),

  predictResponse: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        targetKind: targetKindEnum,
        targetId: z.string().uuid(),
        targetTitle: z.string().min(1),
        targetBody: z.string().min(1),
        profileId: z.string().uuid().optional(),
        regenerate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await predictResponse({
          orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          targetKind: input.targetKind,
          targetId: input.targetId,
          targetTitle: input.targetTitle,
          targetBody: input.targetBody,
          profileId: input.profileId,
          regenerateSalt: input.regenerate ? Date.now() : undefined,
        });
      } catch (e) {
        return mapErr(e);
      }
    }),

  getPosture: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        profileId: z.string().uuid(),
        regenerate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await getPosture({
          orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          profileId: input.profileId,
          regenerateSalt: input.regenerate ? Date.now() : undefined,
        });
      } catch (e) {
        return mapErr(e);
      }
    }),

  attachAttorney: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        casePartyId: z.string().uuid(),
        firm: z.string().nullable().optional(),
        barNumber: z.string().nullable().optional(),
        barState: z.string().length(2).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await attachAttorney({
          orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          casePartyId: input.casePartyId,
          firm: input.firm,
          barNumber: input.barNumber,
          barState: input.barState,
        });
      } catch (e) {
        return mapErr(e);
      }
    }),

  listAttorneysForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      return ctx.db
        .select({
          profile: opposingCounselProfiles,
          party: caseParties,
        })
        .from(caseParties)
        .leftJoin(
          opposingCounselProfiles,
          and(
            eq(opposingCounselProfiles.casePartyId, caseParties.id),
            eq(opposingCounselProfiles.orgId, orgId),
          ),
        )
        .where(
          and(
            eq(caseParties.orgId, orgId),
            eq(caseParties.caseId, input.caseId),
            eq(caseParties.role, "opposing_counsel"),
          ),
        );
    }),

  listPredictionsForTarget: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        targetKind: targetKindEnum,
        targetId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      return ctx.db
        .select()
        .from(opposingCounselPredictions)
        .where(
          and(
            eq(opposingCounselPredictions.orgId, orgId),
            eq(opposingCounselPredictions.caseId, input.caseId),
            eq(opposingCounselPredictions.targetKind, input.targetKind),
            eq(opposingCounselPredictions.targetId, input.targetId),
          ),
        )
        .orderBy(desc(opposingCounselPredictions.createdAt))
        .limit(25);
    }),
});
