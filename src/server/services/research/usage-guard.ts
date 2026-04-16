import { and, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { researchUsage } from "@/server/db/schema/research-usage";

export type ResearchPlan = "starter" | "professional" | "business";

export const TIER_LIMITS: Readonly<Record<ResearchPlan, number>> = Object.freeze({
  starter: 50,
  professional: 500,
  business: 5000,
});

export class UsageLimitExceededError extends Error {
  public readonly name = "UsageLimitExceededError" as const;
  constructor(
    public readonly used: number,
    public readonly limit: number,
  ) {
    super(`Q&A usage limit exceeded: ${used}/${limit}`);
  }
}

export interface UsageGuardDeps {
  db?: typeof defaultDb;
  now?: () => Date;
}

function planLimit(plan: ResearchPlan | string): number {
  return (TIER_LIMITS as Record<string, number>)[plan] ?? 0;
}

export class UsageGuard {
  private readonly db: typeof defaultDb;
  private readonly now: () => Date;

  constructor(deps?: UsageGuardDeps) {
    this.db = deps?.db ?? defaultDb;
    this.now = deps?.now ?? (() => new Date());
  }

  private currentMonth(): string {
    return this.now().toISOString().slice(0, 7);
  }

  async checkAndIncrementQa(opts: {
    userId: string;
    plan: ResearchPlan | string;
  }): Promise<{ used: number; limit: number }> {
    const month = this.currentMonth();
    const limit = planLimit(opts.plan);

    const [usage] = await this.db
      .insert(researchUsage)
      .values({ userId: opts.userId, month, qaCount: 1 })
      .onConflictDoUpdate({
        target: [researchUsage.userId, researchUsage.month],
        set: {
          qaCount: sql`${researchUsage.qaCount} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();

    const row = usage as { qaCount: number } | undefined;
    const used = row?.qaCount ?? 0;

    if (used > limit) {
      await this.db
        .update(researchUsage)
        .set({ qaCount: sql`${researchUsage.qaCount} - 1` })
        .where(
          and(
            eq(researchUsage.userId, opts.userId),
            eq(researchUsage.month, month),
          ),
        );
      throw new UsageLimitExceededError(used - 1, limit);
    }

    return { used, limit };
  }

  async refundQa(opts: { userId: string }): Promise<void> {
    const month = this.currentMonth();
    await this.db
      .update(researchUsage)
      .set({
        qaCount: sql`greatest(${researchUsage.qaCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(researchUsage.userId, opts.userId),
          eq(researchUsage.month, month),
        ),
      );
  }

  async getCurrentUsage(opts: {
    userId: string;
    plan: ResearchPlan | string;
  }): Promise<{ used: number; limit: number }> {
    const month = this.currentMonth();
    const rows = await this.db
      .select()
      .from(researchUsage)
      .where(
        and(
          eq(researchUsage.userId, opts.userId),
          eq(researchUsage.month, month),
        ),
      )
      .limit(1);

    const row = rows[0] as { qaCount: number } | undefined;
    return { used: row?.qaCount ?? 0, limit: planLimit(opts.plan) };
  }
}
