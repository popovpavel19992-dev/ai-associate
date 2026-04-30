// tests/unit/bulk-operations-service.test.ts
//
// Phase 3.15 — Unit tests for the bulk operations service.
//
// Hand-rolled mock db with:
//   * a FIFO queue of select results (one per .from(...) call)
//   * an op log capturing inserts/updates so we can assert on side-effects
//   * a transaction wrapper that simply calls the callback with the same db
//   * insert(...).returning() responds with synthesized log/insert ids

import { describe, it, expect } from "vitest";
import {
  bulkArchive,
  bulkReassignLead,
  bulkExportCsv,
  listLogs,
  csvEscape,
} from "@/server/services/bulk-operations/service";

type Op = { kind: "insert" | "update"; values?: any; set?: any };

function makeDb(opts: {
  selectQueue: any[][];
  insertReturnIds?: string[];
  txThrows?: Error;
}) {
  const queue = [...opts.selectQueue];
  const insertIds = [...(opts.insertReturnIds ?? [])];
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
          returning: (_cols?: any) => {
            const id = insertIds.shift() ?? "log-1";
            return Promise.resolve([{ id }]);
          },
          then: (resolve: any, reject: any) =>
            Promise.resolve(undefined).then(resolve, reject),
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
    transaction: async (fn: (tx: any) => any) => {
      if (opts.txThrows) throw opts.txThrows;
      return await fn(db);
    },
  };

  return { db, ops, inserted };
}

describe("csvEscape", () => {
  it("returns empty for null/undefined", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });
  it("does not quote simple values", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
  });
  it("quotes values containing comma, quote, CR, LF (RFC 4180)", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
});

describe("bulkArchive", () => {
  it("sets deleteAt + logs row + returns count", async () => {
    const caseIds = ["c1", "c2", "c3"];
    // selectQueue: 1) validation select returning all 3
    const { db, ops, inserted } = makeDb({
      selectQueue: [caseIds.map((id) => ({ id }))],
      insertReturnIds: ["log-archive-1"],
    });

    const result = await bulkArchive(db, {
      orgId: "org-1",
      caseIds,
      performedBy: "user-1",
    });

    expect(result.archived).toBe(3);
    expect(result.logId).toBe("log-archive-1");

    // First op: update cases.deleteAt
    expect(ops[0].kind).toBe("update");
    expect(ops[0].set.deleteAt).toBeInstanceOf(Date);

    // Second op: insert into bulk_action_logs
    expect(ops[1].kind).toBe("insert");
    expect(inserted[0].actionType).toBe("archive");
    expect(inserted[0].targetCount).toBe(3);
    expect(inserted[0].targetCaseIds).toEqual(caseIds);
    expect(inserted[0].orgId).toBe("org-1");
    expect(inserted[0].performedBy).toBe("user-1");

    // deleteAt is ~30 days out
    const deleteAt: Date = ops[0].set.deleteAt;
    const days = (deleteAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("rejects caseIds that don't all belong to org", async () => {
    const caseIds = ["c1", "c2", "c3"];
    const { db } = makeDb({
      // validation returns only 2 of 3 — one missing → cross-org
      selectQueue: [[{ id: "c1" }, { id: "c2" }]],
    });

    await expect(
      bulkArchive(db, { orgId: "org-1", caseIds, performedBy: "u" }),
    ).rejects.toThrow(/do not belong/i);
  });

  it("throws on empty caseIds", async () => {
    const { db } = makeDb({ selectQueue: [] });
    await expect(
      bulkArchive(db, { orgId: "o", caseIds: [], performedBy: "u" }),
    ).rejects.toThrow();
  });
});

describe("bulkReassignLead", () => {
  it("validates new lead is org member; rolls back on failure", async () => {
    const caseIds = ["c1", "c2"];
    // selectQueue:
    //   1) cases validation: both rows
    //   2) users membership lookup: empty (NOT a member)
    const { db, ops } = makeDb({
      selectQueue: [caseIds.map((id) => ({ id })), []],
    });

    await expect(
      bulkReassignLead(db, {
        orgId: "org-1",
        caseIds,
        newLeadUserId: "intruder",
        performedBy: "u",
      }),
    ).rejects.toThrow(/not a member/i);

    // Should not have updated anything (no update ops before the throw).
    expect(ops.find((o) => o.kind === "update")).toBeUndefined();
  });

  it("succeeds: updates cases.userId, demotes existing leads, upserts lead member, logs", async () => {
    const caseIds = ["c1", "c2"];
    // selectQueue:
    //   1) cases validation
    //   2) new-lead user lookup (member)
    //   3) caseMembers lookup for c1 — empty → insert new row
    //   4) caseMembers lookup for c2 — already exists → update to lead
    const { db, ops, inserted } = makeDb({
      selectQueue: [
        caseIds.map((id) => ({ id })),
        [{ id: "lead-1", name: "Pat", email: "pat@x.com" }],
        [], // c1 no row
        [{ id: "cm-row-2" }], // c2 has row
      ],
      insertReturnIds: ["log-reassign-1"],
    });

    const result = await bulkReassignLead(db, {
      orgId: "org-1",
      caseIds,
      newLeadUserId: "lead-1",
      performedBy: "actor",
    });

    expect(result.reassigned).toBe(2);
    expect(result.logId).toBe("log-reassign-1");

    const updates = ops.filter((o) => o.kind === "update");
    // 1 cases update + 1 demote update + 1 case_members update for c2
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates[0].set.userId).toBe("lead-1");

    const inserts = ops.filter((o) => o.kind === "insert");
    // c1 got a new case_members insert + bulk_action_logs insert
    expect(inserts.length).toBe(2);
    const caseMemberInsert = inserted.find((v) => v.role === "lead");
    expect(caseMemberInsert).toBeDefined();
    expect(caseMemberInsert.userId).toBe("lead-1");

    const logInsert = inserted.find((v) => v.actionType === "reassign_lead");
    expect(logInsert).toBeDefined();
    expect(logInsert.targetCount).toBe(2);
  });

  it("rejects when caseIds span multiple orgs", async () => {
    const caseIds = ["c1", "c2"];
    const { db } = makeDb({
      selectQueue: [[{ id: "c1" }]], // only 1 of 2 belongs
    });
    await expect(
      bulkReassignLead(db, {
        orgId: "org-1",
        caseIds,
        newLeadUserId: "u",
        performedBy: "a",
      }),
    ).rejects.toThrow(/do not belong/i);
  });
});

describe("bulkExportCsv", () => {
  it("produces RFC 4180-compliant output (quotes, commas, newlines)", async () => {
    const caseIds = ["c1", "c2"];
    // selectQueue: one big join
    const { db } = makeDb({
      selectQueue: [
        [
          {
            id: "c1",
            name: "Smith, John v. Acme",
            status: "draft",
            detectedCaseType: "personal_injury",
            overrideCaseType: null,
            opposingParty: 'Acme "Inc"',
            jurisdictionOverride: "FEDERAL",
            createdAt: new Date("2025-01-15T10:00:00Z"),
            updatedAt: new Date("2025-02-01T10:00:00Z"),
            clientDisplayName: "John Smith",
            stageName: "Intake",
            leadName: "Pat Lawyer",
            leadEmail: "pat@x.com",
          },
          {
            id: "c2",
            name: "Multi\nLine\nName",
            status: "ready",
            detectedCaseType: null,
            overrideCaseType: "contract_dispute",
            opposingParty: null,
            jurisdictionOverride: "CA",
            createdAt: new Date("2025-03-01T10:00:00Z"),
            updatedAt: new Date("2025-03-02T10:00:00Z"),
            clientDisplayName: "Globex",
            stageName: null,
            leadName: null,
            leadEmail: "x@x.com",
          },
        ],
      ],
      insertReturnIds: ["log-export-1"],
    });

    const result = await bulkExportCsv(db, {
      orgId: "org-1",
      caseIds,
      performedBy: "u",
    });

    expect(result.logId).toBe("log-export-1");
    const csv = result.csvText;

    // Header line
    expect(csv.startsWith("id,name,client_name,case_type,stage_name,status,lead_attorney_name,opposing_party,created_at,updated_at,jurisdiction\r\n")).toBe(true);

    // Case 1: name has a comma → must be quoted
    expect(csv).toContain('"Smith, John v. Acme"');
    // Case 1: opposingParty has internal quotes → quotes doubled
    expect(csv).toContain('"Acme ""Inc"""');

    // Case 2: name has newlines → must be quoted, internal LF preserved
    expect(csv).toContain('"Multi\nLine\nName"');

    // Case 2: caseType comes from override
    expect(csv).toContain("contract_dispute");

    // CRLF terminators throughout
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(3); // header + 2 rows (newlines inside quoted cells stay attached)
  });

  it("rejects on org mismatch", async () => {
    const { db } = makeDb({
      selectQueue: [
        [
          // only one row for two requested ids
          {
            id: "c1",
            name: "x",
            status: "draft",
            detectedCaseType: null,
            overrideCaseType: null,
            opposingParty: null,
            jurisdictionOverride: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            clientDisplayName: null,
            stageName: null,
            leadName: null,
            leadEmail: null,
          },
        ],
      ],
    });
    await expect(
      bulkExportCsv(db, {
        orgId: "o",
        caseIds: ["c1", "c2"],
        performedBy: "u",
      }),
    ).rejects.toThrow(/do not belong/i);
  });
});

describe("listLogs", () => {
  it("returns rows ordered DESC by performedAt (mock just passes through)", async () => {
    const rows = [
      {
        id: "l1",
        orgId: "o",
        performedBy: "u1",
        actionType: "archive",
        targetCaseIds: ["c1"],
        targetCount: 1,
        parameters: {},
        summary: "x",
        performedAt: new Date("2025-04-01T10:00:00Z"),
        performedByName: "Alice",
      },
      {
        id: "l2",
        orgId: "o",
        performedBy: "u2",
        actionType: "export_csv",
        targetCaseIds: ["c2"],
        targetCount: 1,
        parameters: {},
        summary: "y",
        performedAt: new Date("2025-03-01T10:00:00Z"),
        performedByName: "Bob",
      },
    ];
    const { db } = makeDb({ selectQueue: [rows] });
    const result = await listLogs(db, "o");
    expect(result.logs).toEqual(rows);
  });
});
