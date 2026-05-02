import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { assertCaseAccess } from "../lib/permissions";
import {
  generateBranchesFlow,
  getBranchesForTopic,
  listBranchesForOutline,
  NotBetaOrgError,
  InsufficientCreditsError,
  NoQuestionsError,
  TopicNotFoundError,
  OutlineNotFoundError,
} from "@/server/services/deposition-branches";

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
  if (e instanceof NoQuestionsError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: JSON.stringify({ kind: "noQuestions" }),
    });
  }
  if (e instanceof TopicNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  }
  if (e instanceof OutlineNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  }
  throw e;
}

export const depositionBranchesRouter = router({
  generateBranchesForTopic: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        outlineId: z.string().uuid(),
        topicId: z.string().uuid(),
        regenerate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await generateBranchesFlow({
          orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          outlineId: input.outlineId,
          topicId: input.topicId,
          regenerateSalt: input.regenerate ? Date.now() : undefined,
        });
      } catch (e) {
        return mapErr(e);
      }
    }),

  getBranches: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        topicId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await getBranchesForTopic({
          orgId,
          caseId: input.caseId,
          topicId: input.topicId,
        });
      } catch (e) {
        return mapErr(e);
      }
    }),

  listBranchesForOutline: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        outlineId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await listBranchesForOutline({
          orgId,
          outlineId: input.outlineId,
        });
      } catch (e) {
        return mapErr(e);
      }
    }),
});
