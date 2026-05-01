import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { caseStrategyRuns } from "@/server/db/schema/case-strategy-runs";
import { caseStrategyRecommendations } from "@/server/db/schema/case-strategy-recommendations";
import { isStrategyEnabled } from "@/server/lib/feature-flags";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { checkCredits } from "@/server/services/credits";
import { inngest } from "@/server/inngest/client";
import {
  STRATEGY_REFRESH_COST,
  STRATEGY_RATE_LIMIT_MINUTES,
} from "@/server/services/case-strategy/constants";

function assertEnabled(orgId: string | null | undefined) {
  if (!isStrategyEnabled(orgId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Strategy assistant not enabled for this organization.",
    });
  }
}

export const caseStrategyRouter = router({
  getLatest: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);

      const [run] = await ctx.db
        .select()
        .from(caseStrategyRuns)
        .where(eq(caseStrategyRuns.caseId, input.caseId))
        .orderBy(desc(caseStrategyRuns.startedAt))
        .limit(1);
      if (!run) return { run: null, recommendations: [] };

      const recs = await ctx.db
        .select()
        .from(caseStrategyRecommendations)
        .where(
          and(
            eq(caseStrategyRecommendations.runId, run.id),
            isNull(caseStrategyRecommendations.dismissedAt),
          ),
        );
      return { run, recommendations: recs };
    }),

  refresh: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);

      const cutoff = sql`now() - interval '${sql.raw(String(STRATEGY_RATE_LIMIT_MINUTES))} minutes'`;
      const [recent] = await ctx.db
        .select()
        .from(caseStrategyRuns)
        .where(
          and(
            eq(caseStrategyRuns.caseId, input.caseId),
            eq(caseStrategyRuns.status, "succeeded"),
            gt(caseStrategyRuns.startedAt, cutoff),
          ),
        )
        .orderBy(desc(caseStrategyRuns.startedAt))
        .limit(1);
      if (recent) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Last refresh under ${STRATEGY_RATE_LIMIT_MINUTES} minutes ago.`,
        });
      }

      const balance = await checkCredits(ctx.user.id);
      if (balance.available < STRATEGY_REFRESH_COST) {
        throw new TRPCError({
          code: "PAYMENT_REQUIRED",
          message: "Insufficient credits.",
        });
      }

      const orgId = ctx.user.orgId;
      if (!orgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "User has no organization.",
        });
      }

      const [created] = await ctx.db
        .insert(caseStrategyRuns)
        .values({
          caseId: input.caseId,
          orgId,
          triggeredBy: ctx.user.id,
          status: "pending",
          modelVersion: process.env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
        })
        .returning({ id: caseStrategyRuns.id });

      await inngest.send({
        name: "strategy/refresh.requested",
        data: { runId: created.id, caseId: input.caseId },
      });

      return { runId: created.id };
    }),

  dismiss: protectedProcedure
    .input(z.object({ recommendationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);

      const [rec] = await ctx.db
        .select({ caseId: caseStrategyRecommendations.caseId })
        .from(caseStrategyRecommendations)
        .where(eq(caseStrategyRecommendations.id, input.recommendationId))
        .limit(1);
      if (!rec) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
      }
      await assertCaseAccess(ctx, rec.caseId);

      await ctx.db
        .update(caseStrategyRecommendations)
        .set({ dismissedAt: new Date(), dismissedBy: ctx.user.id })
        .where(eq(caseStrategyRecommendations.id, input.recommendationId));
      return { success: true };
    }),
});
