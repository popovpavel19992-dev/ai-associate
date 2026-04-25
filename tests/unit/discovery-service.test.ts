// tests/unit/discovery-service.test.ts
//
// Unit tests for the discovery service. We use a hand-rolled mock db so the
// suite stays fast and works without Postgres — the same pattern used in
// `drip-sequences-service.test.ts`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createDiscoveryRequest,
  getNextSetNumber,
  finalizeDiscoveryRequest,
  markServed,
  deleteDiscoveryRequest,
  updateDiscoveryRequest,
} from "@/server/services/discovery/service";

type Op = { kind: string; values?: any; set?: any };

function makeMockDb(opts: {
  selectRows?: any[][]; // queue of select results
  insertReturnId?: string;
  maxSet?: number | null;
} = {}) {
  const ops: Op[] = [];
  const selectQueue = [...(opts.selectRows ?? [])];

  const db: any = {
    insert: (_table: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        return {
          returning: async () => [{ id: opts.insertReturnId ?? "req-1" }],
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
        // Two select shapes used by the service:
        //   .where(...).limit(n)   → row lookups
        //   .where(...)            → aggregate (max) reads, awaitable directly
        const buildWhere = () => {
          const next = selectQueue.shift() ?? [];
          const chain: any = {
            limit: async (_n: number) => next,
            orderBy: () => ({ limit: async (_n: number) => next }),
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

describe("discovery service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  describe("createDiscoveryRequest", () => {
    it("renumbers questions sequentially starting at 1", async () => {
      const { db, ops } = makeMockDb({ insertReturnId: "req-1" });
      const out = await createDiscoveryRequest(db, {
        orgId: "org-1",
        caseId: "case-1",
        servingParty: "plaintiff",
        setNumber: 1,
        title: "First Set",
        templateSource: "library",
        questions: [
          { number: 999, text: "Q1", source: "library" },
          { number: 7, text: "Q2", source: "ai" },
          { number: 3, text: "Q3", source: "manual" },
        ],
        createdBy: "user-1",
      });
      expect(out.id).toBe("req-1");
      const insert = ops.find((o) => o.kind === "insert")!;
      expect(insert.values.questions.map((q: any) => q.number)).toEqual([1, 2, 3]);
      expect(insert.values.status).toBe("draft");
      expect(insert.values.requestType).toBe("interrogatories");
    });

    it("persists with status='draft' and templateSource passed through", async () => {
      const { db, ops } = makeMockDb({ insertReturnId: "req-1" });
      await createDiscoveryRequest(db, {
        orgId: "org-1",
        caseId: "case-1",
        servingParty: "defendant",
        setNumber: 2,
        title: "AI-generated",
        templateSource: "ai",
        questions: [{ number: 1, text: "Q", source: "ai" }],
        createdBy: "user-1",
      });
      const insert = ops.find((o) => o.kind === "insert")!;
      expect(insert.values.templateSource).toBe("ai");
      expect(insert.values.servingParty).toBe("defendant");
    });
  });

  describe("getNextSetNumber", () => {
    it("returns 1 for an empty case", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxSet: null }]] });
      const n = await getNextSetNumber(db, "case-1", "interrogatories");
      expect(n).toBe(1);
    });

    it("returns max+1 when sets already exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxSet: 1 }]] });
      const n = await getNextSetNumber(db, "case-1", "interrogatories");
      expect(n).toBe(2);
    });
  });

  describe("finalizeDiscoveryRequest", () => {
    it("throws when count > 25 (FRCP 33 cap)", async () => {
      const tooMany = Array.from({ length: 26 }, (_, i) => ({ number: i + 1, text: `Q${i + 1}` }));
      const { db } = makeMockDb({
        selectRows: [[{ status: "draft", requestType: "interrogatories", questions: tooMany }]],
      });
      await expect(
        finalizeDiscoveryRequest(db, "req-1"),
      ).rejects.toThrow(/Federal cap exceeded/);
    });

    it("does NOT block RFP finalize when count > 25 (no FRCP 34 cap)", async () => {
      const many = Array.from({ length: 40 }, (_, i) => ({ number: i + 1, text: `R${i + 1}` }));
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft", requestType: "rfp", questions: many }]],
      });
      await finalizeDiscoveryRequest(db, "req-1");
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.status).toBe("final");
    });

    it("throws when status is not 'draft'", async () => {
      const { db } = makeMockDb({
        selectRows: [[{ status: "final", questions: [] }]],
      });
      await expect(finalizeDiscoveryRequest(db, "req-1")).rejects.toThrow(/draft/);
    });

    it("transitions draft → final and sets finalizedAt", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft", questions: [{ number: 1, text: "Q" }] }]],
      });
      await finalizeDiscoveryRequest(db, "req-1");
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.status).toBe("final");
      expect(upd.set.finalizedAt).toBeInstanceOf(Date);
    });
  });

  describe("markServed", () => {
    it("throws when status is not 'final'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await expect(
        markServed(db, "req-1", new Date()),
      ).rejects.toThrow(/finalized/);
    });

    it("transitions final → served", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      const served = new Date("2026-04-25T10:00:00.000Z");
      await markServed(db, "req-1", served);
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.status).toBe("served");
      expect(upd.set.servedAt).toBe(served);
    });
  });

  describe("deleteDiscoveryRequest", () => {
    it("throws when status='served' (audit trail)", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "served" }]] });
      await expect(deleteDiscoveryRequest(db, "req-1")).rejects.toThrow(/Served/);
    });

    it("hard-deletes drafts", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await deleteDiscoveryRequest(db, "req-1");
      expect(ops.find((o) => o.kind === "delete")).toBeDefined();
    });
  });

  describe("updateDiscoveryRequest", () => {
    it("only allowed when status='draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        updateDiscoveryRequest(db, "req-1", { title: "x" }),
      ).rejects.toThrow(/draft/);
    });

    it("renumbers questions when patching", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await updateDiscoveryRequest(db, "req-1", {
        questions: [
          { number: 50, text: "A" },
          { number: 99, text: "B" },
        ],
      });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.questions.map((q: any) => q.number)).toEqual([1, 2]);
    });
  });
});
