// tests/unit/trust-transactions-service.test.ts
//
// Phase 3.8 — Unit tests for the transactions service.
// Validates:
//   * recordDeposit inserts a row
//   * recordDisbursement BLOCKS when client balance < amount (NEVER_NEGATIVE)
//   * recordDisbursement succeeds when balance is sufficient
//   * voidTransaction creates a reversing entry of opposite sign
//   * recordTransfer creates two paired rows

import { describe, it, expect } from "vitest";
import {
  recordDeposit,
  recordDisbursement,
  voidTransaction,
  recordTransfer,
  NeverNegativeError,
} from "@/server/services/trust-accounting/transactions-service";

type Op = { kind: string; values?: any; set?: any };

/**
 * Build a mock that:
 *  - .select(...) returns rows from a FIFO queue
 *  - .insert(...).values(v).returning() pushes ops, returns generated id
 *  - .update(...).set(s).where(_) records ops
 *  - .transaction(fn) just invokes fn with a fresh self-referential mock that
 *    shares the same selectQueue/ops list (transparent SAVEPOINT for tests)
 */
function makeDb(opts: { selectQueue: any[][]; insertIds?: string[] }) {
  const queue = [...opts.selectQueue];
  const idQ = [...(opts.insertIds ?? [])];
  const ops: Op[] = [];
  const inserted: any[] = [];

  function buildSelectChain() {
    return (_cols?: any) => {
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
    };
  }

  const baseDb: any = {
    select: buildSelectChain(),
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        inserted.push(v);
        return {
          returning: async () => [{ id: idQ.shift() ?? `txn-${inserted.length}` }],
        };
      },
    }),
    update: (_t: any) => ({
      set: (s: any) => ({
        where: () => {
          ops.push({ kind: "update", set: s });
          return Promise.resolve();
        },
      }),
    }),
    execute: () => Promise.resolve(),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(baseDb),
  };
  return { db: baseDb, ops, inserted };
}

describe("recordDeposit", () => {
  it("inserts a deposit row with type='deposit'", async () => {
    const { db, inserted } = makeDb({ selectQueue: [], insertIds: ["d-1"] });
    const r = await recordDeposit(db, {
      orgId: "org",
      accountId: "acc",
      clientId: "c-1",
      amountCents: 5_000,
      transactionDate: new Date("2026-04-01"),
      description: "Retainer",
      createdBy: "u-1",
    });
    expect(r.id).toBe("d-1");
    expect(inserted[0].transactionType).toBe("deposit");
    expect(inserted[0].amountCents).toBe(5_000);
  });

  it("rejects non-positive amounts", async () => {
    const { db } = makeDb({ selectQueue: [] });
    await expect(
      recordDeposit(db, {
        orgId: "o",
        accountId: "a",
        clientId: null,
        amountCents: 0,
        transactionDate: new Date(),
        description: "x",
        createdBy: "u",
      }),
    ).rejects.toThrow(/positive/);
  });
});

describe("recordDisbursement (never-negative)", () => {
  it("BLOCKS when client balance is less than the amount", async () => {
    // getClientBalance does ONE select for txns (already-filtered to client).
    const { db } = makeDb({
      selectQueue: [
        // existing client txns: $30 deposit, no other activity
        [{ transactionType: "deposit", amountCents: 3_000, clientId: "c-1" }],
      ],
    });
    await expect(
      recordDisbursement(db, {
        orgId: "o",
        accountId: "a",
        clientId: "c-1",
        amountCents: 5_000,
        transactionDate: new Date("2026-04-01"),
        payeeName: "Court",
        description: "Filing fee",
        authorizedBy: "u",
        createdBy: "u",
      }),
    ).rejects.toBeInstanceOf(NeverNegativeError);
  });

  it("SUCCEEDS when balance is sufficient", async () => {
    const { db, inserted } = makeDb({
      selectQueue: [
        [{ transactionType: "deposit", amountCents: 10_000, clientId: "c-1" }],
      ],
      insertIds: ["dis-1"],
    });
    const r = await recordDisbursement(db, {
      orgId: "o",
      accountId: "a",
      clientId: "c-1",
      amountCents: 4_000,
      transactionDate: new Date("2026-04-01"),
      payeeName: "Court",
      description: "Filing fee",
      authorizedBy: "u",
      createdBy: "u",
    });
    expect(r.id).toBe("dis-1");
    expect(inserted[0].transactionType).toBe("disbursement");
    expect(inserted[0].amountCents).toBe(4_000);
  });
});

describe("voidTransaction", () => {
  it("voiding a deposit inserts a service_charge reversal", async () => {
    const { db, ops, inserted } = makeDb({
      selectQueue: [
        // original txn fetch
        [
          {
            id: "t-1",
            orgId: "o",
            accountId: "a",
            clientId: "c-1",
            caseId: null,
            transactionType: "deposit",
            amountCents: 5_000,
            voidedAt: null,
          },
        ],
      ],
      insertIds: ["rev-1"],
    });
    const r = await voidTransaction(db, {
      orgId: "o",
      transactionId: "t-1",
      reason: "Wrong client",
      voidedBy: "u",
    });
    expect(r.reversingId).toBe("rev-1");
    // First op: update marking voided
    expect(ops[0].kind).toBe("update");
    expect(ops[0].set.voidedAt).toBeInstanceOf(Date);
    expect(ops[0].set.voidReason).toBe("Wrong client");
    // Second op: insert reversal
    expect(ops[1].kind).toBe("insert");
    expect(inserted[0].transactionType).toBe("service_charge");
    expect(inserted[0].amountCents).toBe(5_000);
    expect(inserted[0].voidsTransactionId).toBe("t-1");
  });

  it("voiding a disbursement inserts an adjustment reversal", async () => {
    const { db, inserted } = makeDb({
      selectQueue: [
        [
          {
            id: "t-2",
            orgId: "o",
            accountId: "a",
            clientId: "c-1",
            caseId: null,
            transactionType: "disbursement",
            amountCents: 1_200,
            voidedAt: null,
          },
        ],
      ],
      insertIds: ["rev-2"],
    });
    await voidTransaction(db, {
      orgId: "o",
      transactionId: "t-2",
      reason: "Wrong payee",
      voidedBy: "u",
    });
    expect(inserted[0].transactionType).toBe("adjustment");
  });
});

describe("recordTransfer", () => {
  it("creates a paired (transfer, deposit) when balance permits", async () => {
    const { db, inserted } = makeDb({
      selectQueue: [
        // client balance lookup
        [{ transactionType: "deposit", amountCents: 10_000, clientId: "c-1" }],
      ],
      insertIds: ["out-1", "in-1"],
    });
    const r = await recordTransfer(db, {
      orgId: "o",
      fromAccountId: "a",
      toAccountId: "b",
      clientId: "c-1",
      amountCents: 3_000,
      transactionDate: new Date("2026-04-01"),
      description: "Move to operating after invoice",
      authorizedBy: "u",
      createdBy: "u",
    });
    expect(r.outgoingId).toBe("out-1");
    expect(r.incomingId).toBe("in-1");
    expect(inserted).toHaveLength(2);
    expect(inserted[0].transactionType).toBe("transfer");
    expect(inserted[0].accountId).toBe("a");
    expect(inserted[1].transactionType).toBe("deposit");
    expect(inserted[1].accountId).toBe("b");
  });

  it("blocks when from-balance is insufficient", async () => {
    const { db } = makeDb({
      selectQueue: [[{ transactionType: "deposit", amountCents: 1_000, clientId: "c-1" }]],
    });
    await expect(
      recordTransfer(db, {
        orgId: "o",
        fromAccountId: "a",
        toAccountId: "b",
        clientId: "c-1",
        amountCents: 5_000,
        transactionDate: new Date(),
        description: "x",
        authorizedBy: "u",
        createdBy: "u",
      }),
    ).rejects.toBeInstanceOf(NeverNegativeError);
  });
});
