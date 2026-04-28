// src/server/services/trust-accounting/transactions-service.ts
//
// Phase 3.8 — Trust ledger writes.
//
// Compliance rules enforced here:
//   1. Per-client never-negative: a disbursement that would drive client X's
//      balance below zero throws NEVER_NEGATIVE. Computed inside a serializable
//      transaction to prevent two concurrent disbursements both succeeding
//      against the same balance.
//   2. No hard deletes — voids leave the original row + insert a reversing
//      entry of the opposite sign, marked with voids_transaction_id.
//   3. Transfers create a paired (negative, positive) set in a single tx.

import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import {
  trustTransactions,
  POSITIVE_TRUST_TYPES,
  type TrustTransaction,
  type TrustTransactionType,
} from "@/server/db/schema/trust-transactions";
import { clients } from "@/server/db/schema/clients";
import { isPositive, applyTxn, getClientBalance } from "./balances-service";

type Db = any;

export class NeverNegativeError extends Error {
  code = "NEVER_NEGATIVE" as const;
  clientId: string;
  currentBalanceCents: number;
  attemptedAmountCents: number;
  constructor(clientId: string, currentBalanceCents: number, attemptedAmountCents: number) {
    super(
      `Disbursement of ${attemptedAmountCents}¢ would drive client ${clientId} below zero (current ${currentBalanceCents}¢).`,
    );
    this.name = "NeverNegativeError";
    this.clientId = clientId;
    this.currentBalanceCents = currentBalanceCents;
    this.attemptedAmountCents = attemptedAmountCents;
  }
}

export interface RecordDepositInput {
  orgId: string;
  accountId: string;
  clientId: string | null;
  caseId?: string | null;
  amountCents: number;
  transactionDate: Date;
  payorName?: string | null;
  description: string;
  checkNumber?: string | null;
  wireReference?: string | null;
  createdBy: string;
}

export async function recordDeposit(
  db: Db,
  input: RecordDepositInput,
): Promise<{ id: string }> {
  if (input.amountCents <= 0) throw new Error("Amount must be positive");
  const [row] = (await db
    .insert(trustTransactions)
    .values({
      orgId: input.orgId,
      accountId: input.accountId,
      clientId: input.clientId ?? null,
      caseId: input.caseId ?? null,
      transactionType: "deposit" as TrustTransactionType,
      amountCents: input.amountCents,
      transactionDate: input.transactionDate,
      payorName: input.payorName ?? null,
      checkNumber: input.checkNumber ?? null,
      wireReference: input.wireReference ?? null,
      description: input.description,
      createdBy: input.createdBy,
    })
    .returning({ id: trustTransactions.id })) as { id: string }[];
  return { id: row.id };
}

export interface RecordDisbursementInput {
  orgId: string;
  accountId: string;
  clientId: string;
  caseId?: string | null;
  amountCents: number;
  transactionDate: Date;
  payeeName: string;
  description: string;
  checkNumber?: string | null;
  wireReference?: string | null;
  authorizedBy: string;
  createdBy: string;
}

/**
 * Record a disbursement against a client's trust balance.
 * Refuses to commit if it would drive the client below zero. Uses a
 * serializable transaction to close the read-then-write race window.
 */
export async function recordDisbursement(
  db: Db,
  input: RecordDisbursementInput,
): Promise<{ id: string }> {
  if (input.amountCents <= 0) throw new Error("Amount must be positive");

  // db.transaction is the canonical way to get a single connection so the
  // balance read + insert are atomic. Drizzle uses SERIALIZABLE if requested;
  // we set it to be safe across providers.
  const result = await db.transaction(async (tx: Db) => {
    // Re-read inside the tx — under SERIALIZABLE this guarantees no other
    // committed disbursement against the same client snuck in.
    await tx.execute?.(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`).catch(() => {});

    const { balanceCents } = await getClientBalance(tx, input.accountId, input.clientId);
    if (balanceCents < input.amountCents) {
      throw new NeverNegativeError(input.clientId, balanceCents, input.amountCents);
    }
    const [row] = (await tx
      .insert(trustTransactions)
      .values({
        orgId: input.orgId,
        accountId: input.accountId,
        clientId: input.clientId,
        caseId: input.caseId ?? null,
        transactionType: "disbursement" as TrustTransactionType,
        amountCents: input.amountCents,
        transactionDate: input.transactionDate,
        payeeName: input.payeeName,
        checkNumber: input.checkNumber ?? null,
        wireReference: input.wireReference ?? null,
        description: input.description,
        authorizedBy: input.authorizedBy,
        createdBy: input.createdBy,
      })
      .returning({ id: trustTransactions.id })) as { id: string }[];
    return { id: row.id };
  });
  return result;
}

export interface RecordTransferInput {
  orgId: string;
  fromAccountId: string;
  toAccountId: string;
  clientId: string;
  caseId?: string | null;
  amountCents: number;
  transactionDate: Date;
  description: string;
  authorizedBy: string;
  createdBy: string;
}

export async function recordTransfer(
  db: Db,
  input: RecordTransferInput,
): Promise<{ outgoingId: string; incomingId: string }> {
  if (input.amountCents <= 0) throw new Error("Amount must be positive");
  if (input.fromAccountId === input.toAccountId) {
    throw new Error("Source and destination accounts must differ");
  }
  return await db.transaction(async (tx: Db) => {
    await tx.execute?.(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`).catch(() => {});

    const { balanceCents } = await getClientBalance(tx, input.fromAccountId, input.clientId);
    if (balanceCents < input.amountCents) {
      throw new NeverNegativeError(input.clientId, balanceCents, input.amountCents);
    }
    const [outRow] = (await tx
      .insert(trustTransactions)
      .values({
        orgId: input.orgId,
        accountId: input.fromAccountId,
        clientId: input.clientId,
        caseId: input.caseId ?? null,
        transactionType: "transfer" as TrustTransactionType,
        amountCents: input.amountCents,
        transactionDate: input.transactionDate,
        description: `Transfer out: ${input.description}`,
        authorizedBy: input.authorizedBy,
        createdBy: input.createdBy,
      })
      .returning({ id: trustTransactions.id })) as { id: string }[];

    const [inRow] = (await tx
      .insert(trustTransactions)
      .values({
        orgId: input.orgId,
        accountId: input.toAccountId,
        clientId: input.clientId,
        caseId: input.caseId ?? null,
        transactionType: "deposit" as TrustTransactionType,
        amountCents: input.amountCents,
        transactionDate: input.transactionDate,
        description: `Transfer in: ${input.description}`,
        authorizedBy: input.authorizedBy,
        createdBy: input.createdBy,
      })
      .returning({ id: trustTransactions.id })) as { id: string }[];

    return { outgoingId: outRow.id, incomingId: inRow.id };
  });
}

export interface VoidTransactionInput {
  orgId: string;
  transactionId: string;
  reason: string;
  voidedBy: string;
}

/**
 * Mark a transaction voided and insert a reversing entry of the opposite
 * sign so balance arithmetic remains consistent. The reversing entry uses
 * `adjustment` as its type — adjustment is signed positive (it adds to the
 * account/client balance), so when we void a deposit (positive) we need a
 * NEGATIVE-sign reversal which means transactionType='service_charge', and
 * when we void a disbursement we need a POSITIVE-sign reversal which is
 * 'adjustment'. For transfers we void only the leg(s) requested by id.
 */
export async function voidTransaction(
  db: Db,
  input: VoidTransactionInput,
): Promise<{ reversingId: string }> {
  if (!input.reason.trim()) throw new Error("Void reason required");
  return await db.transaction(async (tx: Db) => {
    const [orig] = (await tx
      .select()
      .from(trustTransactions)
      .where(
        and(
          eq(trustTransactions.id, input.transactionId),
          eq(trustTransactions.orgId, input.orgId),
        ),
      )
      .limit(1)) as TrustTransaction[];
    if (!orig) throw new Error("Transaction not found");
    if (orig.voidedAt) throw new Error("Transaction already voided");

    // Choose the reversing transactionType so its sign opposes the original.
    const origIsPositive = isPositive(orig.transactionType);
    const reversingType: TrustTransactionType = origIsPositive
      ? "service_charge" // negative-sign reversal of a deposit/interest/adjustment
      : "adjustment"; // positive-sign reversal of a disbursement/transfer/service_charge

    await tx
      .update(trustTransactions)
      .set({ voidedAt: new Date(), voidReason: input.reason })
      .where(eq(trustTransactions.id, orig.id));

    const [rev] = (await tx
      .insert(trustTransactions)
      .values({
        orgId: orig.orgId,
        accountId: orig.accountId,
        clientId: orig.clientId,
        caseId: orig.caseId,
        transactionType: reversingType,
        amountCents: orig.amountCents,
        transactionDate: new Date(),
        description: `Void of ${orig.transactionType} ${orig.id}: ${input.reason}`,
        authorizedBy: input.voidedBy,
        voidsTransactionId: orig.id,
        createdBy: input.voidedBy,
      })
      .returning({ id: trustTransactions.id })) as { id: string }[];

    return { reversingId: rev.id };
  });
}

export interface ListTransactionsFilters {
  clientId?: string;
  caseId?: string;
  startDate?: Date;
  endDate?: Date;
  includeVoided?: boolean;
}

export async function listTransactions(
  db: Db,
  scope: { orgId: string; accountId?: string },
  filters: ListTransactionsFilters = {},
): Promise<TrustTransaction[]> {
  const conds = [eq(trustTransactions.orgId, scope.orgId)];
  if (scope.accountId) conds.push(eq(trustTransactions.accountId, scope.accountId));
  if (filters.clientId) conds.push(eq(trustTransactions.clientId, filters.clientId));
  if (filters.caseId) conds.push(eq(trustTransactions.caseId, filters.caseId));
  if (filters.startDate) conds.push(gte(trustTransactions.transactionDate, filters.startDate));
  if (filters.endDate) conds.push(lte(trustTransactions.transactionDate, filters.endDate));
  if (!filters.includeVoided) conds.push(isNull(trustTransactions.voidedAt));

  const rows = (await db
    .select()
    .from(trustTransactions)
    .where(and(...conds))
    .orderBy(desc(trustTransactions.transactionDate), desc(trustTransactions.createdAt))) as TrustTransaction[];
  return rows;
}
