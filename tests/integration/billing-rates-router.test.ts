// tests/integration/billing-rates-router.test.ts
//
// Unit tests for the billingRates tRPC router. Uses a chainable mock ctx.db
// (no real DB access), matching the tests/integration/clients-router.test.ts pattern.

import { describe, it, expect } from "vitest";
import type { db as realDb } from "@/server/db";
import { billingRatesRouter } from "@/server/trpc/routers/billing-rates";
import type { billingRates } from "@/server/db/schema/billing-rates";

type BillingRateRow = typeof billingRates.$inferSelect;
type MockUser = { id: string; orgId: string | null; role: string | null };
type Ctx = { db: typeof realDb; user: MockUser };

// ---------------------------------------------------------------------------
// Stable UUIDs (all must be valid v4 UUIDs with variant byte in [89abAB])
// ---------------------------------------------------------------------------
const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  org: "33333333-3333-4333-a333-333333333333",
  rate: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  case1: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
  member: "44444444-4444-4444-a444-444444444444",
  owner: "55555555-5555-4555-a555-555555555555",
  solo: "77777777-7777-4777-a777-777777777777",
};

// ---------------------------------------------------------------------------
// makeMockDb
// ---------------------------------------------------------------------------
type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];
  const deleteCalls: unknown[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeSelectChain = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
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
  const makeInsertChain = (call: { values?: unknown }): any => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    returning: async () => [{ id: ID.rate, ...(call.values as object) }],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeUpdateChain = (call: { set?: unknown }): any => ({
    set: (s: unknown) => {
      call.set = s;
      return makeUpdateChain(call);
    },
    where: () => makeUpdateChain(call),
    returning: async () => [{ id: ID.rate, ...(call.set as object) }],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeDeleteChain = (): any => ({
    where: () => makeDeleteChain(),
    then: (resolve: () => void) => {
      deleteCalls.push({});
      resolve();
    },
  });

  const db = {
    select: () => makeSelectChain(),
    insert: () => {
      const call: { values?: unknown } = {};
      insertCalls.push(call);
      return makeInsertChain(call);
    },
    update: () => {
      const call: { set?: unknown } = {};
      updateCalls.push(call);
      return makeUpdateChain(call);
    },
    delete: () => makeDeleteChain(),
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
    insertCalls,
    updateCalls,
    deleteCalls,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const caller = (ctx: Ctx) => billingRatesRouter.createCaller(ctx as unknown as any);

// ---------------------------------------------------------------------------
// Row helper
// ---------------------------------------------------------------------------
const makeRate = (overrides: Partial<BillingRateRow> = {}): BillingRateRow =>
  ({
    id: ID.rate,
    orgId: ID.org,
    userId: ID.user,
    caseId: null,
    rateCents: 30000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as BillingRateRow;

// ---------------------------------------------------------------------------
// billingRates.list
// ---------------------------------------------------------------------------
describe("billingRates.list", () => {
  it("org owner can list rates with user names", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([
      { ...makeRate(), userName: "Alice" },
      { ...makeRate({ userId: ID.member, rateCents: 25000 }), userName: "Bob" },
    ]);

    const result = await caller(ctx).list();
    expect(result.rates).toHaveLength(2);
    expect((result.rates[0] as Record<string, unknown>).userName).toBe("Alice");
  });

  it("org member is FORBIDDEN from listing rates", async () => {
    const { db } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.member, orgId: ID.org, role: "member" } };

    await expect(caller(ctx).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("solo user can list their own rates", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.solo, orgId: null, role: null } };

    enqueueSelect([{ ...makeRate({ orgId: null, userId: ID.solo }), userName: "Solo" }]);

    const result = await caller(ctx).list();
    expect(result.rates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// billingRates.getEffectiveRate
// ---------------------------------------------------------------------------
describe("billingRates.getEffectiveRate", () => {
  it("returns rateCents from found rate", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([{ rateCents: 35000, caseId: ID.case1 }]);

    const result = await caller(ctx).getEffectiveRate({ userId: ID.user, caseId: ID.case1 });
    expect(result.rateCents).toBe(35000);
  });

  it("returns 0 when no rate is configured", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([]);

    const result = await caller(ctx).getEffectiveRate({ userId: ID.user });
    expect(result.rateCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// billingRates.upsert — insert path
// ---------------------------------------------------------------------------
describe("billingRates.upsert", () => {
  it("inserts new rate when none exists", async () => {
    const { db, insertCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([]); // no existing rate

    await caller(ctx).upsert({ userId: ID.user, rateCents: 30000 });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.rateCents).toBe(30000);
    expect(vals.userId).toBe(ID.user);
    expect(vals.orgId).toBe(ID.org);
  });

  it("updates existing rate when one exists", async () => {
    const { db, updateCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([{ id: ID.rate }]); // existing rate found

    await caller(ctx).upsert({ userId: ID.user, rateCents: 40000 });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.rateCents).toBe(40000);
  });

  it("org member is FORBIDDEN from upserting rates", async () => {
    const { db } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.member, orgId: ID.org, role: "member" } };

    await expect(
      caller(ctx).upsert({ userId: ID.user, rateCents: 20000 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// billingRates.delete
// ---------------------------------------------------------------------------
describe("billingRates.delete", () => {
  it("deletes rate when owner calls it", async () => {
    const { db, deleteCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    const result = await caller(ctx).delete({ id: ID.rate });
    expect(result.success).toBe(true);
    expect(deleteCalls).toHaveLength(1);
  });

  it("org member is FORBIDDEN from deleting rates", async () => {
    const { db } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.member, orgId: ID.org, role: "member" } };

    await expect(caller(ctx).delete({ id: ID.rate })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
