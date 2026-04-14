// tests/integration/expenses-router.test.ts
//
// Unit tests for the expenses tRPC router. Uses a chainable mock ctx.db
// (no real DB access), matching the tests/integration/clients-router.test.ts pattern.

import { describe, it, expect } from "vitest";
import type { db as realDb } from "@/server/db";
import { expensesRouter } from "@/server/trpc/routers/expenses";
import type { expenses } from "@/server/db/schema/expenses";

type ExpenseRow = typeof expenses.$inferSelect;
type MockUser = { id: string; orgId: string | null; role: string | null };
type Ctx = { db: typeof realDb; user: MockUser };

// ---------------------------------------------------------------------------
// Stable UUIDs
// ---------------------------------------------------------------------------
const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  org: "33333333-3333-4333-a333-333333333333",
  expense: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  case1: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
  client: "cccccccc-cccc-4ccc-accc-cccccccccccc",
  member: "44444444-4444-4444-a444-444444444444",
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
      leftJoin: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
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
    returning: async () => [{ id: ID.expense, ...(call.values as object) }],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeUpdateChain = (call: { set?: unknown }): any => ({
    set: (s: unknown) => {
      call.set = s;
      return makeUpdateChain(call);
    },
    where: () => makeUpdateChain(call),
    returning: async () => [{ id: ID.expense, ...(call.set as object) }],
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
const caller = (ctx: Ctx) => expensesRouter.createCaller(ctx as unknown as any);

// ---------------------------------------------------------------------------
// Row helper
// ---------------------------------------------------------------------------
const makeExpense = (overrides: Partial<ExpenseRow> = {}): ExpenseRow =>
  ({
    id: ID.expense,
    orgId: ID.org,
    userId: ID.user,
    caseId: ID.case1,
    category: "other",
    description: "Filing fee",
    amountCents: 5000,
    expenseDate: new Date("2026-04-01"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as ExpenseRow;

// ---------------------------------------------------------------------------
// expenses.list
// ---------------------------------------------------------------------------
describe("expenses.list", () => {
  it("returns expenses for a case", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    enqueueSelect([{ id: ID.case1 }]); // assertCaseAccess
    enqueueSelect([makeExpense()]);

    const result = await caller(ctx).list({ caseId: ID.case1 });
    expect(result.expenses).toHaveLength(1);
    expect(result.expenses[0]!.id).toBe(ID.expense);
  });

  it("returns empty array when no expenses", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([]);

    const result = await caller(ctx).list({ caseId: ID.case1 });
    expect(result.expenses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// expenses.create
// ---------------------------------------------------------------------------
describe("expenses.create", () => {
  it("inserts expense with correct fields", async () => {
    const { db, insertCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    enqueueSelect([{ id: ID.case1 }]); // assertCaseAccess

    await caller(ctx).create({
      caseId: ID.case1,
      category: "filing_fee",
      description: "Court filing",
      amountCents: 30000,
      expenseDate: "2026-04-01",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.category).toBe("filing_fee");
    expect(vals.amountCents).toBe(30000);
    expect(vals.orgId).toBe(ID.org);
    expect(vals.userId).toBe(ID.user);
    expect(vals.caseId).toBe(ID.case1);
  });

  it("solo user inserts with orgId null", async () => {
    const { db, insertCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.solo, orgId: null, role: null } };

    // assertCaseAccess for solo user
    enqueueSelect([{ id: ID.case1 }]);

    await caller(ctx).create({
      caseId: ID.case1,
      category: "courier",
      description: "Courier fee",
      amountCents: 1500,
      expenseDate: "2026-04-01",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.orgId).toBeNull();
    expect(vals.userId).toBe(ID.solo);
  });
});

// ---------------------------------------------------------------------------
// expenses.update
// ---------------------------------------------------------------------------
describe("expenses.update", () => {
  it("updates expense fields", async () => {
    const { db, updateCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // assertExpenseEdit: (1) fetch expense, (2) assertCaseAccess, (3) isExpenseInvoiced
    enqueueSelect([makeExpense({ userId: ID.user })]);
    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([]); // not invoiced

    await caller(ctx).update({ id: ID.expense, description: "Updated desc", amountCents: 9900 });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.description).toBe("Updated desc");
    expect(setVals.amountCents).toBe(9900);
    expect(setVals.updatedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// expenses.delete
// ---------------------------------------------------------------------------
describe("expenses.delete", () => {
  it("deletes expense after permission checks pass", async () => {
    const { db, enqueueSelect, deleteCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    enqueueSelect([makeExpense({ userId: ID.user })]);
    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([]); // not invoiced

    const result = await caller(ctx).delete({ id: ID.expense });
    expect(result.success).toBe(true);
    expect(deleteCalls).toHaveLength(1);
  });
});
