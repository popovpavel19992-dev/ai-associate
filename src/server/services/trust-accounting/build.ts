// src/server/services/trust-accounting/build.ts
//
// Top-level builder for the monthly trust reconciliation PDF report.

import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { and, asc, eq, inArray, isNull, lt, lte, gte } from "drizzle-orm";
import { db } from "@/server/db";
import { trustAccounts } from "@/server/db/schema/trust-accounts";
import {
  trustTransactions,
  POSITIVE_TRUST_TYPES,
  type TrustTransactionType,
} from "@/server/db/schema/trust-transactions";
import { trustReconciliations } from "@/server/db/schema/trust-reconciliations";
import { clients } from "@/server/db/schema/clients";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import {
  ReconciliationReportPdf,
  type ReconciliationPdfClientGroup,
  type ReconciliationPdfTxn,
} from "./renderers/reconciliation-report-pdf";
import { applyTxn } from "./balances-service";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class ReconciliationNotFoundError extends Error {
  constructor(id: string) {
    super(`Reconciliation ${id} not found`);
    this.name = "ReconciliationNotFoundError";
  }
}

function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setUTCDate(1);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function endOfMonth(d: Date): Date {
  const next = new Date(d);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(0);
  next.setUTCHours(23, 59, 59, 999);
  return next;
}

function periodLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export async function buildReconciliationReportPdf(input: {
  reconciliationId: string;
}): Promise<Buffer> {
  const [recon] = await db
    .select()
    .from(trustReconciliations)
    .where(eq(trustReconciliations.id, input.reconciliationId))
    .limit(1);
  if (!recon) throw new ReconciliationNotFoundError(input.reconciliationId);

  const [account] = await db
    .select()
    .from(trustAccounts)
    .where(eq(trustAccounts.id, recon.accountId))
    .limit(1);
  if (!account) throw new Error(`Account ${recon.accountId} not found`);

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, recon.orgId))
    .limit(1);

  const [reconciler] = await db
    .select()
    .from(users)
    .where(eq(users.id, recon.reconciledBy))
    .limit(1);

  const periodStart = startOfMonth(recon.periodMonth as Date);
  const periodEnd = endOfMonth(recon.periodMonth as Date);

  // All non-voided transactions up through end of period (for opening balance + period rows).
  const allRows = (await db
    .select()
    .from(trustTransactions)
    .where(
      and(
        eq(trustTransactions.accountId, recon.accountId),
        lte(trustTransactions.transactionDate, periodEnd),
      ),
    )
    .orderBy(asc(trustTransactions.transactionDate), asc(trustTransactions.createdAt))) as Array<
    typeof trustTransactions.$inferSelect
  >;

  // Build per-client groups: opening balance = sum of activity strictly before periodStart;
  // period transactions = those between [periodStart, periodEnd], including voided (annotated).
  const groups = new Map<string | null, {
    opening: number;
    closing: number;
    txns: typeof allRows;
  }>();

  for (const row of allRows) {
    const key = row.clientId;
    if (!groups.has(key)) groups.set(key, { opening: 0, closing: 0, txns: [] });
    const g = groups.get(key)!;
    const inPeriod =
      (row.transactionDate as Date) >= periodStart &&
      (row.transactionDate as Date) <= periodEnd;
    if (inPeriod) {
      g.txns.push(row);
    }
    if (!row.voidedAt) {
      const delta = applyTxn(0, {
        transactionType: row.transactionType as TrustTransactionType,
        amountCents: row.amountCents,
      });
      if (!inPeriod) {
        g.opening += delta;
      }
      g.closing += delta;
    }
  }

  // Resolve client names
  const clientIds = [...groups.keys()].filter((k): k is string => k !== null);
  const nameMap = new Map<string, string>();
  if (clientIds.length > 0) {
    const cl = await db
      .select({ id: clients.id, displayName: clients.displayName })
      .from(clients)
      .where(inArray(clients.id, clientIds));
    for (const c of cl) nameMap.set(c.id, c.displayName);
  }

  const clientGroups: ReconciliationPdfClientGroup[] = [...groups.entries()]
    .map(([clientId, g]) => ({
      clientId,
      clientName:
        clientId === null
          ? "(Unallocated / Account-level)"
          : nameMap.get(clientId) ?? "(Unknown client)",
      openingBalanceCents: g.opening,
      closingBalanceCents: g.closing,
      transactions: g.txns.map(
        (t): ReconciliationPdfTxn => ({
          id: t.id,
          transactionType: t.transactionType as TrustTransactionType,
          amountCents: t.amountCents,
          transactionDate: t.transactionDate as Date,
          description: t.description,
          payeeName: t.payeeName,
          payorName: t.payorName,
          checkNumber: t.checkNumber,
          voidedAt: t.voidedAt,
        }),
      ),
    }))
    // Only include groups that had period activity OR have non-zero closing
    .filter((g) => g.transactions.length > 0 || g.closingBalanceCents !== 0)
    .sort((a, b) => a.clientName.localeCompare(b.clientName));

  const clientBalances = clientGroups
    .filter((g) => g.clientId !== null && g.closingBalanceCents !== 0)
    .map((g) => ({ clientName: g.clientName, balanceCents: g.closingBalanceCents }));

  const buf = await renderToBuffer(
    React.createElement(ReconciliationReportPdf, {
      firmName: org?.name ?? "Law Firm",
      accountName: account.name,
      jurisdiction: account.jurisdiction,
      periodLabel: periodLabel(periodStart),
      bankStatementBalanceCents: recon.bankStatementBalanceCents,
      bookBalanceCents: recon.bookBalanceCents,
      clientLedgerSumCents: recon.clientLedgerSumCents,
      status: recon.status as "matched" | "discrepancy" | "pending",
      notes: recon.notes,
      reconciledByName: reconciler?.name?.trim() || reconciler?.email || "Attorney",
      reconciledAt: recon.reconciledAt,
      clientGroups,
      clientBalances,
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
