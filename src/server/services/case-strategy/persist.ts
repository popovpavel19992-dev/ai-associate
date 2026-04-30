import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { caseStrategyRuns } from "@/server/db/schema/case-strategy-runs";
import { caseStrategyRecommendations } from "@/server/db/schema/case-strategy-recommendations";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { STRATEGY_REFRESH_COST, STRATEGY_INPUT_HASH_TTL_HOURS } from "./constants";
import type { RawRecommendation } from "./validate";
import type { GenerateResult } from "./generate";

export async function findCachedRunByHash(caseId: string, inputHash: string) {
  const cutoff = sql`now() - interval '${sql.raw(String(STRATEGY_INPUT_HASH_TTL_HOURS))} hours'`;
  const [run] = await db.select().from(caseStrategyRuns)
    .where(and(
      eq(caseStrategyRuns.caseId, caseId),
      eq(caseStrategyRuns.status, "succeeded"),
      eq(caseStrategyRuns.inputHash, inputHash),
      gt(caseStrategyRuns.startedAt, cutoff),
    ))
    .orderBy(desc(caseStrategyRuns.startedAt))
    .limit(1);
  if (!run) return null;
  const recs = await db.select().from(caseStrategyRecommendations)
    .where(eq(caseStrategyRecommendations.runId, run.id));
  return { ...run, recommendations: recs };
}

export async function persistSuccess(args: {
  runId: string;
  caseId: string;
  userId: string;
  generation: GenerateResult;
  recommendations: RawRecommendation[];
}): Promise<{ runId: string }> {
  const credited = await decrementCredits(args.userId, STRATEGY_REFRESH_COST);
  if (!credited) throw new Error("insufficient-credits-on-finalize");

  await db.transaction(async (tx) => {
    await tx.update(caseStrategyRuns).set({
      status: "succeeded",
      inputHash: args.generation.inputHash,
      promptTokens: args.generation.promptTokens,
      completionTokens: args.generation.completionTokens,
      creditsCharged: STRATEGY_REFRESH_COST,
      modelVersion: args.generation.modelVersion,
      rawResponse: args.generation.rawResponse as object,
      finishedAt: new Date(),
    }).where(eq(caseStrategyRuns.id, args.runId));

    if (args.recommendations.length > 0) {
      await tx.insert(caseStrategyRecommendations).values(
        args.recommendations.map((r) => ({
          runId: args.runId,
          caseId: args.caseId,
          category: r.category,
          priority: r.priority,
          title: r.title,
          rationale: r.rationale,
          citations: r.citations,
        })),
      );
    }
  }).catch(async (e) => {
    await refundCredits(args.userId, STRATEGY_REFRESH_COST);
    throw e;
  });

  return { runId: args.runId };
}

export async function persistCached(args: {
  runId: string;
  caseId: string;
  cachedRun: NonNullable<Awaited<ReturnType<typeof findCachedRunByHash>>>;
}): Promise<{ runId: string }> {
  await db.transaction(async (tx) => {
    await tx.update(caseStrategyRuns).set({
      status: "succeeded",
      inputHash: args.cachedRun.inputHash,
      promptTokens: 0,
      completionTokens: 0,
      creditsCharged: 0,
      modelVersion: args.cachedRun.modelVersion,
      rawResponse: args.cachedRun.rawResponse as object,
      finishedAt: new Date(),
    }).where(eq(caseStrategyRuns.id, args.runId));

    if (args.cachedRun.recommendations.length > 0) {
      await tx.insert(caseStrategyRecommendations).values(
        args.cachedRun.recommendations.map((r) => ({
          runId: args.runId,
          caseId: args.caseId,
          category: r.category,
          priority: r.priority,
          title: r.title,
          rationale: r.rationale,
          citations: r.citations as never,
        })),
      );
    }
  });
  return { runId: args.runId };
}

export async function persistFailure(args: {
  runId: string;
  error: Error | string;
}): Promise<void> {
  const msg = typeof args.error === "string" ? args.error : args.error.message;
  await db.update(caseStrategyRuns).set({
    status: "failed",
    errorMessage: msg.slice(0, 1000),
    finishedAt: new Date(),
  }).where(eq(caseStrategyRuns.id, args.runId));
}
