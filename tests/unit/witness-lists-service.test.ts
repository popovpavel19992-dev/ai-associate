// tests/unit/witness-lists-service.test.ts
//
// Unit tests for the witness-lists service. Hand-rolled mock db (same pattern
// as discovery-service.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createList,
  getNextListNumber,
  finalizeList,
  markServed,
  deleteList,
  updateListMeta,
  addWitness,
  reorderWitnesses,
} from "@/server/services/witness-lists/service";

type Op = { kind: string; values?: any; set?: any };

function makeMockDb(opts: {
  selectRows?: any[][];
  insertReturnId?: string;
} = {}) {
  const ops: Op[] = [];
  const selectQueue = [...(opts.selectRows ?? [])];

  const db: any = {
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        return {
          returning: async () => [{ id: opts.insertReturnId ?? "row-1" }],
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
    delete: (_t: any) => ({
      where: (_w: any) => {
        ops.push({ kind: "delete" });
        return Promise.resolve();
      },
    }),
    select: (_cols?: any) => ({
      from: (_t: any) => {
        const buildWhere = () => {
          const next = selectQueue.shift() ?? [];
          const chain: any = {
            limit: async (_n: number) => next,
            orderBy: (..._args: any[]) => ({
              limit: async (_n: number) => next,
              then: (resolve: any, reject: any) =>
                Promise.resolve(next).then(resolve, reject),
            }),
            then: (resolve: any, reject: any) =>
              Promise.resolve(next).then(resolve, reject),
          };
          return chain;
        };
        // Some service calls go .from(t) then directly .where (max aggregates).
        return {
          where: (_w: any) => buildWhere(),
          orderBy: (..._args: any[]) => ({
            then: (resolve: any, reject: any) =>
              Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
          }),
        };
      },
    }),
  };

  return { db, ops };
}

describe("witness-lists service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  describe("createList", () => {
    it("inserts with status='draft' and returns id", async () => {
      const { db, ops } = makeMockDb({ insertReturnId: "list-1" });
      const out = await createList(db, {
        orgId: "org-1",
        caseId: "case-1",
        servingParty: "plaintiff",
        listNumber: 1,
        title: "Plaintiff's Trial Witness List",
        createdBy: "user-1",
      });
      expect(out.id).toBe("list-1");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.status).toBe("draft");
      expect(ins.values.servingParty).toBe("plaintiff");
      expect(ins.values.listNumber).toBe(1);
    });
  });

  describe("getNextListNumber", () => {
    it("returns 1 when none exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: null }]] });
      const n = await getNextListNumber(db, "case-1", "plaintiff");
      expect(n).toBe(1);
    });
    it("returns max+1 when lists exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: 2 }]] });
      const n = await getNextListNumber(db, "case-1", "plaintiff");
      expect(n).toBe(3);
    });
  });

  describe("finalizeList", () => {
    it("throws when status != 'draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(finalizeList(db, "list-1")).rejects.toThrow(/draft/);
    });

    it("throws when there are zero witnesses", async () => {
      const { db } = makeMockDb({
        selectRows: [[{ status: "draft" }], []], // list row, then witnesses (empty)
      });
      await expect(finalizeList(db, "list-1")).rejects.toThrow(/no witnesses/);
    });

    it("transitions draft → final and stamps finalizedAt", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft" }], [{ id: "w-1" }]],
      });
      await finalizeList(db, "list-1");
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.status).toBe("final");
      expect(upd.set.finalizedAt).toBeInstanceOf(Date);
    });
  });

  describe("markServed", () => {
    it("throws when status != 'final'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await expect(markServed(db, "list-1", new Date())).rejects.toThrow(/finalized/);
    });
    it("transitions final → served", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      const at = new Date("2026-04-30T10:00:00.000Z");
      await markServed(db, "list-1", at);
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.status).toBe("served");
      expect(upd.set.servedAt).toBe(at);
    });
  });

  describe("deleteList", () => {
    it("blocks delete when status='served'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "served" }]] });
      await expect(deleteList(db, "list-1")).rejects.toThrow(/Served/);
    });
    it("hard-deletes when status='draft'", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await deleteList(db, "list-1");
      expect(ops.find((o) => o.kind === "delete")).toBeDefined();
    });
  });

  describe("updateListMeta", () => {
    it("only allowed when status='draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        updateListMeta(db, "list-1", { title: "x" }),
      ).rejects.toThrow(/draft/);
    });
  });

  describe("addWitness", () => {
    it("blocks when list is not 'draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        addWitness(db, "list-1", {
          category: "fact",
          partyAffiliation: "plaintiff",
          fullName: "Jane",
        }),
      ).rejects.toThrow(/draft/);
    });

    it("assigns next witness_order = max+1 across all categories", async () => {
      const { db, ops } = makeMockDb({
        // draft check, then max(witness_order) → 3
        selectRows: [[{ status: "draft" }], [{ maxN: 3 }]],
        insertReturnId: "w-new",
      });
      const out = await addWitness(db, "list-1", {
        category: "expert",
        partyAffiliation: "plaintiff",
        fullName: "Dr. Smith",
        titleOrRole: "Expert Engineer",
      });
      expect(out.id).toBe("w-new");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.witnessOrder).toBe(4);
      expect(ins.values.fullName).toBe("Dr. Smith");
      expect(ins.values.isWillCall).toBe(true);
    });
  });

  describe("reorderWitnesses", () => {
    it("issues two passes of updates (temp range, then final)", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await reorderWitnesses(db, "list-1", ["w-a", "w-b", "w-c"]);
      const updates = ops.filter((o) => o.kind === "update");
      expect(updates.length).toBe(6);
      // First pass = temp offsets > 5000.
      expect(updates[0].set.witnessOrder).toBeGreaterThan(5000);
      // Second pass = final positions 1..N.
      expect(updates[3].set.witnessOrder).toBe(1);
      expect(updates[4].set.witnessOrder).toBe(2);
      expect(updates[5].set.witnessOrder).toBe(3);
    });

    it("blocked when list is not draft", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        reorderWitnesses(db, "list-1", ["w-a", "w-b"]),
      ).rejects.toThrow(/draft/);
    });
  });
});
