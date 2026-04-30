// tests/unit/out-of-office-service.test.ts
//
// Phase 3.14 — unit tests for the OOO service. Uses a chainable mock db that
// records each terminal operation.

import { describe, it, expect } from "vitest";
import {
  createOoo,
  cancelOoo,
  shouldRespondTo,
  recordAutoResponseSent,
  transitionStatus,
} from "@/server/services/out-of-office/service";

type Op = { kind: string; values?: any; set?: any };

function makeMockDb(opts: {
  selectRows?: any[][];
  returningRows?: any[][];
  insertThrows?: Error;
} = {}) {
  const ops: Op[] = [];
  const selectQueue = [...(opts.selectRows ?? [])];
  const returningQueue = [...(opts.returningRows ?? [])];

  function makeSelectChain(): any {
    const next = () => (selectQueue.length > 0 ? selectQueue.shift()! : []);
    let resolved: any[] | null = null;
    const chain: any = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      then: (resolve: any, reject: any) => {
        if (resolved == null) resolved = next();
        return Promise.resolve(resolved).then(resolve, reject);
      },
    };
    return chain;
  }

  const db: any = {
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        if (opts.insertThrows) throw opts.insertThrows;
        const builder: any = {
          returning: async () =>
            returningQueue.length > 0 ? returningQueue.shift()! : [{ id: "row-1", ...v }],
          then: (resolve: any) => Promise.resolve().then(() => resolve(undefined)),
        };
        return builder;
      },
    }),
    update: (_t: any) => ({
      set: (s: any) => {
        ops.push({ kind: "update", set: s });
        return {
          where: () => ({
            returning: async () =>
              returningQueue.length > 0 ? returningQueue.shift()! : [],
          }),
        };
      },
    }),
    select: (_cols?: any) => ({
      from: (_t: any) => makeSelectChain(),
    }),
  };

  return { db, ops };
}

describe("out-of-office service", () => {
  describe("createOoo", () => {
    it("persists with status='scheduled' when start date is in the future", async () => {
      const { db, ops } = makeMockDb({
        returningRows: [[{ id: "ooo-1", status: "scheduled" }]],
      });
      const asOf = new Date("2026-05-01T12:00:00Z");
      await createOoo(db, {
        userId: "u-1",
        orgId: "org-1",
        startDate: "2026-05-10",
        endDate: "2026-05-15",
        autoResponseBody: "body",
        asOf,
      });
      const insertOp = ops.find((o) => o.kind === "insert");
      expect(insertOp?.values.status).toBe("scheduled");
    });

    it("persists with status='active' when start date is today", async () => {
      const { db, ops } = makeMockDb({
        returningRows: [[{ id: "ooo-2", status: "active" }]],
      });
      const asOf = new Date("2026-05-10T08:00:00Z");
      await createOoo(db, {
        userId: "u-1",
        orgId: "org-1",
        startDate: "2026-05-10",
        endDate: "2026-05-15",
        autoResponseBody: "body",
        asOf,
      });
      const insertOp = ops.find((o) => o.kind === "insert");
      expect(insertOp?.values.status).toBe("active");
    });
  });

  describe("transitionStatus", () => {
    it("issues two updates: activate scheduled, then end past", async () => {
      const { db, ops } = makeMockDb({
        returningRows: [
          [{ id: "ooo-a" }], // activated
          [{ id: "ooo-b" }, { id: "ooo-c" }], // ended
        ],
      });
      const out = await transitionStatus(db, new Date("2026-06-01T12:00:00Z"));
      expect(out.activated).toBe(1);
      expect(out.ended).toBe(2);
      const updates = ops.filter((o) => o.kind === "update");
      expect(updates.length).toBe(2);
      expect(updates[0].set.status).toBe("active");
      expect(updates[1].set.status).toBe("ended");
    });
  });

  describe("shouldRespondTo", () => {
    it("returns true when no log row exists for recipient", async () => {
      const { db } = makeMockDb({ selectRows: [[]] });
      const ok = await shouldRespondTo(db, "ooo-1", "Foo@Example.com");
      expect(ok).toBe(true);
    });

    it("returns false (deduped) when log row exists for recipient", async () => {
      const { db } = makeMockDb({ selectRows: [[{ id: "log-1" }]] });
      const ok = await shouldRespondTo(db, "ooo-1", "foo@example.com");
      expect(ok).toBe(false);
    });
  });

  describe("recordAutoResponseSent", () => {
    it("inserts a log row with normalized lowercase email", async () => {
      const { db, ops } = makeMockDb();
      const out = await recordAutoResponseSent(db, {
        oooId: "ooo-1",
        replyId: "rep-1",
        recipientEmail: "  Bar@EXAMPLE.com  ",
        wasEmergency: false,
      });
      expect(out.inserted).toBe(true);
      const insertOp = ops.find((o) => o.kind === "insert");
      expect(insertOp?.values.recipientEmail).toBe("bar@example.com");
    });

    it("treats UNIQUE violation as not-inserted (no throw)", async () => {
      const err: any = new Error("duplicate key value violates unique constraint");
      err.code = "23505";
      const { db } = makeMockDb({ insertThrows: err });
      const out = await recordAutoResponseSent(db, {
        oooId: "ooo-1",
        replyId: null,
        recipientEmail: "x@y.z",
        wasEmergency: false,
      });
      expect(out.inserted).toBe(false);
    });
  });

  describe("cancelOoo", () => {
    it("flips status to 'cancelled'", async () => {
      const { db, ops } = makeMockDb({
        returningRows: [[{ id: "ooo-1", status: "cancelled" }]],
      });
      const row = await cancelOoo(db, "ooo-1", "u-1");
      expect(row?.status).toBe("cancelled");
      const updateOp = ops.find((o) => o.kind === "update");
      expect(updateOp?.set.status).toBe("cancelled");
    });

    it("returns null when no row matches user", async () => {
      const { db } = makeMockDb({ returningRows: [[]] });
      const row = await cancelOoo(db, "ooo-1", "u-1");
      expect(row).toBeNull();
    });
  });
});
