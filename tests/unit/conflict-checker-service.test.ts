// tests/unit/conflict-checker-service.test.ts
//
// Phase 3.6 — Unit tests for the multi-source conflict service.
//
// We hand-roll a mock db that returns canned rows for each .from() call (in
// order) and records inserts/updates so we can assert on side-effects.

import { describe, it, expect } from "vitest";
import {
  runConflictCheck,
  recordOverride,
  attachLogTarget,
  listLogs,
  getLog,
} from "@/server/services/conflict-checker/service";

type Op = { kind: "insert" | "update"; values?: any; set?: any };

function makeDb(opts: {
  // FIFO queue of result-arrays, one per .from(...) call
  selectQueue: any[][];
  insertReturnId?: string;
}) {
  const queue = [...opts.selectQueue];
  const ops: Op[] = [];
  const inserted: any[] = [];

  const db: any = {
    select: (_cols?: any) => ({
      from: (_t: any) => {
        const rows = queue.shift() ?? [];
        const chain: any = {
          where: (_w: any) => chain,
          innerJoin: (_t2: any, _on: any) => chain,
          leftJoin: (_t2: any, _on: any) => chain,
          orderBy: (..._x: any[]) => chain,
          limit: (_n: number) => chain,
          offset: (_n: number) => chain,
          returning: (_x?: any) => Promise.resolve(rows),
          then: (resolve: any, reject: any) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return chain;
      },
    }),
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        inserted.push(v);
        return {
          returning: (_cols?: any) =>
            Promise.resolve([{ id: opts.insertReturnId ?? "log-1" }]),
        };
      },
    }),
    update: (_t: any) => ({
      set: (s: any) => ({
        where: (_w: any) => {
          ops.push({ kind: "update", set: s });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, ops, inserted };
}

describe("runConflictCheck", () => {
  it("scans all 7 sources and returns sorted hits with a log row", async () => {
    // 7 source loads (clients, cases, parties, witnesses, subpoenas, mediators, demand letters).
    const queue: any[][] = [
      // 1. clients
      [{ displayName: "Acme Corporation", companyName: "Acme Corporation", firstName: null, lastName: null }],
      // 2/3. cases
      [
        { id: "case-1", name: "Case A", opposingParty: "John Smith", opposingCounsel: null },
      ],
      // 2b. case_parties
      [
        { name: "John Smyth", role: "opposing_counsel", caseId: "case-1", caseName: "Case A" },
      ],
      // 4. witnesses
      [
        { fullName: "Jane Doe", caseId: "case-2", caseName: "Case B" },
      ],
      // 5. subpoenas
      [
        { recipientName: "Records Custodian, Bank of X", caseId: "case-2", caseName: "Case B" },
      ],
      // 6. mediators
      [
        { mediatorName: "Robert Mediator", mediatorFirm: null, caseId: "case-3", caseName: "Case C" },
      ],
      // 7. demand letters
      [
        { recipientName: "John Smith", caseId: "case-4", caseName: "Case D" },
      ],
    ];
    const { db, ops, inserted } = makeDb({ selectQueue: queue, insertReturnId: "log-xyz" });

    const result = await runConflictCheck(
      db,
      "org-1",
      { name: "John Smith" },
      "user-1",
      "client_create",
    );

    expect(result.logId).toBe("log-xyz");
    // Exact match against demand recipient + opposing party = at least 2 HIGH; fuzzy "John Smyth" = MEDIUM.
    expect(result.hits.length).toBeGreaterThanOrEqual(2);
    expect(result.highestSeverity).toBe("HIGH");
    // First hit is the highest severity.
    expect(result.hits[0].severity).toBe("HIGH");
    // Sorted: HIGH severities first.
    const ranks = result.hits.map((h) =>
      h.severity === "HIGH" ? 3 : h.severity === "MEDIUM" ? 2 : 1,
    );
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i - 1]).toBeGreaterThanOrEqual(ranks[i]);
    }

    // Log row was inserted with snapshot.
    const insertOp = ops.find((o) => o.kind === "insert");
    expect(insertOp).toBeDefined();
    expect(insertOp!.values.queryName).toBe("John Smith");
    expect(insertOp!.values.context).toBe("client_create");
    expect(insertOp!.values.hitsFound).toBe(result.hits.length);
    expect(insertOp!.values.highestSeverity).toBe("HIGH");
    expect(Array.isArray(insertOp!.values.hits)).toBe(true);
    expect(inserted).toHaveLength(1);
  });

  it("returns no hits and writes a clean log when nothing matches", async () => {
    const queue: any[][] = [[], [], [], [], [], [], []];
    const { db, ops } = makeDb({ selectQueue: queue });

    const result = await runConflictCheck(
      db,
      "org-1",
      { name: "Totally Unique Name" },
      "user-1",
      "manual_check",
    );

    expect(result.hits).toHaveLength(0);
    expect(result.highestSeverity).toBeNull();
    const insertOp = ops.find((o) => o.kind === "insert");
    expect(insertOp!.values.hitsFound).toBe(0);
    expect(insertOp!.values.highestSeverity).toBeNull();
  });
});

describe("recordOverride", () => {
  it("requires clientId or caseId", async () => {
    const { db } = makeDb({ selectQueue: [] });
    await expect(
      recordOverride(db, "org-1", {
        logId: "log-1",
        reason: "ok",
        approvedBy: "user-1",
      }),
    ).rejects.toThrow();
  });

  it("inserts override and stamps the log with target id", async () => {
    const { db, ops } = makeDb({ selectQueue: [], insertReturnId: "ov-1" });
    const out = await recordOverride(db, "org-1", {
      logId: "log-1",
      clientId: "client-1",
      reason: "Informed waiver obtained",
      approvedBy: "user-1",
    });
    expect(out.id).toBe("ov-1");
    const insertOp = ops.find((o) => o.kind === "insert");
    expect(insertOp!.values.checkLogId).toBe("log-1");
    expect(insertOp!.values.clientId).toBe("client-1");
    expect(insertOp!.values.reason).toBe("Informed waiver obtained");
    const updateOp = ops.find((o) => o.kind === "update");
    expect(updateOp).toBeDefined();
    expect(updateOp!.set.resultedInCreation).toBe(true);
    expect(updateOp!.set.clientId).toBe("client-1");
  });
});

describe("attachLogTarget", () => {
  it("stamps the log row", async () => {
    const { db, ops } = makeDb({ selectQueue: [] });
    await attachLogTarget(db, "log-1", { caseId: "case-1" });
    const updateOp = ops.find((o) => o.kind === "update");
    expect(updateOp!.set.resultedInCreation).toBe(true);
    expect(updateOp!.set.caseId).toBe("case-1");
  });
});

describe("listLogs + getLog", () => {
  it("listLogs returns logs and total count", async () => {
    const fakeLogs = [{ id: "l1" }, { id: "l2" }];
    // First .from = logs query, second .from = count query
    const { db } = makeDb({ selectQueue: [fakeLogs, [{ count: 2 }]] });
    const out = await listLogs(db, "org-1", { limit: 10, offset: 0 });
    expect(out.logs).toEqual(fakeLogs);
    expect(out.total).toBe(2);
  });

  it("getLog returns log + override (if any)", async () => {
    const log = { id: "l1", orgId: "org-1" };
    const override = { id: "ov1", reason: "x" };
    const { db } = makeDb({ selectQueue: [[log], [override]] });
    const out = await getLog(db, "org-1", "l1");
    expect(out.log).toEqual(log);
    expect(out.override).toEqual(override);
  });

  it("getLog returns null log when not found", async () => {
    const { db } = makeDb({ selectQueue: [[]] });
    const out = await getLog(db, "org-1", "missing");
    expect(out.log).toBeNull();
    expect(out.override).toBeNull();
  });
});
