// tests/unit/settlement-offers-service.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createOffer,
  getNextOfferNumber,
  updateOffer,
  recordResponse,
  deleteOffer,
} from "@/server/services/settlement/offers-service";

type Op = { kind: string; values?: any; set?: any };

function makeMockDb(opts: { selectRows?: any[][]; insertReturn?: any } = {}) {
  const ops: Op[] = [];
  const selectQueue = [...(opts.selectRows ?? [])];
  const db: any = {
    insert: () => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        return {
          returning: async () => [
            opts.insertReturn ?? { id: "row-1", offerNumber: 1 },
          ],
        };
      },
    }),
    update: () => ({
      set: (s: any) => ({
        where: () => {
          ops.push({ kind: "update", set: s });
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => {
        ops.push({ kind: "delete" });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
          orderBy: () => ({
            then: (resolve: any, reject: any) =>
              Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
            limit: async () => selectQueue.shift() ?? [],
          }),
          then: (resolve: any, reject: any) =>
            Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
        }),
        orderBy: () => ({
          then: (resolve: any, reject: any) =>
            Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
        }),
      }),
    }),
  };
  return { db, ops };
}

describe("settlement offers service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  describe("getNextOfferNumber", () => {
    it("returns 1 when none exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: null }]] });
      expect(await getNextOfferNumber(db, "case-1")).toBe(1);
    });
    it("returns max+1", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: 7 }]] });
      expect(await getNextOfferNumber(db, "case-1")).toBe(8);
    });
  });

  describe("createOffer", () => {
    it("auto-assigns offerNumber and inserts as pending", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ maxN: 0 }]],
        insertReturn: { id: "off-1", offerNumber: 1 },
      });
      const out = await createOffer(db, {
        orgId: "o",
        caseId: "c",
        amountCents: 5000_00,
        offerType: "counter_offer",
        fromParty: "defendant",
        createdBy: "u",
      });
      expect(out.offerNumber).toBe(1);
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.response).toBe("pending");
      expect(ins.values.offerType).toBe("counter_offer");
      expect(ins.values.amountCents).toBe(500000);
      expect(ins.values.currency).toBe("USD");
    });
  });

  describe("updateOffer", () => {
    it("rejects when response is not pending", async () => {
      const { db } = makeMockDb({ selectRows: [[{ response: "accepted" }]] });
      await expect(
        updateOffer(db, "off-1", { amountCents: 100 }),
      ).rejects.toThrow(/pending/);
    });
    it("applies patch when pending", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ response: "pending" }]],
      });
      await updateOffer(db, "off-1", { amountCents: 999, terms: "NDA" });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.amountCents).toBe(999);
      expect(upd.set.terms).toBe("NDA");
    });
  });

  describe("recordResponse", () => {
    it("transitions pending → accepted", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ response: "pending" }]],
      });
      await recordResponse(db, "off-1", { response: "accepted" });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.response).toBe("accepted");
      expect(upd.set.responseDate).toBeInstanceOf(Date);
    });
    it("blocks second response after first set", async () => {
      const { db } = makeMockDb({ selectRows: [[{ response: "rejected" }]] });
      await expect(
        recordResponse(db, "off-1", { response: "accepted" }),
      ).rejects.toThrow(/already recorded/);
    });
  });

  describe("deleteOffer", () => {
    it("hard-deletes when pending", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ response: "pending" }]],
      });
      await deleteOffer(db, "off-1");
      expect(ops.find((o) => o.kind === "delete")).toBeDefined();
    });
    it("blocks delete after response set", async () => {
      for (const r of ["accepted", "rejected", "expired", "withdrawn"]) {
        const { db } = makeMockDb({ selectRows: [[{ response: r }]] });
        await expect(deleteOffer(db, "off-1")).rejects.toThrow(/pending/);
      }
    });
  });
});
