// tests/unit/trust-reconciliation-service.test.ts
//
// Phase 3.8 — Unit tests for monthly three-way reconciliation.

import { describe, it, expect } from "vitest";
import {
  recordReconciliation,
  previewReconciliation,
  listReconciliations,
} from "@/server/services/trust-accounting/reconciliation-service";

function makeDb(opts: {
  selectQueue: any[][];
  insertIds?: string[];
}) {
  const queue = [...opts.selectQueue];
  const idQ = [...(opts.insertIds ?? [])];
  const inserted: any[] = [];
  const db: any = {
    select: (_cols?: any) => {
      const rows = queue.shift() ?? [];
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: (_n: number) => Promise.resolve(rows),
        then: (resolve: any, reject: any) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
    insert: () => ({
      values: (v: any) => {
        inserted.push(v);
        return {
          returning: async () => [{ id: idQ.shift() ?? `rec-${inserted.length}` }],
        };
      },
    }),
  };
  return { db, inserted };
}

describe("recordReconciliation", () => {
  it("status='matched' when bank == book == ledger", async () => {
    // recordReconciliation: bookBalanceThrough does select(beginning) [limit] then select(txns).
    // Then clientLedgerSumThrough does another select(txns). Then insert.
    const txns = [
      { clientId: "c-1", transactionType: "deposit", amountCents: 5_000 },
      { clientId: "c-1", transactionType: "disbursement", amountCents: 2_000 },
    ];
    // book = 0 + 5000 - 2000 = 3000; client ledger sum = 3000.
    const { db, inserted } = makeDb({
      selectQueue: [
        [{ beginningBalanceCents: 0 }], // book — beginning
        txns, // book — txns
        txns, // ledger — txns
      ],
      insertIds: ["rec-1"],
    });
    const out = await recordReconciliation(db, {
      orgId: "o",
      accountId: "a",
      periodMonth: new Date(Date.UTC(2026, 3, 1)),
      bankStatementBalanceCents: 3_000,
      reconciledBy: "u",
    });
    expect(out.status).toBe("matched");
    expect(inserted[0].status).toBe("matched");
    expect(inserted[0].bookBalanceCents).toBe(3_000);
    expect(inserted[0].clientLedgerSumCents).toBe(3_000);
  });

  it("status='discrepancy' when bank does not match book", async () => {
    const txns = [{ clientId: "c-1", transactionType: "deposit", amountCents: 5_000 }];
    const { db, inserted } = makeDb({
      selectQueue: [
        [{ beginningBalanceCents: 0 }],
        txns,
        txns,
      ],
      insertIds: ["rec-2"],
    });
    const out = await recordReconciliation(db, {
      orgId: "o",
      accountId: "a",
      periodMonth: new Date(Date.UTC(2026, 3, 1)),
      bankStatementBalanceCents: 4_900, // off by $1
      reconciledBy: "u",
    });
    expect(out.status).toBe("discrepancy");
    expect(inserted[0].status).toBe("discrepancy");
  });

  it("status='discrepancy' when book matches bank but ledger sum differs", async () => {
    // book includes a null-client txn (e.g. service charge) that doesn't count
    // toward the client ledger sum.
    const bookTxns = [
      { clientId: "c-1", transactionType: "deposit", amountCents: 5_000 },
      { clientId: null, transactionType: "service_charge", amountCents: 100 },
    ];
    const { db, inserted } = makeDb({
      selectQueue: [
        [{ beginningBalanceCents: 0 }],
        bookTxns, // book = 4900
        bookTxns, // ledger = 5000 (null excluded)
      ],
      insertIds: ["rec-3"],
    });
    const out = await recordReconciliation(db, {
      orgId: "o",
      accountId: "a",
      periodMonth: new Date(Date.UTC(2026, 3, 1)),
      bankStatementBalanceCents: 4_900,
      reconciledBy: "u",
    });
    expect(out.status).toBe("discrepancy");
    expect(inserted[0].bookBalanceCents).toBe(4_900);
    expect(inserted[0].clientLedgerSumCents).toBe(5_000);
  });
});

describe("previewReconciliation", () => {
  it("returns computed numbers without inserting", async () => {
    const txns = [{ clientId: "c-1", transactionType: "deposit", amountCents: 5_000 }];
    const { db, inserted } = makeDb({
      selectQueue: [[{ beginningBalanceCents: 0 }], txns, txns],
    });
    const r = await previewReconciliation(db, {
      accountId: "a",
      periodMonth: new Date(Date.UTC(2026, 3, 1)),
      bankStatementBalanceCents: 5_000,
    });
    expect(r.bookBalanceCents).toBe(5_000);
    expect(r.clientLedgerSumCents).toBe(5_000);
    expect(r.status).toBe("matched");
    expect(inserted).toHaveLength(0);
  });
});

describe("listReconciliations", () => {
  it("returns rows DESC by period", async () => {
    const rows = [
      { id: "a", periodMonth: new Date("2026-04-01") },
      { id: "b", periodMonth: new Date("2026-03-01") },
    ];
    const { db } = makeDb({ selectQueue: [rows] });
    const r = await listReconciliations(db, "acc-1");
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe("a");
  });
});
