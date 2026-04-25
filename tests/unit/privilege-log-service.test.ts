// tests/unit/privilege-log-service.test.ts
//
// Unit tests for the privilege log service. Hand-rolled mock db pattern
// matching discovery-service.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createEntry,
  getNextEntryNumber,
  updateEntry,
  deleteEntry,
  reorder,
  listForCase,
} from "@/server/services/privilege-log/service";

type Op = { kind: string; values?: any; set?: any; whereInfo?: any };

function makeMockDb(opts: {
  selectRows?: any[][];
  insertReturn?: { id: string; entryNumber: number };
} = {}) {
  const ops: Op[] = [];
  const selectQueue = [...(opts.selectRows ?? [])];

  const db: any = {
    insert: (_table: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        return {
          returning: async () => [
            {
              id: opts.insertReturn?.id ?? "entry-1",
              entryNumber: opts.insertReturn?.entryNumber ?? v.entryNumber,
            },
          ],
        };
      },
    }),
    update: (_table: any) => ({
      set: (s: any) => ({
        where: (_w: any) => {
          ops.push({ kind: "update", set: s });
          return Promise.resolve();
        },
      }),
    }),
    delete: (_table: any) => ({
      where: (_w: any) => {
        ops.push({ kind: "delete" });
        return Promise.resolve();
      },
    }),
    select: (_cols?: any) => ({
      from: (_table: any) => {
        const buildWhere = () => {
          const next = selectQueue.shift() ?? [];
          const orderByChain: any = {
            limit: async (_n: number) => next,
            then: (resolve: any, reject: any) =>
              Promise.resolve(next).then(resolve, reject),
          };
          const chain: any = {
            limit: async (_n: number) => next,
            orderBy: () => orderByChain,
            then: (resolve: any, reject: any) =>
              Promise.resolve(next).then(resolve, reject),
          };
          return chain;
        };
        return { where: (_w: any) => buildWhere() };
      },
    }),
  };

  return { db, ops };
}

describe("privilege log service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  describe("getNextEntryNumber", () => {
    it("returns 1 for an empty case", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: null }]] });
      const n = await getNextEntryNumber(db, "case-1");
      expect(n).toBe(1);
    });

    it("returns max+1 when entries already exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: 5 }]] });
      const n = await getNextEntryNumber(db, "case-1");
      expect(n).toBe(6);
    });
  });

  describe("createEntry", () => {
    it("auto-assigns entry_number when not provided", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ maxN: 2 }]],
        insertReturn: { id: "e-1", entryNumber: 3 },
      });
      const out = await createEntry(db, {
        orgId: "org-1",
        caseId: "case-1",
        privilegeBasis: "attorney_client",
        withheldBy: "plaintiff",
        createdBy: "user-1",
      });
      expect(out.entryNumber).toBe(3);
      const insert = ops.find((o) => o.kind === "insert")!;
      expect(insert.values.entryNumber).toBe(3);
      expect(insert.values.recipients).toEqual([]);
      expect(insert.values.cc).toEqual([]);
    });

    it("uses provided entry_number when given", async () => {
      const { db, ops } = makeMockDb({
        insertReturn: { id: "e-1", entryNumber: 42 },
      });
      await createEntry(db, {
        orgId: "org-1",
        caseId: "case-1",
        entryNumber: 42,
        privilegeBasis: "work_product",
        withheldBy: "defendant",
        createdBy: "user-1",
      });
      const insert = ops.find((o) => o.kind === "insert")!;
      expect(insert.values.entryNumber).toBe(42);
    });
  });

  describe("updateEntry", () => {
    it("validates entry_number uniqueness within case when renumbering", async () => {
      const { db } = makeMockDb({
        selectRows: [
          // existing row
          [{ id: "e-1", caseId: "case-1", entryNumber: 1 }],
          // conflict lookup — found
          [{ id: "e-other" }],
        ],
      });
      await expect(
        updateEntry(db, "e-1", { entryNumber: 2 }),
      ).rejects.toThrow(/already in use/);
    });

    it("allows renumbering when target slot is free", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [{ id: "e-1", caseId: "case-1", entryNumber: 1 }],
          [], // no conflict
        ],
      });
      await updateEntry(db, "e-1", { entryNumber: 7 });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.entryNumber).toBe(7);
    });

    it("throws NOT_FOUND when entry missing", async () => {
      const { db } = makeMockDb({ selectRows: [[]] });
      await expect(
        updateEntry(db, "missing", { author: "x" }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("deleteEntry", () => {
    it("hard-deletes WITHOUT renumbering subsequent entries (gaps OK per practice)", async () => {
      const { db, ops } = makeMockDb();
      await deleteEntry(db, "e-1");
      expect(ops.find((o) => o.kind === "delete")).toBeDefined();
      // No update operations should be issued — we deliberately leave a gap.
      expect(ops.filter((o) => o.kind === "update")).toHaveLength(0);
    });
  });

  describe("reorder", () => {
    it("issues 2N updates (scratch + final) for N ids", async () => {
      const { db, ops } = makeMockDb();
      await reorder(db, "case-1", ["a", "b", "c"]);
      const updates = ops.filter((o) => o.kind === "update");
      expect(updates).toHaveLength(6);
      // Final phase assigns 1..N.
      const finals = updates.slice(3).map((u) => u.set.entryNumber);
      expect(finals).toEqual([1, 2, 3]);
    });
  });

  describe("listForCase", () => {
    it("queries with caseId scope (cross-case scoping)", async () => {
      const { db } = makeMockDb({
        selectRows: [
          [
            { id: "e-1", caseId: "case-1", entryNumber: 1 },
            { id: "e-2", caseId: "case-1", entryNumber: 2 },
          ],
        ],
      });
      const rows = await listForCase(db, "case-1");
      expect(rows).toHaveLength(2);
      expect(rows.every((r: any) => r.caseId === "case-1")).toBe(true);
    });
  });
});
