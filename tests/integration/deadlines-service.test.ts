// tests/integration/deadlines-service.test.ts
import { describe, it, expect } from "vitest";
import { DeadlinesService } from "@/server/services/deadlines/service";

function makeMockDb(opts: {
  rules?: Array<{ id: string; triggerEvent: string; name: string; days: number; dayType: "calendar" | "court"; shiftIfHoliday: boolean; defaultReminders: number[]; jurisdiction: string }>;
  holidays?: string[];
  existingTrigger?: any;
  existingDeadlines?: any[];
}) {
  const inserts: Array<{ table: string; values: any }> = [];
  const updates: Array<{ table: string; set: any; where?: any }> = [];
  const deletes: Array<{ table: string }> = [];

  const tableName = (t: unknown): string => {
    const name = (t as any)[Symbol.for("drizzle:Name")] as string | undefined;
    if (name) return name;
    return "unknown";
  };

  const makeSelectResult = (name: string): any[] => {
    if (name === "court_holidays") {
      return (opts.holidays ?? []).map((d) => ({ observedDate: d, name: "Holiday" }));
    }
    if (name === "deadline_rules") return opts.rules ?? [];
    if (name === "case_trigger_events") return opts.existingTrigger ? [opts.existingTrigger] : [];
    if (name === "case_deadlines") return opts.existingDeadlines ?? [];
    return [];
  };

  const db: any = {
    insert: (t: unknown) => ({
      values: (v: any) => {
        const name = tableName(t);
        inserts.push({ table: name, values: v });
        const rows = Array.isArray(v) ? v : [v];
        return {
          returning: async () => rows.map((r, i) => ({ id: `row-${inserts.length}-${i}`, ...r })),
        };
      },
    }),
    update: (t: unknown) => ({
      set: (s: any) => ({
        where: (w: any) => {
          updates.push({ table: tableName(t), set: s, where: w });
          return Promise.resolve();
        },
      }),
    }),
    delete: (t: unknown) => ({
      where: () => {
        deletes.push({ table: tableName(t) });
        return Promise.resolve();
      },
    }),
    select: (_cols?: unknown) => ({
      from: (t: unknown) => {
        const name = tableName(t);
        const rows = makeSelectResult(name);
        // Build a thenable where-clause so that `await db.select().from(t).where(...)` works
        // even when neither .limit() nor .orderBy() is called afterwards.
        const makeWhere = () => {
          const whereResult: any = Promise.resolve(rows);
          whereResult.limit = async () => rows;
          whereResult.orderBy = (_col?: unknown) => Promise.resolve(rows);
          return whereResult;
        };
        return {
          where: makeWhere,
        };
      },
    }),
  };
  return { db, inserts, updates, deletes };
}

const FRCP_ANSWER_DUE = {
  id: "rule-answer",
  triggerEvent: "served_defendant",
  name: "Answer Due",
  days: 21,
  dayType: "calendar" as const,
  shiftIfHoliday: true,
  defaultReminders: [7, 3, 1],
  jurisdiction: "FRCP",
};

describe("DeadlinesService.createTriggerEvent", () => {
  it("creates trigger event + matching rule deadlines", async () => {
    const { db, inserts } = makeMockDb({ rules: [FRCP_ANSWER_DUE], holidays: [] });
    const svc = new DeadlinesService({ db });
    const result = await svc.createTriggerEvent({
      caseId: "case-1",
      triggerEvent: "served_defendant",
      eventDate: "2026-04-15",
      jurisdiction: "FRCP",
      createdBy: "user-1",
    });
    expect(result.deadlinesCreated).toBe(1);
    const triggerInsert = inserts.find((i) => i.table === "case_trigger_events");
    expect(triggerInsert).toBeTruthy();
    const deadlineInsert = inserts.find((i) => i.table === "case_deadlines");
    expect(deadlineInsert).toBeTruthy();
    const dls = Array.isArray(deadlineInsert!.values) ? deadlineInsert!.values : [deadlineInsert!.values];
    expect(dls[0].dueDate).toBe("2026-05-06"); // 2026-04-15 + 21 days = 2026-05-06 Wed
  });

  it("creates trigger with zero matching rules", async () => {
    const { db, inserts } = makeMockDb({ rules: [], holidays: [] });
    const svc = new DeadlinesService({ db });
    const result = await svc.createTriggerEvent({
      caseId: "case-1",
      triggerEvent: "unknown_event",
      eventDate: "2026-04-15",
      jurisdiction: "FRCP",
      createdBy: "user-1",
    });
    expect(result.deadlinesCreated).toBe(0);
    expect(inserts.some((i) => i.table === "case_trigger_events")).toBe(true);
    expect(inserts.some((i) => i.table === "case_deadlines")).toBe(false);
  });
});

describe("DeadlinesService.updateTriggerEventDate", () => {
  it("recomputes non-overridden deadlines", async () => {
    const existingDeadlines = [
      { id: "d1", manualOverride: false, ruleId: "rule-answer", title: "Answer Due" },
      { id: "d2", manualOverride: true, ruleId: "rule-answer", title: "Answer Due (edited)" },
    ];
    const { db, updates } = makeMockDb({
      rules: [FRCP_ANSWER_DUE],
      holidays: [],
      existingTrigger: { id: "t1", caseId: "case-1", triggerEvent: "served_defendant", eventDate: "2026-04-15", jurisdiction: "FRCP" },
      existingDeadlines,
    });
    const svc = new DeadlinesService({ db });
    const result = await svc.updateTriggerEventDate({ triggerEventId: "t1", newEventDate: "2026-04-20" });
    expect(result.recomputed).toBe(1);
    expect(result.preserved).toBe(1);
    // Should have UPDATE on trigger + UPDATE on d1 only (not d2)
    const deadlineUpdates = updates.filter((u) => u.table === "case_deadlines");
    expect(deadlineUpdates.length).toBe(1);
  });
});

describe("DeadlinesService.createManualDeadline + complete", () => {
  it("inserts manual deadline with source=manual", async () => {
    const { db, inserts } = makeMockDb({});
    const svc = new DeadlinesService({ db });
    await svc.createManualDeadline({
      caseId: "case-1",
      title: "Client check-in",
      dueDate: "2026-06-01",
      reminders: [5, 1],
    });
    const i = inserts.find((x) => x.table === "case_deadlines");
    expect(i).toBeTruthy();
    const v = Array.isArray(i!.values) ? i!.values[0] : i!.values;
    expect(v.source).toBe("manual");
    expect(v.title).toBe("Client check-in");
    expect(v.reminders).toEqual([5, 1]);
  });
});

describe("DeadlinesService.updateDeadline", () => {
  it("flips manualOverride=true", async () => {
    const { db, updates } = makeMockDb({});
    const svc = new DeadlinesService({ db });
    await svc.updateDeadline({ deadlineId: "d1", title: "Changed" });
    const u = updates.find((x) => x.table === "case_deadlines");
    expect(u).toBeTruthy();
    expect((u!.set as any).manualOverride).toBe(true);
    expect((u!.set as any).title).toBe("Changed");
  });
});

describe("DeadlinesService.markComplete", () => {
  it("sets completedAt without changing manualOverride", async () => {
    const { db, updates } = makeMockDb({});
    const svc = new DeadlinesService({ db });
    await svc.markComplete({ deadlineId: "d1", userId: "u1" });
    const u = updates.find((x) => x.table === "case_deadlines");
    expect(u).toBeTruthy();
    expect((u!.set as any).completedAt).toBeInstanceOf(Date);
    expect((u!.set as any).completedBy).toBe("u1");
    expect((u!.set as any).manualOverride).toBeUndefined();
  });
});
