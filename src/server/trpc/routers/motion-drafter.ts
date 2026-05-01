import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { caseStrategyRecommendations } from "@/server/db/schema/case-strategy-recommendations";
import { isStrategyEnabled } from "@/server/lib/feature-flags";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import {
  InsufficientCreditsError,
  suggestMotion,
} from "@/server/services/motion-drafter/orchestrator";

function assertEnabled(orgId: string | null | undefined) {
  if (!isStrategyEnabled(orgId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Motion drafter not enabled for this organization.",
    });
  }
}

export const motionDrafterRouter = router({
  suggest: protectedProcedure
    .input(z.object({ recommendationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      if (!ctx.user.orgId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Org required" });
      }

      const [rec] = await ctx.db
        .select({ caseId: caseStrategyRecommendations.caseId })
        .from(caseStrategyRecommendations)
        .where(eq(caseStrategyRecommendations.id, input.recommendationId))
        .limit(1);
      if (!rec) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recommendation not found",
        });
      }
      await assertCaseAccess(ctx, rec.caseId);

      try {
        return await suggestMotion({
          recommendationId: input.recommendationId,
          userId: ctx.user.id,
          orgId: ctx.user.orgId,
        });
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: "Insufficient credits.",
          });
        }
        throw e;
      }
    }),
});
