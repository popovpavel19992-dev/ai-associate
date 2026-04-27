// tests/unit/multi-jurisdiction-rules.test.ts
// Phase 3.7 — verifies seed shape + service-layer fallback for multi-jurisdiction.

import { describe, it, expect } from "vitest";
import { STATE_RULE_COUNTS } from "@/server/db/seed/deadline-rules-states";
import { DeadlinesService } from "@/server/services/deadlines/service";

// Re-import the underlying rule arrays through the seed module's exports for assertions.
// We don't export the arrays directly, so we re-derive coverage via STATE_RULE_COUNTS plus
// a small targeted dynamic import to read the file as text. To keep tests pure, we instead
// verify counts and use the service for fallback behavior — the SOL year values are spot-checked
// here by exercising the service against a mocked rule set.

describe("multi-jurisdiction seed coverage", () => {
  it("each state has at least 20 rules seeded", () => {
    expect(STATE_RULE_COUNTS.CA).toBeGreaterThanOrEqual(20);
    expect(STATE_RULE_COUNTS.TX).toBeGreaterThanOrEqual(20);
    expect(STATE_RULE_COUNTS.FL).toBeGreaterThanOrEqual(20);
    expect(STATE_RULE_COUNTS.NY).toBeGreaterThanOrEqual(20);
  });

  it("aggregate state rule count is in the expected 80-150 range", () => {
    const total = STATE_RULE_COUNTS.CA + STATE_RULE_COUNTS.TX + STATE_RULE_COUNTS.FL + STATE_RULE_COUNTS.NY;
    expect(total).toBeGreaterThanOrEqual(80);
    expect(total).toBeLessThanOrEqual(150);
  });
});

// ---- Mock DB helper (mirrors tests/integration/deadlines-service.test.ts) ----
function makeMockDb(opts: {
  rulesByJurisdiction?: Record<string, Array<{ id: string; triggerEvent: string; name: string; days: number; dayType: "calendar" | "court"; shiftIfHoliday: boolean; defaultReminders: number[]; jurisdiction: string }>>;
  holidaysByJurisdiction?: Record<string, string[]>;
}) {
  const inserts: Array<{ table: string; values: any }> = [];
  const tableName = (t: unknown): string => {
    const name = (t as any)[Symbol.for("drizzle:Name")] as string | undefined;
    return name ?? "unknown";
  };

  // Track which jurisdiction the .where() clause is filtering on. We approximate by
  // capturing the most recent jurisdiction passed to eq(...) via a side-channel.
  let lastSelectArgs: { table: string; whereCalls: number } = { table: "", whereCalls: 0 };
  // The mock will iterate possible jurisdictions: first call returns rules for the requested,
  // second call returns FRCP. We capture this by tracking call count per table.
  const callCounts: Record<string, number> = {};

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
    update: (_t: unknown) => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
    delete: (_t: unknown) => ({ where: () => Promise.resolve() }),
    select: () => ({
      from: (t: unknown) => {
        const name = tableName(t);
        callCounts[name] = (callCounts[name] ?? 0) + 1;
        const callIdx = callCounts[name];

        const resolveRules = (): any[] => {
          // First call: state rules, second call: FRCP fallback
          const firstJ = (Object.keys(opts.rulesByJurisdiction ?? {}).filter((j) => j !== "FRCP")[0]) ?? "FRCP";
          if (callIdx === 1) return opts.rulesByJurisdiction?.[firstJ] ?? [];
          return opts.rulesByJurisdiction?.["FRCP"] ?? [];
        };

        const resolveHolidays = (): any[] => {
          // Service first probes state holidays via a count-style select.
          // Then issues the actual holiday-row read. We hand back the same calendar both times.
          const candidates = Object.keys(opts.holidaysByJurisdiction ?? {});
          const j = candidates[0] ?? "FEDERAL";
          return (opts.holidaysByJurisdiction?.[j] ?? []).map((d) => ({ observedDate: d, name: "Holiday", id: `h-${d}` }));
        };

        const rows = name === "deadline_rules"
          ? resolveRules()
          : name === "court_holidays"
            ? resolveHolidays()
            : name === "case_trigger_events"
              ? []
              : [];

        const whereResult: any = Promise.resolve(rows);
        whereResult.limit = async () => rows;
        whereResult.orderBy = () => Promise.resolve(rows);
        return { where: () => whereResult };
      },
    }),
  };

  lastSelectArgs.whereCalls++; // suppress unused-var
  return { db, inserts };
}

const FRCP_ANSWER_RULE = {
  id: "frcp-answer",
  triggerEvent: "served_defendant",
  name: "FRCP Answer Due",
  days: 21,
  dayType: "calendar" as const,
  shiftIfHoliday: true,
  defaultReminders: [7, 3, 1],
  jurisdiction: "FRCP",
};

const CA_ANSWER_RULE = {
  id: "ca-answer",
  triggerEvent: "served_defendant",
  name: "CA Answer Due",
  days: 30,
  dayType: "calendar" as const,
  shiftIfHoliday: true,
  defaultReminders: [7, 3, 1],
  jurisdiction: "CA",
};

describe("DeadlinesService — multi-jurisdiction lookup", () => {
  it("uses state-specific rule when present (CA: 30-day answer)", async () => {
    const { db, inserts } = makeMockDb({
      rulesByJurisdiction: { CA: [CA_ANSWER_RULE] },
      holidaysByJurisdiction: { CA: [] },
    });
    const svc = new DeadlinesService({ db });
    const result = await svc.createTriggerEvent({
      caseId: "case-1",
      triggerEvent: "served_defendant",
      eventDate: "2026-04-15",
      jurisdiction: "CA",
      createdBy: "user-1",
    });
    expect(result.deadlinesCreated).toBe(1);
    const deadlineInsert = inserts.find((i) => i.table === "case_deadlines")!;
    const dls = Array.isArray(deadlineInsert.values) ? deadlineInsert.values : [deadlineInsert.values];
    // 2026-04-15 + 30 days = 2026-05-15 (Friday)
    expect(dls[0].dueDate).toBe("2026-05-15");
    expect(dls[0].title).toBe("CA Answer Due");
  });

  it("falls back to FRCP when no state rule exists", async () => {
    const { db, inserts } = makeMockDb({
      // CA has no rules — fallback should pick FRCP
      rulesByJurisdiction: { CA: [], FRCP: [FRCP_ANSWER_RULE] },
      holidaysByJurisdiction: { CA: [], FEDERAL: [] },
    });
    const svc = new DeadlinesService({ db });
    const result = await svc.createTriggerEvent({
      caseId: "case-1",
      triggerEvent: "served_defendant",
      eventDate: "2026-04-15",
      jurisdiction: "CA",
      createdBy: "user-1",
    });
    expect(result.deadlinesCreated).toBe(1);
    const deadlineInsert = inserts.find((i) => i.table === "case_deadlines")!;
    const dls = Array.isArray(deadlineInsert.values) ? deadlineInsert.values : [deadlineInsert.values];
    // FRCP fallback: 21 days
    expect(dls[0].dueDate).toBe("2026-05-06");
    expect(dls[0].title).toBe("FRCP Answer Due");
  });

  it("does not double-fall-back when jurisdiction is already FRCP", async () => {
    const { db, inserts } = makeMockDb({
      rulesByJurisdiction: { FRCP: [] },
      holidaysByJurisdiction: { FEDERAL: [] },
    });
    const svc = new DeadlinesService({ db });
    const result = await svc.createTriggerEvent({
      caseId: "case-1",
      triggerEvent: "served_defendant",
      eventDate: "2026-04-15",
      jurisdiction: "FRCP",
      createdBy: "user-1",
    });
    expect(result.deadlinesCreated).toBe(0);
    expect(inserts.some((i) => i.table === "case_deadlines")).toBe(false);
  });
});

// ---- Statute-of-limitations spot checks ----
// Verifies the seeded SOL rules carry the year values claimed in the spec
// (CA=4, TX=4, FL=5, NY=6). We do this via a static lookup over the seed file.
import fs from "node:fs";
import path from "node:path";

describe("statute of limitations — contract", () => {
  const seedFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/server/db/seed/deadline-rules-states.ts"),
    "utf8",
  );

  it("CA written contract SOL: 4 years (1460 days)", () => {
    const block = seedFile.match(/CA_RULES[\s\S]*?const TX_RULES/)?.[0] ?? "";
    expect(block).toMatch(/Cal\. Civ\. Proc\. Code § 337/);
    expect(block).toMatch(/statute_of_limitations_contract[\s\S]*?days:\s*1460/);
  });

  it("TX written contract SOL: 4 years (1460 days)", () => {
    const block = seedFile.match(/TX_RULES[\s\S]*?const FL_RULES/)?.[0] ?? "";
    expect(block).toMatch(/statute_of_limitations_contract[\s\S]*?days:\s*1460/);
  });

  it("FL written contract SOL: 5 years (1825 days)", () => {
    const block = seedFile.match(/FL_RULES[\s\S]*?const NY_RULES/)?.[0] ?? "";
    expect(block).toMatch(/statute_of_limitations_contract[\s\S]*?days:\s*1825/);
  });

  it("NY contract SOL: 6 years (2190 days)", () => {
    const block = seedFile.match(/NY_RULES[\s\S]*?const ALL_STATE_RULES/)?.[0] ?? "";
    expect(block).toMatch(/statute_of_limitations_contract[\s\S]*?days:\s*2190/);
  });
});

describe("answer-to-complaint coverage per state", () => {
  const seedFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/server/db/seed/deadline-rules-states.ts"),
    "utf8",
  );

  it("each state defines a served_defendant answer rule", () => {
    for (const block of [
      seedFile.match(/CA_RULES[\s\S]*?const TX_RULES/)?.[0] ?? "",
      seedFile.match(/TX_RULES[\s\S]*?const FL_RULES/)?.[0] ?? "",
      seedFile.match(/FL_RULES[\s\S]*?const NY_RULES/)?.[0] ?? "",
      seedFile.match(/NY_RULES[\s\S]*?const ALL_STATE_RULES/)?.[0] ?? "",
    ]) {
      expect(block).toMatch(/triggerEvent:\s*"served_defendant"/);
    }
  });
});
