import { collectContext } from "./collect";
import { generateRecommendations, computeInputHash } from "./generate";
import { validateRecommendations } from "./validate";
import { findCachedRunByHash, persistCached, persistFailure, persistSuccess } from "./persist";

export interface StrategyRefreshArgs {
  runId: string;
  caseId: string;
}

export interface StrategyRefreshResult {
  status: "succeeded" | "failed";
  cached?: boolean;
  error?: string;
}

export async function runStrategyRefresh(
  args: StrategyRefreshArgs,
): Promise<StrategyRefreshResult> {
  try {
    const ctx = await collectContext(args.caseId);
    const inputHash = computeInputHash(ctx);
    const cached = await findCachedRunByHash(args.caseId, inputHash);
    if (cached) {
      await persistCached({ runId: args.runId, caseId: args.caseId, cachedRun: cached });
      return { status: "succeeded", cached: true };
    }

    const generation = await generateRecommendations(ctx);
    const recs = validateRecommendations(generation.recommendations, ctx);

    // We need triggeredBy (userId) for credits — read from the pending run row.
    const { db } = await import("@/server/db");
    const { caseStrategyRuns } = await import("@/server/db/schema/case-strategy-runs");
    const { eq } = await import("drizzle-orm");
    const [run] = await db.select().from(caseStrategyRuns).where(eq(caseStrategyRuns.id, args.runId));
    if (!run) throw new Error(`Run ${args.runId} disappeared`);

    await persistSuccess({
      runId: args.runId,
      caseId: args.caseId,
      userId: run.triggeredBy,
      generation,
      recommendations: recs,
    });
    return { status: "succeeded" };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    await persistFailure({ runId: args.runId, error: err });
    return { status: "failed", error: err.message };
  }
}
