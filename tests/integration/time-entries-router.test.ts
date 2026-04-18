// tests/integration/time-entries-router.test.ts
//
// Unit tests for the timeEntries tRPC router. Uses a chainable mock ctx.db
// (no real DB access), matching the tests/integration/clients-router.test.ts pattern.

import { describe, it, expect } from "vitest";
import type { db as realDb } from "@/server/db";
import { timeEntriesRouter } from "@/server/trpc/routers/time-entries";
import type { timeEntries } from "@/server/db/schema/time-entries";
import type { cases } from "@/server/db/schema/cases";

type TimeEntryRow = typeof timeEntries.$inferSelect;
type CaseRow = typeof cases.$inferSelect;
type MockUser = { id: string; orgId: string | null; role: string | null };
type Ctx = { db: typeof realDb; user: MockUser };

// ---------------------------------------------------------------------------
// Stable UUIDs
// ---------------------------------------------------------------------------
const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  org: "33333333-3333-4333-a333-333333333333",
  entry: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  case1: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  client: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
  solo: "77777777-7777-4777-a777-777777777777",
};

// ---------------------------------------------------------------------------
// makeMockDb — queue-draining chainable mock
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
    returning: async () => [{ id: ID.entry, ...(call.values as object) }],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeUpdateChain = (call: { set?: unknown }): any => ({
    set: (s: unknown) => {
      call.set = s;
      return makeUpdateChain(call);
    },
    where: () => makeUpdateChain(call),
    returning: async () => [{ id: ID.entry, ...(call.set as object) }],
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
const caller = (ctx: Ctx) => timeEntriesRouter.createCaller(ctx as unknown as any);

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------
const makeEntry = (overrides: Partial<TimeEntryRow> = {}): TimeEntryRow =>
  ({
    id: ID.entry,
    orgId: ID.org,
    userId: ID.user,
    caseId: ID.case1,
    taskId: null,
    activityType: "other",
    description: "Work",
    durationMinutes: 60,
    isBillable: true,
    rateCents: 30000,
    amountCents: 30000,
    entryDate: new Date("2026-04-01"),
    timerStartedAt: null,
    timerStoppedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as TimeEntryRow;

const makeCaseRow = (overrides: Partial<CaseRow> = {}): CaseRow =>
  ({
    id: ID.case1,
    orgId: ID.org,
    userId: ID.user,
    clientId: ID.client,
    name: "Test Case",
    status: "active",
    stageId: null,
    description: null,
    practiceArea: null,
    caseNumber: null,
    courtName: null,
    judge: null,
    filingDate: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as CaseRow;

// ---------------------------------------------------------------------------
// timeEntries.list
// ---------------------------------------------------------------------------
describe("timeEntries.list", () => {
  it("returns entries for a case the user can access", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // (1) assertCaseAccess, (2) list entries — query returns joined rows { entry, invoiceLineItemId, invoiceStatus }
    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([{ entry: makeEntry(), invoiceLineItemId: null, invoiceStatus: null }]);

    const result = await caller(ctx).list({ caseId: ID.case1 });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.id).toBe(ID.entry);
  });

  it("returns empty array when no entries exist", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([]);

    const result = await caller(ctx).list({ caseId: ID.case1 });
    expect(result.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// timeEntries.create
// ---------------------------------------------------------------------------
describe("timeEntries.create", () => {
  it("inserts entry with computed amountCents from rate", async () => {
    const { db, insertCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) assertCaseAccess, (2) case-specific rate lookup, (3) default rate lookup
    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([]); // no case-specific rate
    enqueueSelect([{ rateCents: 30000 }]); // default rate: $300/hr

    await caller(ctx).create({
      caseId: ID.case1,
      activityType: "research",
      description: "Legal research",
      durationMinutes: 60,
      isBillable: true,
      entryDate: "2026-04-01",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;

    // 60 min * $300/hr = $300 = 30000 cents
    expect(vals.amountCents).toBe(30000);
    expect(vals.rateCents).toBe(30000);
    expect(vals.durationMinutes).toBe(60);
    expect(vals.isBillable).toBe(true);
    expect(vals.orgId).toBe(ID.org);
    expect(vals.userId).toBe(ID.user);
  });

  it("inserts with amountCents=0 for non-billable entry", async () => {
    const { db, insertCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) assertCaseAccess
    enqueueSelect([{ id: ID.case1 }]);
    // No rate lookups for non-billable

    await caller(ctx).create({
      caseId: ID.case1,
      activityType: "administrative",
      description: "Admin work",
      durationMinutes: 30,
      isBillable: false,
      entryDate: "2026-04-01",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.amountCents).toBe(0);
    expect(vals.rateCents).toBe(0);
  });

  it("uses case-specific rate when available", async () => {
    const { db, insertCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([{ rateCents: 40000 }]); // case-specific rate: $400/hr

    await caller(ctx).create({
      caseId: ID.case1,
      activityType: "drafting",
      description: "Brief",
      durationMinutes: 90, // 1.5 hours
      isBillable: true,
      entryDate: "2026-04-01",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    // 90 min * $400/hr = $600 = 60000 cents
    expect(vals.rateCents).toBe(40000);
    expect(vals.amountCents).toBe(60000);
  });
});

// ---------------------------------------------------------------------------
// timeEntries.startTimer
// ---------------------------------------------------------------------------
describe("timeEntries.startTimer", () => {
  it("creates entry with timerStartedAt set and durationMinutes=0", async () => {
    const { db, insertCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) assertCaseAccess, (2) running timer check (none), (3) case-specific rate, (4) default rate
    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([]); // no running timer
    enqueueSelect([]); // no case-specific rate
    enqueueSelect([]); // no default rate

    await caller(ctx).startTimer({
      caseId: ID.case1,
      activityType: "research",
      description: "Starting timer",
      isBillable: true,
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.durationMinutes).toBe(0);
    expect(vals.amountCents).toBe(0);
    expect(vals.timerStartedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// timeEntries.getRunningTimer
// ---------------------------------------------------------------------------
describe("timeEntries.getRunningTimer", () => {
  it("returns null when no timer is running", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    enqueueSelect([]); // no running timer

    const result = await caller(ctx).getRunningTimer();
    expect(result).toBeNull();
  });

  it("returns entry and caseName when timer is running", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    enqueueSelect([
      {
        entry: makeEntry({ timerStartedAt: new Date() }),
        caseName: makeCaseRow().name,
      },
    ]);

    const result = await caller(ctx).getRunningTimer();
    expect(result).not.toBeNull();
    expect(result!.caseName).toBe("Test Case");
    expect(result!.entry.id).toBe(ID.entry);
  });
});

// ---------------------------------------------------------------------------
// timeEntries.delete
// ---------------------------------------------------------------------------
describe("timeEntries.delete", () => {
  it("deletes entry after passing permission checks", async () => {
    const { db, enqueueSelect, deleteCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // assertTimeEntryEdit: (1) fetch entry, (2) assertCaseAccess, (3) isEntryInvoiced
    enqueueSelect([makeEntry({ userId: ID.user })]);
    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([]); // not invoiced

    const result = await caller(ctx).delete({ id: ID.entry });
    expect(result.success).toBe(true);
    expect(deleteCalls).toHaveLength(1);
  });
});
