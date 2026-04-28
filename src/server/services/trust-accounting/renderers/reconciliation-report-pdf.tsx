// src/server/services/trust-accounting/renderers/reconciliation-report-pdf.tsx
//
// Phase 3.8 — Monthly trust reconciliation PDF.
// LETTER, portrait, Times-Roman 11pt. Layout:
//   1. Header (firm + account + period)
//   2. Three-way reconciliation summary box
//   3. Per-client transactions for the period (grouped, with running balance)
//   4. Client balance summary (non-zero balances)
//   5. Reconciled-by signature block
//   6. Compliance footer

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { TrustTransactionType } from "@/server/db/schema/trust-transactions";

const styles = StyleSheet.create({
  page: { padding: 56, fontSize: 11, fontFamily: "Times-Roman", lineHeight: 1.4 },
  bold: { fontFamily: "Times-Bold" },
  center: { textAlign: "center" },
  right: { textAlign: "right" },
  header: { textAlign: "center", marginBottom: 18 },
  firm: { fontFamily: "Times-Bold", fontSize: 14, marginBottom: 2 },
  title: { fontFamily: "Times-Bold", fontSize: 12, marginTop: 4 },
  subtitle: { fontStyle: "italic", marginBottom: 4 },
  box: {
    border: "1pt solid black",
    padding: 10,
    marginBottom: 18,
  },
  boxTitle: {
    fontFamily: "Times-Bold",
    marginBottom: 6,
    textDecoration: "underline",
  },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  rowLabel: { fontFamily: "Times-Bold" },
  matchLine: { marginTop: 6, fontFamily: "Times-Bold" },
  sectionHeader: {
    fontFamily: "Times-Bold",
    fontSize: 12,
    marginTop: 14,
    marginBottom: 6,
    textDecoration: "underline",
  },
  clientHeader: { fontFamily: "Times-Bold", marginTop: 10, marginBottom: 4 },
  table: { marginTop: 4 },
  thead: {
    flexDirection: "row",
    borderBottom: "1pt solid black",
    paddingBottom: 2,
    marginBottom: 2,
  },
  trow: { flexDirection: "row", paddingVertical: 1 },
  cDate: { width: "16%" },
  cType: { width: "18%" },
  cDesc: { width: "30%" },
  cAmt: { width: "18%", textAlign: "right" },
  cRun: { width: "18%", textAlign: "right" },
  small: { fontSize: 9 },
  signature: { marginTop: 28 },
  footer: {
    marginTop: 24,
    paddingTop: 6,
    borderTop: "1pt solid #888",
    fontSize: 8,
    fontStyle: "italic",
  },
});

function fmt(cents: number): string {
  const n = cents / 100;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const POSITIVE_TYPES = new Set<TrustTransactionType>(["deposit", "interest", "adjustment"]);

export interface ReconciliationPdfTxn {
  id: string;
  transactionType: TrustTransactionType;
  amountCents: number;
  transactionDate: Date | string;
  description: string;
  payeeName: string | null;
  payorName: string | null;
  checkNumber: string | null;
  voidedAt: Date | string | null;
}

export interface ReconciliationPdfClientGroup {
  clientId: string | null;
  clientName: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  transactions: ReconciliationPdfTxn[];
}

export interface ReconciliationPdfProps {
  firmName: string;
  accountName: string;
  jurisdiction: string;
  periodLabel: string; // e.g. "March 2026"
  bankStatementBalanceCents: number;
  bookBalanceCents: number;
  clientLedgerSumCents: number;
  status: "matched" | "discrepancy" | "pending";
  notes: string | null;
  reconciledByName: string;
  reconciledAt: Date | string;
  clientGroups: ReconciliationPdfClientGroup[];
  /** All non-zero client balances at end of period (summary table). */
  clientBalances: { clientName: string; balanceCents: number }[];
}

export function ReconciliationReportPdf(
  props: ReconciliationPdfProps,
): React.ReactElement {
  const discrepancy =
    props.bankStatementBalanceCents - props.bookBalanceCents !== 0 ||
    props.bookBalanceCents - props.clientLedgerSumCents !== 0;

  const statusLabel = props.status === "matched" ? "MATCHED" : "DISCREPANCY";

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.firm}>{props.firmName}</Text>
          <Text>Monthly Trust Account Reconciliation</Text>
          <Text style={styles.subtitle}>
            {props.accountName} — {props.periodLabel}
          </Text>
          <Text style={styles.small}>Jurisdiction: {props.jurisdiction}</Text>
        </View>

        {/* Three-way summary */}
        <View style={styles.box}>
          <Text style={styles.boxTitle}>Three-Way Reconciliation Summary</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Bank Statement Balance:</Text>
            <Text>{fmt(props.bankStatementBalanceCents)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Book Balance:</Text>
            <Text>{fmt(props.bookBalanceCents)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Sum of Client Ledgers:</Text>
            <Text>{fmt(props.clientLedgerSumCents)}</Text>
          </View>
          <Text style={styles.matchLine}>
            Status: {statusLabel}
            {discrepancy
              ? ` — Discrepancy of ${fmt(
                  Math.max(
                    Math.abs(props.bankStatementBalanceCents - props.bookBalanceCents),
                    Math.abs(props.bookBalanceCents - props.clientLedgerSumCents),
                  ),
                )}`
              : ""}
          </Text>
          {props.notes ? (
            <Text style={{ marginTop: 6 }}>Notes: {props.notes}</Text>
          ) : null}
        </View>

        {/* Per-client transactions */}
        <Text style={styles.sectionHeader}>Transactions for the Period</Text>
        {props.clientGroups.length === 0 ? (
          <Text style={styles.small}>No transactions in this period.</Text>
        ) : null}
        {props.clientGroups.map((g) => (
          <View key={g.clientId ?? "unallocated"} wrap={false}>
            <Text style={styles.clientHeader}>{g.clientName}</Text>
            <Text style={styles.small}>
              Opening balance: {fmt(g.openingBalanceCents)}
            </Text>
            <View style={styles.table}>
              <View style={styles.thead}>
                <Text style={[styles.cDate, styles.bold]}>Date</Text>
                <Text style={[styles.cType, styles.bold]}>Type</Text>
                <Text style={[styles.cDesc, styles.bold]}>Description</Text>
                <Text style={[styles.cAmt, styles.bold]}>Amount</Text>
                <Text style={[styles.cRun, styles.bold]}>Running</Text>
              </View>
              {(() => {
                let running = g.openingBalanceCents;
                return g.transactions.map((t) => {
                  if (t.voidedAt) {
                    // voided rows shown but don't move the running balance
                    return (
                      <View key={t.id} style={styles.trow}>
                        <Text style={styles.cDate}>{fmtDate(t.transactionDate)}</Text>
                        <Text style={styles.cType}>{t.transactionType} (VOID)</Text>
                        <Text style={styles.cDesc}>{t.description}</Text>
                        <Text style={styles.cAmt}>—</Text>
                        <Text style={styles.cRun}>{fmt(running)}</Text>
                      </View>
                    );
                  }
                  const sign = POSITIVE_TYPES.has(t.transactionType) ? 1 : -1;
                  running += sign * t.amountCents;
                  const amtCell = `${sign < 0 ? "-" : ""}${fmt(t.amountCents)}`;
                  return (
                    <View key={t.id} style={styles.trow}>
                      <Text style={styles.cDate}>{fmtDate(t.transactionDate)}</Text>
                      <Text style={styles.cType}>{t.transactionType}</Text>
                      <Text style={styles.cDesc}>{t.description}</Text>
                      <Text style={styles.cAmt}>{amtCell}</Text>
                      <Text style={styles.cRun}>{fmt(running)}</Text>
                    </View>
                  );
                });
              })()}
            </View>
            <Text style={[styles.small, { marginTop: 2 }]}>
              Closing balance: {fmt(g.closingBalanceCents)}
            </Text>
          </View>
        ))}

        {/* Client balance summary */}
        <Text style={styles.sectionHeader}>Client Balance Summary (End of Period)</Text>
        {props.clientBalances.length === 0 ? (
          <Text style={styles.small}>No clients with non-zero balances.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.thead}>
              <Text style={[{ width: "70%" }, styles.bold]}>Client</Text>
              <Text style={[{ width: "30%", textAlign: "right" }, styles.bold]}>
                Balance
              </Text>
            </View>
            {props.clientBalances.map((b) => (
              <View key={b.clientName} style={styles.trow}>
                <Text style={{ width: "70%" }}>{b.clientName}</Text>
                <Text style={{ width: "30%", textAlign: "right" }}>
                  {fmt(b.balanceCents)}
                </Text>
              </View>
            ))}
            <View style={[styles.trow, { borderTop: "1pt solid black", marginTop: 2, paddingTop: 2 }]}>
              <Text style={[{ width: "70%" }, styles.bold]}>TOTAL</Text>
              <Text style={[{ width: "30%", textAlign: "right" }, styles.bold]}>
                {fmt(
                  props.clientBalances.reduce((s, b) => s + b.balanceCents, 0),
                )}
              </Text>
            </View>
          </View>
        )}

        {/* Signature */}
        <View style={styles.signature}>
          <Text>Reconciled by: {props.reconciledByName}</Text>
          <Text>Date: {fmtDate(props.reconciledAt)}</Text>
          <Text style={{ marginTop: 18 }}>Signature: ____________________________</Text>
        </View>

        {/* Compliance footer */}
        <Text style={styles.footer}>
          This reconciliation was performed in accordance with {props.jurisdiction}{" "}
          state bar trust-account rules. Discrepancies must be investigated and
          resolved before the next reconciliation period.
        </Text>
      </Page>
    </Document>
  );
}
