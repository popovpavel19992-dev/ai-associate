// src/server/services/trust-accounting/balances-service.ts
//
// Phase 3.8 — Trust account & per-client balance computation.
//
// Balances are computed on the fly from the immutable ledger:
//
//   running balance = beginning_balance
//                    + sum(deposits/interest/adjustment)
//                    - sum(disbursements/transfers/service_charge)
//
// Voided transactions (voided_at IS NOT NULL) are excluded from sums.
// The reversing entries inserted during voids are NOT excluded — they
// carry the offsetting amount that cancels the voided original.

import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { trustAccounts } from "@/server/db/schema/trust-accounts";
import {
  trustTransactions,
  POSITIVE_TRUST_TYPES,
  NEGATIVE_TRUST_TYPES,
  type TrustTransaction,
  type TrustTransactionType,
} from "@/server/db/schema/trust-transactions";
import { clients } from "@/server/db/schema/clients";

type Db = any;

/** True if the type increases the balance, false if decreases. */
export function isPositive(type: TrustTransactionType): boolean {
  return POSITIVE_TRUST_TYPES.includes(type);
}

/** Apply the type-sign of a single non-voided txn to a running total. */
export function applyTxn(running: number, txn: { transactionType: TrustTransactionType; amountCents: number }): number {
  return isPositive(txn.transactionType) ? running + txn.amountCents : running - txn.amountCents;
}

async function fetchActiveTxns(
  db: Db,
  filter: { accountId: string; clientId?: string | null },
): Promise<Array<Pick<TrustTransaction, "transactionType" | "amountCents" | "clientId">>> {
  const where = filter.clientId !== undefined
    ? and(
        eq(trustTransactions.accountId, filter.accountId),
        filter.clientId === null
          ? isNull(trustTransactions.clientId)
          : eq(trustTransactions.clientId, filter.clientId),
        isNull(trustTransactions.voidedAt),
      )
    : and(
        eq(trustTransactions.accountId, filter.accountId),
        isNull(trustTransactions.voidedAt),
      );
  const rows = (await db
    .select({
      transactionType: trustTransactions.transactionType,
      amountCents: trustTransactions.amountCents,
      clientId: trustTransactions.clientId,
    })
    .from(trustTransactions)
    .where(where)) as Array<Pick<TrustTransaction, "transactionType" | "amountCents" | "clientId">>;
  return rows;
}

export async function getAccountBalance(
  db: Db,
  accountId: string,
): Promise<{ balanceCents: number; asOf: Date }> {
  const [acc] = (await db
    .select({ beginningBalanceCents: trustAccounts.beginningBalanceCents })
    .from(trustAccounts)
    .where(eq(trustAccounts.id, accountId))
    .limit(1)) as { beginningBalanceCents: number }[];
  const beginning = acc?.beginningBalanceCents ?? 0;
  const txns = await fetchActiveTxns(db, { accountId });
  let total = beginning;
  for (const t of txns) total = applyTxn(total, t);
  return { balanceCents: total, asOf: new Date() };
}

export async function getClientBalance(
  db: Db,
  accountId: string,
  clientId: string,
): Promise<{ balanceCents: number }> {
  const txns = await fetchActiveTxns(db, { accountId, clientId });
  let total = 0;
  for (const t of txns) total = applyTxn(total, t);
  return { balanceCents: total };
}

/**
 * Per-client running balances for an account. Returns one row per distinct
 * client_id that has at least one non-voided transaction (or whose balance
 * is non-zero). Includes a synthetic null-client row if the account has any
 * unattributed transactions (interest / service charges).
 */
export async function getAllClientBalances(
  db: Db,
  accountId: string,
): Promise<Array<{ clientId: string | null; clientName: string; balanceCents: number }>> {
  const rows = (await db
    .select({
      clientId: trustTransactions.clientId,
      transactionType: trustTransactions.transactionType,
      amountCents: trustTransactions.amountCents,
    })
    .from(trustTransactions)
    .where(
      and(eq(trustTransactions.accountId, accountId), isNull(trustTransactions.voidedAt)),
    )) as Array<{
    clientId: string | null;
    transactionType: TrustTransactionType;
    amountCents: number;
  }>;

  const balances = new Map<string | null, number>();
  for (const r of rows) {
    const cur = balances.get(r.clientId) ?? 0;
    balances.set(r.clientId, applyTxn(cur, r));
  }

  const clientIds = [...balances.keys()].filter((k): k is string => k !== null);
  const nameMap = new Map<string, string>();
  if (clientIds.length > 0) {
    const cl = (await db
      .select({ id: clients.id, displayName: clients.displayName })
      .from(clients)
      .where(inArray(clients.id, clientIds))) as { id: string; displayName: string }[];
    for (const c of cl) nameMap.set(c.id, c.displayName);
  }

  const out: Array<{ clientId: string | null; clientName: string; balanceCents: number }> = [];
  for (const [cid, bal] of balances.entries()) {
    if (bal === 0) continue;
    out.push({
      clientId: cid,
      clientName: cid === null ? "(Unallocated / Account-level)" : nameMap.get(cid) ?? "(Unknown)",
      balanceCents: bal,
    });
  }
  out.sort((a, b) => a.clientName.localeCompare(b.clientName));
  return out;
}

/**
 * Sum of all client running balances (per-client ledgers). Used as the third
 * leg of three-way reconciliation. Excludes the unallocated bucket — for
 * IOLTA, the unallocated bucket should always be zero.
 */
export async function getClientLedgerSum(
  db: Db,
  accountId: string,
): Promise<number> {
  const balances = await getAllClientBalances(db, accountId);
  return balances
    .filter((b) => b.clientId !== null)
    .reduce((sum, b) => sum + b.balanceCents, 0);
}
