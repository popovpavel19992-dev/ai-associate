import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UsageGuard,
  UsageLimitExceededError,
} from "@/server/services/research/usage-guard";

/**
 * Drizzle-compatible mock DB.
 *
 * UsageGuard calls the Drizzle fluent API:
 *   db.insert(...).values(...).onConflictDoUpdate(...).returning()   → checkAndIncrementMemo
 *   db.update(...).set(...).where(...)                               → refundMemo (rollback path)
 *
 * We model this as a chainable builder that resolves to `returnRows`
 * at the terminal call (returning() / execute()).
 */
function makeMockDb(returnRows: Record<string, unknown>[] = [{ memoCount: 1 }]) {
  const updates: unknown[] = [];

  function makeChain(resolveWith: unknown): any {
    const chain: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return undefined; // not a Promise itself
          if (prop === "returning") {
            return () => Promise.resolve(resolveWith);
          }
          // Any other method returns another chain that resolves the same way
          return (..._args: unknown[]) => {
            updates.push({ method: String(prop), args: _args });
            return makeChain(resolveWith);
          };
        },
      },
    );
    return chain;
  }

  const db = {
    insert: (_table: unknown) => makeChain(returnRows),
    update: (_table: unknown) => ({
      set: (_values: unknown) => ({
        where: (_cond: unknown) => Promise.resolve(),
      }),
    }),
  } as any;

  return { db, updates };
}

describe("UsageGuard.checkAndIncrementMemo", () => {
  it("allows under cap and returns void", async () => {
    // memoCount = 1, cap for professional = 50 → should pass
    const { db } = makeMockDb([{ memoCount: 1 }]);
    const guard = new UsageGuard({ db });
    await expect(
      guard.checkAndIncrementMemo({ userId: "u1", plan: "professional" }),
    ).resolves.toBeUndefined();
  });

  it("throws UsageLimitExceededError at cap (memoCount > cap)", async () => {
    // memoCount = 51 > cap 50 for professional → should throw
    const { db } = makeMockDb([{ memoCount: 51 }]);
    const guard = new UsageGuard({ db });
    await expect(
      guard.checkAndIncrementMemo({ userId: "u1", plan: "professional" }),
    ).rejects.toBeInstanceOf(UsageLimitExceededError);
  });

  it("business plan = unlimited (very high memoCount still passes)", async () => {
    // business has null cap → never throws
    const { db } = makeMockDb([{ memoCount: 1_000_000 }]);
    const guard = new UsageGuard({ db });
    await expect(
      guard.checkAndIncrementMemo({ userId: "u1", plan: "business" }),
    ).resolves.toBeUndefined();
  });

  it("refundMemo resolves without error", async () => {
    const { db } = makeMockDb();
    const guard = new UsageGuard({ db });
    await expect(guard.refundMemo({ userId: "u1" })).resolves.toBeUndefined();
  });
});
