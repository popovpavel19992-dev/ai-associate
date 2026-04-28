// src/server/services/trust-accounting/reconciliation-service.ts
//
// Phase 3.8 — Monthly three-way reconciliation.
//
// "Three-way" =
//   1. bank statement balance (input by reconciler)
//   2. book balance           (computed: beginning + Σ active txns through period)
//   3. client ledger sum      (Σ of every client's running balance)
//
// MATCHED  iff #1 == #2 == #3 exactly (no tolerance window — IOLTA rules
//          require exact equality; pennies count).
// DISCREPANCY otherwise; lawyer must investigate before next period.

import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { trustReconciliations, type TrustReconciliation } from "@/server/db/schema/trust-reconciliations";
import {
  trustTransactions,
  type TrustTransactionType,
  POSITIVE_TRUST_TYPES,
} from "@/server/db/schema/trust-transactions";
import { trustAccounts } from "@/server/db/schema/trust-accounts";
import { clients } from "@/server/db/schema/clients";
import { applyTxn, isPositive } from "./balances-service";

type Db = any;

/** Inclusive end-of-month for a given first-of-month date. */
function endOfMonth(periodStart: Date): Date {
  const next = new Date(periodStart);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(0); // last day of original month
  return next;
}

async function bookBalanceThrough(
  db: Db,
  accountId: string,
  through: Date,
): Promise<number> {
  const [acc] = (await db
    .select({ beginningBalanceCents: trustAccounts.beginningBalanceCents })
    .from(trustAccounts)
    .where(eq(trustAccounts.id, accountId))
    .limit(1)) as { beginningBalanceCents: number }[];
  const txns = (await db
    .select({
      transactionType: trustTransactions.transactionType,
      amountCents: trustTransactions.amountCents,
    })
    .from(trustTransactions)
    .where(
      and(
        eq(trustTransactions.accountId, accountId),
        isNull(trustTransactions.voidedAt),
        lte(trustTransactions.transactionDate, through),
      ),
    )) as Array<{ transactionType: TrustTransactionType; amountCents: number }>;
  let total = acc?.beginningBalanceCents ?? 0;
  for (const t of txns) total = applyTxn(total, t);
  return total;
}

async function clientLedgerSumThrough(
  db: Db,
  accountId: string,
  through: Date,
): Promise<number> {
  const txns = (await db
    .select({
      clientId: trustTransactions.clientId,
      transactionType: trustTransactions.transactionType,
      amountCents: trustTransactions.amountCents,
    })
    .from(trustTransactions)
    .where(
      and(
        eq(trustTransactions.accountId, accountId),
        isNull(trustTransactions.voidedAt),
        lte(trustTransactions.transactionDate, through),
      ),
    )) as Array<{ clientId: string | null; transactionType: TrustTransactionType; amountCents: number }>;
  const balances = new Map<string, number>();
  for (const t of txns) {
    if (t.clientId === null) continue; // unallocated does not count toward client sum
    const cur = balances.get(t.clientId) ?? 0;
    balances.set(t.clientId, applyTxn(cur, t));
  }
  let sum = 0;
  for (const b of balances.values()) sum += b;
  return sum;
}

export interface RecordReconciliationInput {
  orgId: string;
  accountId: string;
  /** First day of month being reconciled. */
  periodMonth: Date;
  bankStatementBalanceCents: number;
  reconciledBy: string;
  notes?: string | null;
}

export async function recordReconciliation(
  db: Db,
  input: RecordReconciliationInput,
): Promise<{ id: string; status: "matched" | "discrepancy" }> {
  const through = endOfMonth(input.periodMonth);
  const book = await bookBalanceThrough(db, input.accountId, through);
  const ledgerSum = await clientLedgerSumThrough(db, input.accountId, through);

  const matched =
    input.bankStatementBalanceCents === book && book === ledgerSum;
  const status: "matched" | "discrepancy" = matched ? "matched" : "discrepancy";

  const [row] = (await db
    .insert(trustReconciliations)
    .values({
      orgId: input.orgId,
      accountId: input.accountId,
      periodMonth: input.periodMonth,
      bankStatementBalanceCents: input.bankStatementBalanceCents,
      bookBalanceCents: book,
      clientLedgerSumCents: ledgerSum,
      status,
      notes: input.notes ?? null,
      reconciledBy: input.reconciledBy,
    })
    .returning({ id: trustReconciliations.id })) as { id: string }[];
  return { id: row.id, status };
}

/**
 * Preview the computed numbers WITHOUT inserting a row. Useful for the
 * "New Reconciliation" UI to show book/ledger before the user commits.
 */
export async function previewReconciliation(
  db: Db,
  input: { accountId: string; periodMonth: Date; bankStatementBalanceCents: number },
): Promise<{
  bookBalanceCents: number;
  clientLedgerSumCents: number;
  status: "matched" | "discrepancy";
}> {
  const through = endOfMonth(input.periodMonth);
  const book = await bookBalanceThrough(db, input.accountId, through);
  const ledger = await clientLedgerSumThrough(db, input.accountId, through);
  const matched = input.bankStatementBalanceCents === book && book === ledger;
  return {
    bookBalanceCents: book,
    clientLedgerSumCents: ledger,
    status: matched ? "matched" : "discrepancy",
  };
}

export async function listReconciliations(
  db: Db,
  accountId: string,
): Promise<TrustReconciliation[]> {
  const rows = (await db
    .select()
    .from(trustReconciliations)
    .where(eq(trustReconciliations.accountId, accountId))
    .orderBy(desc(trustReconciliations.periodMonth))) as TrustReconciliation[];
  return rows;
}

export async function getReconciliation(
  db: Db,
  reconciliationId: string,
): Promise<TrustReconciliation | null> {
  const [row] = (await db
    .select()
    .from(trustReconciliations)
    .where(eq(trustReconciliations.id, reconciliationId))
    .limit(1)) as TrustReconciliation[];
  return row ?? null;
}
