// tests/unit/analytics-queries.test.ts
//
// Unit tests for analytics queries. Uses a tiny chainable mock db where every
// .from/.leftJoin/.innerJoin/.where/.groupBy/.orderBy call returns the same
// thenable, which resolves to a queued result. This matches how the service
// composes its Drizzle queries (each .select(...) is one logical query).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getKpis,
  getActiveCasesByStage,
  getCaseVelocity,
  getBillingTrend,
  getDeadlineCompliance,
  getPipelineFunnel,
} from "@/server/services/analytics/queries";

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

  const db: any = {
    select: () => buildChain(),
  };
  return db;
}

const scope = { orgId: "org-1", userId: "user-1" };
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

describe("getKpis", () => {
  it("computes active cases, total hours, revenue, and avg case age", async () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const db = makeDb([
      // caseRows
      [
        { id: "c1", createdAt: created, stageSlug: "active_work" },
        { id: "c2", createdAt: created, stageSlug: "closed" },
        { id: "c3", createdAt: created, stageSlug: null },
      ],
      // hoursRow (sum minutes)
      [{ minutes: 360 }],
      // revRow (cents)
      [{ cents: 12_345_67 }],
    ]);
    const kpis = await getKpis(db, scope, range);
    expect(kpis.activeCases).toBe(2); // c1 + c3
    expect(kpis.totalHours).toBe(6);
    expect(kpis.totalRevenue).toBeCloseTo(12345.67, 2);
    expect(kpis.avgCaseAgeDays).toBe(105); // jan 1 → apr 15
  });

  it("returns zeros when there are no cases", async () => {
    const db = makeDb([
      [], // caseRows
      // (no hours/revenue queries fire when ids is empty for hours;
      //  revenue still queries — provide one)
      [{ cents: 0 }],
    ]);
    const kpis = await getKpis(db, scope, range);
    expect(kpis).toEqual({
      activeCases: 0,
      totalHours: 0,
      totalRevenue: 0,
      avgCaseAgeDays: 0,
    });
  });
});

describe("getActiveCasesByStage", () => {
  it("returns rows with numeric counts", async () => {
    const db = makeDb([
      [
        { stageName: "Intake", stageColor: "#a", sortOrder: 1, count: 5 },
        { stageName: "Active Work", stageColor: "#b", sortOrder: 2, count: 3 },
      ],
    ]);
    const rows = await getActiveCasesByStage(db, scope);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ stageName: "Intake", stageColor: "#a", count: 5 });
    expect(rows[1]?.count).toBe(3);
  });
});

describe("getCaseVelocity", () => {
  it("computes consecutive event-pair durations per stage and averages them", async () => {
    const events = [
      // Case c1: Intake (Jan 1 → Jan 11) = 10d, Research (Jan 11 → Jan 21) = 10d
      {
        caseId: "c1",
        occurredAt: new Date("2026-01-01T00:00:00Z"),
        metadata: { toStageName: "Intake" },
      },
      {
        caseId: "c1",
        occurredAt: new Date("2026-01-11T00:00:00Z"),
        metadata: { toStageName: "Research", fromStageName: "Intake" },
      },
      {
        caseId: "c1",
        occurredAt: new Date("2026-01-21T00:00:00Z"),
        metadata: { toStageName: "Active", fromStageName: "Research" },
      },
      // Case c2: Intake (Jan 1 → Jan 5) = 4d
      {
        caseId: "c2",
        occurredAt: new Date("2026-01-01T00:00:00Z"),
        metadata: { toStageName: "Intake" },
      },
      {
        caseId: "c2",
        occurredAt: new Date("2026-01-05T00:00:00Z"),
        metadata: { toStageName: "Research", fromStageName: "Intake" },
      },
    ];
    const db = makeDb([
      // scopedCaseIds
      [{ id: "c1" }, { id: "c2" }],
      // events
      events,
    ]);
    const out = await getCaseVelocity(db, scope, range);
    const byStage = Object.fromEntries(out.map((r) => [r.stageName, r]));
    expect(byStage.Intake?.avgDays).toBeCloseTo(7, 1); // (10+4)/2
    expect(byStage.Intake?.sampleSize).toBe(2);
    expect(byStage.Research?.avgDays).toBeCloseTo(10, 1);
    expect(byStage.Research?.sampleSize).toBe(1);
  });
});

describe("getBillingTrend", () => {
  it("produces 12 monthly buckets ending in range.endDate's month", async () => {
    const db = makeDb([
      // scopedCaseIds
      [{ id: "c1" }],
      // hoursRows (one bucket)
      [{ bucket: "2026-03", minutes: 120 }],
      // revRows (one bucket)
      [{ bucket: "2026-04", cents: 50000 }],
    ]);
    const range12 = {
      startDate: new Date("2025-05-01T00:00:00Z"),
      endDate: new Date("2026-04-15T00:00:00Z"),
    };
    const out = await getBillingTrend(db, scope, range12);
    expect(out).toHaveLength(12);
    expect(out[0]?.month).toBe("2025-05");
    expect(out[11]?.month).toBe("2026-04");
    const mar = out.find((b) => b.month === "2026-03");
    expect(mar?.hours).toBe(2); // 120/60
    const apr = out.find((b) => b.month === "2026-04");
    expect(apr?.revenue).toBe(500);
  });

  it("respects the date range — returned months end at range.endDate", async () => {
    const db = makeDb([
      [{ id: "c1" }], // ids
      [], // hoursRows
      [], // revRows
    ]);
    const r = {
      startDate: new Date("2025-12-01T00:00:00Z"),
      endDate: new Date("2026-02-15T00:00:00Z"),
    };
    const out = await getBillingTrend(db, scope, r);
    expect(out[11]?.month).toBe("2026-02");
    expect(out[0]?.month).toBe("2025-03");
  });
});

describe("getDeadlineCompliance", () => {
  it("buckets met / overdue / upcoming correctly", async () => {
    // Now is 2026-04-15. Range 2026-01-01 → 2026-04-01.
    const db = makeDb([
      // scopedCaseIds
      [{ id: "c1" }],
      // deadlines rows
      [
        // Met: completed before due date
        {
          dueDate: "2026-02-15",
          completedAt: new Date("2026-02-10T00:00:00Z"),
        },
        // Overdue: past due, not completed
        { dueDate: "2026-03-01", completedAt: null },
        // Late completion → counts as overdue
        {
          dueDate: "2026-03-15",
          completedAt: new Date("2026-03-20T00:00:00Z"),
        },
      ],
    ]);
    // shift range to include all three
    const r = {
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-04-01T00:00:00Z"),
    };
    const out = await getDeadlineCompliance(db, scope, r);
    expect(out.met).toBe(1);
    expect(out.overdue).toBe(2);
    expect(out.upcoming).toBe(0);
  });

  it("flags future due dates as upcoming", async () => {
    const db = makeDb([
      [{ id: "c1" }],
      [{ dueDate: "2026-05-30", completedAt: null }],
    ]);
    const r = {
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
    };
    const out = await getDeadlineCompliance(db, scope, r);
    expect(out.upcoming).toBe(1);
    expect(out.overdue).toBe(0);
    expect(out.met).toBe(0);
  });
});

describe("getPipelineFunnel", () => {
  it("dedupes cases per stage", async () => {
    const db = makeDb([
      // scopedCaseIds
      [{ id: "c1" }, { id: "c2" }],
      // events — c1 enters Intake twice; should still count once
      [
        { caseId: "c1", metadata: { toStageName: "Intake" } },
        { caseId: "c1", metadata: { toStageName: "Intake" } },
        { caseId: "c1", metadata: { toStageName: "Research" } },
        { caseId: "c2", metadata: { toStageName: "Intake" } },
      ],
      // stageRows
      [
        { name: "Intake", color: "#a", sortOrder: 1 },
        { name: "Research", color: "#b", sortOrder: 2 },
      ],
    ]);
    const out = await getPipelineFunnel(db, scope);
    const intake = out.find((r) => r.stageName === "Intake");
    const research = out.find((r) => r.stageName === "Research");
    expect(intake?.everEntered).toBe(2);
    expect(research?.everEntered).toBe(1);
    // ordered by sortOrder
    expect(out[0]?.stageName).toBe("Intake");
  });
});
