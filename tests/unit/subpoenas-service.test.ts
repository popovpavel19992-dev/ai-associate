// tests/unit/subpoenas-service.test.ts
//
// Unit tests for the FRCP 45 subpoenas service. Hand-rolled mock db
// (same pattern as motions-in-limine-service.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSubpoena,
  getNextSubpoenaNumber,
  updateSubpoena,
  markIssued,
  markServed,
  markComplied,
  markObjected,
  markQuashed,
  deleteSubpoena,
} from "@/server/services/subpoenas/service";

type Op = { kind: string; values?: any; set?: any };

function makeMockDb(opts: { selectRows?: any[][]; insertReturn?: any } = {}) {
  const ops: Op[] = [];
  const selectQueue = [...(opts.selectRows ?? [])];

  const db: any = {
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        return {
          returning: async () => [
            opts.insertReturn ?? { id: "row-1", subpoenaNumber: 1 },
          ],
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

describe("subpoenas service (FRCP 45)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  describe("getNextSubpoenaNumber", () => {
    it("returns 1 when none exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: null }]] });
      const n = await getNextSubpoenaNumber(db, "case-1");
      expect(n).toBe(1);
    });
    it("returns max+1 when subpoenas exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: 4 }]] });
      const n = await getNextSubpoenaNumber(db, "case-1");
      expect(n).toBe(5);
    });
  });

  describe("createSubpoena", () => {
    it("auto-assigns subpoenaNumber and inserts as draft", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ maxN: 2 }]],
        insertReturn: { id: "sp-1", subpoenaNumber: 3 },
      });
      const out = await createSubpoena(db, {
        orgId: "org-1",
        caseId: "case-1",
        subpoenaType: "documents",
        issuingParty: "plaintiff",
        recipientName: "Acme Bank",
        createdBy: "user-1",
      });
      expect(out.id).toBe("sp-1");
      expect(out.subpoenaNumber).toBe(3);
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.status).toBe("draft");
      expect(ins.values.subpoenaNumber).toBe(3);
      expect(ins.values.subpoenaType).toBe("documents");
      expect(ins.values.documentsRequested).toEqual([]);
    });
  });

  describe("updateSubpoena", () => {
    it("only allowed when status='draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "issued" }]] });
      await expect(
        updateSubpoena(db, "sp-1", { recipientName: "x" }),
      ).rejects.toThrow(/draft/);
    });
    it("applies patch when draft", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await updateSubpoena(db, "sp-1", {
        recipientName: "New Name",
        documentsRequested: ["a", "b"],
      });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.recipientName).toBe("New Name");
      expect(upd.set.documentsRequested).toEqual(["a", "b"]);
    });
  });

  describe("markIssued", () => {
    it("flips draft → issued and stamps date_issued", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await markIssued(db, "sp-1", "2026-04-25");
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.status).toBe("issued");
      expect(upd.set.dateIssued).toBe("2026-04-25");
    });
    it("rejects non-draft", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "served" }]] });
      await expect(markIssued(db, "sp-1", "2026-04-25")).rejects.toThrow(/draft/);
    });
  });

  describe("markServed", () => {
    it("flips issued → served and persists service info", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "issued" }]] });
      const at = new Date("2026-04-26T10:00:00.000Z");
      await markServed(db, "sp-1", {
        servedAt: at,
        servedByName: "John Doe",
        servedMethod: "process_server",
      });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.status).toBe("served");
      expect(upd.set.servedAt).toBe(at);
      expect(upd.set.servedByName).toBe("John Doe");
      expect(upd.set.servedMethod).toBe("process_server");
    });
    it("rejects when not 'issued' (e.g. still draft)", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await expect(
        markServed(db, "sp-1", {
          servedAt: new Date(),
          servedByName: "X",
          servedMethod: "personal",
        }),
      ).rejects.toThrow(/issued/);
    });
  });

  describe("terminal transitions from served", () => {
    it("served → complied", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "served" }]] });
      await markComplied(db, "sp-1");
      expect(
        ops.find((o) => o.kind === "update")!.set.status,
      ).toBe("complied");
    });
    it("served → objected", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "served" }]] });
      await markObjected(db, "sp-1");
      expect(
        ops.find((o) => o.kind === "update")!.set.status,
      ).toBe("objected");
    });
    it("served → quashed", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "served" }]] });
      await markQuashed(db, "sp-1");
      expect(
        ops.find((o) => o.kind === "update")!.set.status,
      ).toBe("quashed");
    });
    it("rejects markComplied when status !== 'served' (e.g. still draft)", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await expect(markComplied(db, "sp-1")).rejects.toThrow(/served/);
    });
  });

  describe("deleteSubpoena", () => {
    it("hard-deletes when draft", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await deleteSubpoena(db, "sp-1");
      expect(ops.find((o) => o.kind === "delete")).toBeDefined();
    });
    it("blocks delete after issuance (audit trail)", async () => {
      for (const status of ["issued", "served", "complied", "objected", "quashed"]) {
        const { db } = makeMockDb({ selectRows: [[{ status }]] });
        await expect(deleteSubpoena(db, "sp-1")).rejects.toThrow(/draft/);
      }
    });
  });
});
