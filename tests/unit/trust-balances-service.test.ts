// tests/unit/trust-balances-service.test.ts
//
// Phase 3.8 — Unit tests for trust balance computation.
// Each select() call dequeues the next response from a FIFO queue.

import { describe, it, expect } from "vitest";
import {
  applyTxn,
  isPositive,
  getAccountBalance,
  getClientBalance,
  getAllClientBalances,
  getClientLedgerSum,
} from "@/server/services/trust-accounting/balances-service";

function makeDb(selectQueue: any[][]) {
  const queue = [...selectQueue];
  const db: any = {
    select: (_cols?: any) => {
      const rows = queue.shift() ?? [];
      const chain: any = {
        from: (_t: any) => chain,
        where: (_w: any) => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        orderBy: () => chain,
        limit: (_n: number) => Promise.resolve(rows),
        then: (resolve: any, reject: any) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
  };
  return db;
}

describe("trust balances helpers", () => {
  it("isPositive classifies types correctly", () => {
    expect(isPositive("deposit")).toBe(true);
    expect(isPositive("interest")).toBe(true);
    expect(isPositive("adjustment")).toBe(true);
    expect(isPositive("disbursement")).toBe(false);
    expect(isPositive("transfer")).toBe(false);
    expect(isPositive("service_charge")).toBe(false);
  });

  it("applyTxn adds for positive types and subtracts for negative", () => {
    expect(applyTxn(0, { transactionType: "deposit", amountCents: 100 })).toBe(100);
    expect(applyTxn(500, { transactionType: "disbursement", amountCents: 200 })).toBe(300);
    expect(applyTxn(0, { transactionType: "interest", amountCents: 50 })).toBe(50);
    expect(applyTxn(0, { transactionType: "service_charge", amountCents: 25 })).toBe(-25);
  });
});

describe("getAccountBalance", () => {
  it("sums beginning + deposits − disbursements", async () => {
    const db = makeDb([
      // 1: beginning balance lookup
      [{ beginningBalanceCents: 10_000 }],
      // 2: txn rows
      [
        { transactionType: "deposit", amountCents: 5_000 },
        { transactionType: "disbursement", amountCents: 2_000 },
        { transactionType: "interest", amountCents: 100 },
        { transactionType: "service_charge", amountCents: 50 },
      ],
    ]);
    const r = await getAccountBalance(db, "acc-1");
    expect(r.balanceCents).toBe(10_000 + 5_000 - 2_000 + 100 - 50);
  });

  it("returns beginning when no transactions", async () => {
    const db = makeDb([[{ beginningBalanceCents: 1_500 }], []]);
    const r = await getAccountBalance(db, "acc-1");
    expect(r.balanceCents).toBe(1_500);
  });
});

describe("getClientBalance", () => {
  it("sums only the requested client's transactions", async () => {
    const db = makeDb([
      [
        { transactionType: "deposit", amountCents: 5_000, clientId: "c-1" },
        { transactionType: "disbursement", amountCents: 1_500, clientId: "c-1" },
      ],
    ]);
    const r = await getClientBalance(db, "acc-1", "c-1");
    expect(r.balanceCents).toBe(3_500);
  });

  it("returns zero when no transactions", async () => {
    const db = makeDb([[]]);
    const r = await getClientBalance(db, "acc-1", "c-1");
    expect(r.balanceCents).toBe(0);
  });
});

describe("getAllClientBalances + getClientLedgerSum", () => {
  it("groups by client and excludes zero balances; ledger sum excludes nulls", async () => {
    // First: txns. Second: client lookup.
    const txns = [
      { clientId: "c-1", transactionType: "deposit", amountCents: 10_000 },
      { clientId: "c-1", transactionType: "disbursement", amountCents: 4_000 },
      { clientId: "c-2", transactionType: "deposit", amountCents: 2_000 },
      { clientId: null, transactionType: "interest", amountCents: 25 },
    ];
    const clientRows = [
      { id: "c-1", displayName: "Acme Co." },
      { id: "c-2", displayName: "Beta LLC" },
    ];
    const db = makeDb([txns, clientRows]);
    const balances = await getAllClientBalances(db, "acc-1");
    const named = Object.fromEntries(balances.map((b) => [b.clientId ?? "null", b.balanceCents]));
    expect(named["c-1"]).toBe(6_000);
    expect(named["c-2"]).toBe(2_000);
    expect(named["null"]).toBe(25);

    // getClientLedgerSum re-queries: txns then clients
    const db2 = makeDb([txns, clientRows]);
    const sum = await getClientLedgerSum(db2, "acc-1");
    expect(sum).toBe(8_000); // c-1 + c-2 only; null bucket excluded
  });
});
