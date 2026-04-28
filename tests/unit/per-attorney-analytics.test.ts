// tests/unit/per-attorney-analytics.test.ts
//
// Unit tests for the 3.3b per-attorney analytics queries. Reuses the same
// chainable mock-db pattern as analytics-queries.test.ts: every .from /
// .leftJoin / .innerJoin / .where / .groupBy / .orderBy returns the same
// thenable, which resolves to the next queued result row set.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCasesPerAttorney,
  getHoursPerAttorney,
  getRevenuePerAttorney,
  getAvgCaseDurationPerAttorney,
  getDeadlineCompliancePerAttorney,
} from "@/server/services/analytics/per-attorney";

function makeDb(resultQueue: any[][]) {
  const queue = [...resultQueue];

  const buildChain = () => {
    let resolved = false;
    const next = (): any[] => {
      if (resolved) return [];
      resolved = true;
      return queue.shift() ?? [];
    };
    const chain: any = {
      from: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: any, reject: any) =>
        Promise.resolve(next()).then(resolve, reject),
    };
    return chain;
  };

  const db: any = { select: () => buildChain() };
  return db;
}

const orgScope = { orgId: "org-1", userId: "user-1" };
const range = {
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-04-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCasesPerAttorney", () => {
  it("groups active cases by lead attorney (case_members > cases.userId)", async () => {
    const db = makeDb([
      // caseRows (getCaseLeads first select)
      [
        { id: "c1", userId: "u-creator-1", createdAt: new Date(), stageSlug: "intake" },
        { id: "c2", userId: "u-creator-2", createdAt: new Date(), stageSlug: "active" },
        { id: "c3", userId: "u-creator-1", createdAt: new Date(), stageSlug: "closed" },
        { id: "c4", userId: "u-creator-2", createdAt: new Date(), stageSlug: null },
      ],
      // roster (getOrgRoster runs in parallel via Promise.all; resolves before leadRows)
      [
        { id: "u-creator-1", name: "Alice", email: "a@x" },
        { id: "u-creator-2", name: "Bob", email: "b@x" },
        { id: "u-lead-x", name: "Lex", email: "l@x" },
      ],
      // leadRows — c2 has explicit lead u-lead-x, c1/c4 fall back to creator
      [{ caseId: "c2", userId: "u-lead-x" }],
    ]);
    const out = await getCasesPerAttorney(db, orgScope);
    const byUser = Object.fromEntries(out.map((r) => [r.userId, r.value]));
    expect(byUser["u-creator-1"]).toBe(1); // c1 (c3 closed)
    expect(byUser["u-creator-2"]).toBe(1); // c4 only — c2 reassigned to lead
    expect(byUser["u-lead-x"]).toBe(1); // c2
  });

  it("returns [] for solo / non-org users", async () => {
    const db = makeDb([]);
    const out = await getCasesPerAttorney(db, { orgId: null, userId: "u" });
    expect(out).toEqual([]);
  });
});

describe("getHoursPerAttorney", () => {
  it("converts grouped minutes to hours per attorney", async () => {
    const db = makeDb([
      // roster
      [
        { id: "u1", name: "Alice", email: "a@x" },
        { id: "u2", name: "Bob", email: "b@x" },
      ],
      // grouped time-entry rows
      [
        { userId: "u1", minutes: 360 }, // 6h
        { userId: "u2", minutes: 90 }, // 1.5h
      ],
    ]);
    const out = await getHoursPerAttorney(db, orgScope, range);
    const byUser = Object.fromEntries(out.map((r) => [r.userId, r.value]));
    expect(byUser["u1"]).toBe(6);
    expect(byUser["u2"]).toBe(1.5);
    // sorted DESC
    expect(out[0]?.userId).toBe("u1");
  });

  it("returns [] for solo users", async () => {
    const db = makeDb([]);
    const out = await getHoursPerAttorney(db, { orgId: null, userId: "u" }, range);
    expect(out).toEqual([]);
  });
});

describe("getRevenuePerAttorney", () => {
  it("converts cents → dollars per attorney", async () => {
    const db = makeDb([
      // roster
      [{ id: "u1", name: "Alice", email: "a@x" }],
      // grouped invoice rows
      [{ userId: "u1", cents: 12_345_67 }],
    ]);
    const out = await getRevenuePerAttorney(db, orgScope, range);
    expect(out[0]?.value).toBeCloseTo(12345.67, 2);
  });
});

describe("getAvgCaseDurationPerAttorney", () => {
  it("averages active-case age (days) per lead, skipping closed", async () => {
    const created = new Date("2026-01-01T00:00:00Z"); // 105 days before fake now
    const db = makeDb([
      // caseRows
      [
        { id: "c1", userId: "u1", createdAt: created, stageSlug: "intake" },
        { id: "c2", userId: "u1", createdAt: created, stageSlug: "closed" }, // skipped
        { id: "c3", userId: "u1", createdAt: created, stageSlug: null }, // active
      ],
      // roster (Promise.all sibling — resolves before leadRows)
      [{ id: "u1", name: "Alice", email: "a@x" }],
      // leadRows — none, fall back to creator
      [],
    ]);
    const out = await getAvgCaseDurationPerAttorney(db, orgScope);
    expect(out).toHaveLength(1);
    expect(out[0]?.value).toBe(105);
  });
});

describe("getDeadlineCompliancePerAttorney", () => {
  it("buckets deadlines by lead attorney", async () => {
    const db = makeDb([
      // caseRows
      [
        { id: "c1", userId: "u1", createdAt: new Date(), stageSlug: "active" },
        { id: "c2", userId: "u2", createdAt: new Date(), stageSlug: "active" },
      ],
      // roster (Promise.all sibling — resolves before leadRows)
      [
        { id: "u1", name: "Alice", email: "a@x" },
        { id: "u2", name: "Bob", email: "b@x" },
      ],
      // leadRows — none, fall back to creator
      [],
      // deadline rows
      [
        // u1: met
        { caseId: "c1", dueDate: "2026-02-15", completedAt: new Date("2026-02-10T00:00:00Z") },
        // u1: overdue
        { caseId: "c1", dueDate: "2026-03-01", completedAt: null },
        // u2: upcoming
        { caseId: "c2", dueDate: "2026-05-30", completedAt: null },
      ],
    ]);
    // widen range to catch all three
    const r = {
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
    };
    const out = await getDeadlineCompliancePerAttorney(db, orgScope, r);
    const byUser = Object.fromEntries(out.map((r2) => [r2.userId, r2]));
    expect(byUser["u1"]).toMatchObject({ met: 1, overdue: 1, upcoming: 0 });
    expect(byUser["u2"]).toMatchObject({ met: 0, overdue: 0, upcoming: 1 });
  });

  it("respects date range — out-of-range deadlines are not fetched", async () => {
    // The query filters by due_date in [start,end] at the DB level. Our mock
    // simply returns whatever the test queues, so simulate the empty result.
    const db = makeDb([
      [{ id: "c1", userId: "u1", createdAt: new Date(), stageSlug: "active" }],
      [{ id: "u1", name: "Alice", email: "a@x" }], // roster
      [], // leadRows
      [], // no deadlines in range
    ]);
    const out = await getDeadlineCompliancePerAttorney(db, orgScope, range);
    expect(out).toEqual([]);
  });

  it("returns [] for solo users", async () => {
    const db = makeDb([]);
    const out = await getDeadlineCompliancePerAttorney(
      db,
      { orgId: null, userId: "u" },
      range,
    );
    expect(out).toEqual([]);
  });
});
