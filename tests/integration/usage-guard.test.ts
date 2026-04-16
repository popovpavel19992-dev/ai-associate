// tests/integration/usage-guard.test.ts
//
// Unit tests for UsageGuard. Mock-DB (chainable) pattern — atomic SQL
// increments are stubbed; real concurrent-safety is verified in Chunk 7 E2E.

import { describe, it, expect } from "vitest";
import type { db as realDb } from "@/server/db";
import {
  TIER_LIMITS,
  UsageGuard,
  UsageLimitExceededError,
} from "@/server/services/research/usage-guard";

const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  usage: "99999999-9999-4999-a999-999999999999",
};

type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const returningQueue: unknown[][] = [];
  const insertCalls: {
    values?: unknown;
    onConflictTarget?: unknown;
  }[] = [];
  const updateCalls: { set?: unknown }[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeSelectChain = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (v: SelectResponse) => void, reject: (e: Error) => void) => {
        const v = selectQueue.shift();
        if (v === undefined) {
          reject(new Error("mock db: select queue exhausted"));
          return;
        }
        resolve(v);
      },
    };
    return chain;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeInsertChain = (call: { values?: unknown; onConflictTarget?: unknown }): any => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    onConflictDoUpdate: (cfg: unknown) => {
      call.onConflictTarget = cfg;
      return makeInsertChain(call);
    },
    returning: async () => {
      const v = returningQueue.shift();
      return v ?? [{ id: ID.usage, ...((call.values ?? {}) as object) }];
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeUpdateChain = (call: { set?: unknown }): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      set: (s: unknown) => {
        call.set = s;
        return chain;
      },
      where: () => chain,
      returning: async () => [{ id: ID.usage, ...((call.set ?? {}) as object) }],
      then: (resolve: () => void) => resolve(),
    };
    return chain;
  };

  const db = {
    select: () => makeSelectChain(),
    insert: () => {
      const call: { values?: unknown; onConflictTarget?: unknown } = {};
      insertCalls.push(call);
      return makeInsertChain(call);
    },
    update: () => {
      const call: { set?: unknown } = {};
      updateCalls.push(call);
      return makeUpdateChain(call);
    },
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
    enqueueReturning: (rows: unknown[]) => returningQueue.push(rows),
    insertCalls,
    updateCalls,
  };
}

describe("UsageGuard.TIER_LIMITS", () => {
  it("exports correct tier limits", () => {
    expect(TIER_LIMITS.starter).toBe(50);
    expect(TIER_LIMITS.professional).toBe(500);
    expect(TIER_LIMITS.business).toBe(5000);
  });
});

describe("UsageGuard.checkAndIncrementQa", () => {
  it("under limit — returns { used, limit }", async () => {
    const { db, enqueueReturning, updateCalls } = makeMockDb();
    const guard = new UsageGuard({ db });

    enqueueReturning([{ qaCount: 5 }]);

    const result = await guard.checkAndIncrementQa({
      userId: ID.user,
      plan: "starter",
    });

    expect(result).toEqual({ used: 5, limit: 50 });
    expect(updateCalls).toHaveLength(0);
  });

  it("at limit boundary (qaCount === limit) — does NOT throw, no refund", async () => {
    const { db, enqueueReturning, updateCalls } = makeMockDb();
    const guard = new UsageGuard({ db });

    enqueueReturning([{ qaCount: 50 }]);

    const result = await guard.checkAndIncrementQa({
      userId: ID.user,
      plan: "starter",
    });

    expect(result).toEqual({ used: 50, limit: 50 });
    expect(updateCalls).toHaveLength(0);
  });

  it("exceeding limit — throws UsageLimitExceededError and issues refund update", async () => {
    const { db, enqueueReturning, updateCalls } = makeMockDb();
    const guard = new UsageGuard({ db });

    enqueueReturning([{ qaCount: 51 }]);

    let caught: unknown;
    try {
      await guard.checkAndIncrementQa({
        userId: ID.user,
        plan: "starter",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UsageLimitExceededError);
    const e = caught as UsageLimitExceededError;
    expect(e.used).toBe(50);
    expect(e.limit).toBe(50);
    expect(e.name).toBe("UsageLimitExceededError");

    expect(updateCalls).toHaveLength(1);
    const set = updateCalls[0]!.set as Record<string, unknown>;
    expect(set).toHaveProperty("qaCount");
  });

  it("unknown plan — limit 0, any qaCount>0 throws", async () => {
    const { db, enqueueReturning } = makeMockDb();
    const guard = new UsageGuard({ db });

    enqueueReturning([{ qaCount: 1 }]);

    let caught: unknown;
    try {
      await guard.checkAndIncrementQa({
        userId: ID.user,
        plan: "enterprise-xl",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UsageLimitExceededError);
    const e = caught as UsageLimitExceededError;
    expect(e.used).toBe(0);
    expect(e.limit).toBe(0);
  });

  it("uses current month from injected clock", async () => {
    const { db, enqueueReturning, insertCalls } = makeMockDb();
    const guard = new UsageGuard({
      db,
      now: () => new Date("2027-03-15T12:00:00Z"),
    });

    enqueueReturning([{ qaCount: 1 }]);

    await guard.checkAndIncrementQa({
      userId: ID.user,
      plan: "starter",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.month).toBe("2027-03");
  });

  it("inserts with qaCount=1 on first occurrence", async () => {
    const { db, enqueueReturning, insertCalls } = makeMockDb();
    const guard = new UsageGuard({ db });

    enqueueReturning([{ qaCount: 1 }]);

    await guard.checkAndIncrementQa({
      userId: ID.user,
      plan: "starter",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.qaCount).toBe(1);
    expect(vals.userId).toBe(ID.user);
  });

  it("onConflictDoUpdate configures target and set with qaCount+updatedAt", async () => {
    const { db, enqueueReturning, insertCalls } = makeMockDb();
    const guard = new UsageGuard({ db });

    enqueueReturning([{ qaCount: 2 }]);

    await guard.checkAndIncrementQa({
      userId: ID.user,
      plan: "starter",
    });

    expect(insertCalls).toHaveLength(1);
    const cfg = insertCalls[0]!.onConflictTarget as {
      target?: unknown[];
      set?: Record<string, unknown>;
    };
    expect(cfg).toBeDefined();
    expect(Array.isArray(cfg.target)).toBe(true);
    expect(cfg.target).toHaveLength(2);
    expect(cfg.set).toBeDefined();
    expect(cfg.set).toHaveProperty("qaCount");
    expect(cfg.set).toHaveProperty("updatedAt");
  });
});

describe("UsageGuard.refundQa", () => {
  it("issues update against current month with a sql-tagged qaCount", async () => {
    const { db, updateCalls } = makeMockDb();
    const guard = new UsageGuard({
      db,
      now: () => new Date("2027-03-15T12:00:00Z"),
    });

    await guard.refundQa({ userId: ID.user });

    expect(updateCalls).toHaveLength(1);
    const set = updateCalls[0]!.set as Record<string, unknown>;
    expect(set).toHaveProperty("qaCount");
    expect(set).toHaveProperty("updatedAt");
  });

  it("does not throw when no row exists (mock update is a no-op)", async () => {
    const { db } = makeMockDb();
    const guard = new UsageGuard({ db });

    await expect(guard.refundQa({ userId: ID.user })).resolves.toBeUndefined();
  });
});

describe("UsageGuard.getCurrentUsage", () => {
  it("returns { used: 0, limit } when no row exists", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const guard = new UsageGuard({ db });

    enqueueSelect([]);

    const result = await guard.getCurrentUsage({
      userId: ID.user,
      plan: "professional",
    });

    expect(result).toEqual({ used: 0, limit: 500 });
  });

  it("returns db qaCount when row exists", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const guard = new UsageGuard({ db });

    enqueueSelect([{ qaCount: 123 }]);

    const result = await guard.getCurrentUsage({
      userId: ID.user,
      plan: "professional",
    });

    expect(result).toEqual({ used: 123, limit: 500 });
  });

  it("returns limit 0 for unknown plan", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const guard = new UsageGuard({ db });

    enqueueSelect([{ qaCount: 10 }]);

    const result = await guard.getCurrentUsage({
      userId: ID.user,
      plan: "enterprise-xl",
    });

    expect(result).toEqual({ used: 10, limit: 0 });
  });
});
