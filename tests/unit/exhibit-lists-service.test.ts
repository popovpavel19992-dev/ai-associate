// tests/unit/exhibit-lists-service.test.ts
//
// Unit tests for the exhibit-lists service. Hand-rolled mock db (same pattern
// as witness-lists-service.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createList,
  getNextListNumber,
  finalizeList,
  markServed,
  deleteList,
  updateListMeta,
  addExhibit,
  reorderExhibits,
  updateAdmissionStatus,
} from "@/server/services/exhibit-lists/service";

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

describe("exhibit-lists service", () => {
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
        title: "Plaintiff's Trial Exhibit List",
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
      const n = await getNextListNumber(db, "case-1", "defendant");
      expect(n).toBe(3);
    });
  });

  describe("finalizeList", () => {
    it("throws when status != 'draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(finalizeList(db, "list-1")).rejects.toThrow(/draft/);
    });

    it("throws when there are zero exhibits", async () => {
      const { db } = makeMockDb({
        selectRows: [[{ status: "draft" }], []],
      });
      await expect(finalizeList(db, "list-1")).rejects.toThrow(/no exhibits/);
    });

    it("transitions draft → final and stamps finalizedAt", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft" }], [{ id: "e-1" }]],
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

  describe("addExhibit", () => {
    it("blocks when list is not 'draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        addExhibit(db, "list-1", { description: "Doc A" }),
      ).rejects.toThrow(/draft/);
    });

    it("auto-assigns exhibit_order=1 and label P-1 for plaintiff", async () => {
      const { db, ops } = makeMockDb({
        // requireDraft → list row, then max(order)
        selectRows: [
          [{ status: "draft", servingParty: "plaintiff" }],
          [{ maxN: null }],
        ],
        insertReturnId: "ex-1",
      });
      const out = await addExhibit(db, "list-1", {
        description: "Mercy Hospital records",
      });
      expect(out.id).toBe("ex-1");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.exhibitOrder).toBe(1);
      expect(ins.values.exhibitLabel).toBe("P-1");
      expect(ins.values.admissionStatus).toBe("proposed");
      expect(ins.values.docType).toBe("document");
    });

    it("auto-assigns label D-3 for defendant when 2 already exist", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [{ status: "draft", servingParty: "defendant" }],
          [{ maxN: 2 }],
        ],
        insertReturnId: "ex-3",
      });
      await addExhibit(db, "list-1", { description: "Defendant photo" });
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.exhibitOrder).toBe(3);
      expect(ins.values.exhibitLabel).toBe("D-3");
    });
  });

  describe("updateAdmissionStatus", () => {
    it("works even when list is served (live trial mode)", async () => {
      // exhibit row, then list row (not consulted because we don't requireDraft).
      const { db, ops } = makeMockDb({
        selectRows: [[{ id: "ex-1", listId: "list-1" }]],
      });
      await updateAdmissionStatus(db, "ex-1", "admitted");
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.admissionStatus).toBe("admitted");
    });
  });

  describe("reorderExhibits", () => {
    it("issues two passes: temp range, then final order + label re-flow", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft", servingParty: "plaintiff" }]],
      });
      await reorderExhibits(db, "list-1", ["e-a", "e-b", "e-c"]);
      const updates = ops.filter((o) => o.kind === "update");
      expect(updates.length).toBe(6);
      // Pass 1: temp offsets > 5000.
      expect(updates[0].set.exhibitOrder).toBeGreaterThan(5000);
      expect(updates[0].set.exhibitLabel).toMatch(/^__TMP-/);
      // Pass 2: final order + re-derived plaintiff labels P-1..P-3.
      expect(updates[3].set.exhibitOrder).toBe(1);
      expect(updates[3].set.exhibitLabel).toBe("P-1");
      expect(updates[4].set.exhibitLabel).toBe("P-2");
      expect(updates[5].set.exhibitLabel).toBe("P-3");
    });

    it("re-derives D- labels for defendant lists", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft", servingParty: "defendant" }]],
      });
      await reorderExhibits(db, "list-1", ["e-a", "e-b"]);
      const updates = ops.filter((o) => o.kind === "update");
      expect(updates[2].set.exhibitLabel).toBe("D-1");
      expect(updates[3].set.exhibitLabel).toBe("D-2");
    });

    it("blocked when list is not draft", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        reorderExhibits(db, "list-1", ["e-a", "e-b"]),
      ).rejects.toThrow(/draft/);
    });
  });
});
