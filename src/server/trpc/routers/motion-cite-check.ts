import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { caseMotions } from "@/server/db/schema/case-motions";
import { isStrategyEnabled } from "@/server/lib/feature-flags";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import {
  InsufficientCreditsError,
  runCiteCheck,
} from "@/server/services/cite-check/orchestrator";
import type { CiteCheckResult } from "@/server/services/cite-check/types";

function assertEnabled(orgId: string | null | undefined) {
  if (!isStrategyEnabled(orgId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cite-check not enabled for this organization.",
    });
  }
}

async function loadMotionCaseId(
  ctx: { db: typeof import("@/server/db").db },
  motionId: string,
) {
  const [m] = await ctx.db
    .select({ id: caseMotions.id, caseId: caseMotions.caseId })
    .from(caseMotions)
    .where(eq(caseMotions.id, motionId))
    .limit(1);
  if (!m) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
  }
  return m.caseId;
}

export const motionCiteCheckRouter = router({
  run: protectedProcedure
    .input(z.object({ motionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const caseId = await loadMotionCaseId(ctx, input.motionId);
      await assertCaseAccess(ctx, caseId);

      try {
        return await runCiteCheck({
          motionId: input.motionId,
          userId: ctx.user.id,
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

  get: protectedProcedure
    .input(z.object({ motionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const caseId = await loadMotionCaseId(ctx, input.motionId);
      await assertCaseAccess(ctx, caseId);

      const [m] = await ctx.db
        .select({
          json: caseMotions.lastCiteCheckJson,
          updatedAt: caseMotions.updatedAt,
        })
        .from(caseMotions)
        .where(eq(caseMotions.id, input.motionId))
        .limit(1);

      return {
        result: (m?.json ?? null) as CiteCheckResult | null,
        motionUpdatedAt: m?.updatedAt ?? null,
      };
    }),
});
