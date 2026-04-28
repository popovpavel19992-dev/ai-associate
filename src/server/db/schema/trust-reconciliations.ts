// src/server/db/schema/trust-reconciliations.ts
//
// Phase 3.8 — Monthly three-way reconciliation snapshot.
// Stores a frozen point-in-time record:
//   bank_statement_balance == book_balance == client_ledger_sum  → 'matched'
//   any mismatch                                                  → 'discrepancy'

import {
  pgTable,
  uuid,
  text,
  bigint,
  date,
  timestamp,
  index,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { trustAccounts } from "./trust-accounts";
import { users } from "./users";

export const TRUST_RECONCILIATION_STATUS = [
  "matched",
  "discrepancy",
  "pending",
] as const;
export type TrustReconciliationStatus = (typeof TRUST_RECONCILIATION_STATUS)[number];

export const trustReconciliations = pgTable(
  "trust_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id")
      .references(() => trustAccounts.id, { onDelete: "cascade" })
      .notNull(),
    periodMonth: date("period_month", { mode: "date" }).notNull(),
    bankStatementBalanceCents: bigint("bank_statement_balance_cents", {
      mode: "number",
    }).notNull(),
    bookBalanceCents: bigint("book_balance_cents", { mode: "number" }).notNull(),
    clientLedgerSumCents: bigint("client_ledger_sum_cents", {
      mode: "number",
    }).notNull(),
    status: text("status").$type<TrustReconciliationStatus>().notNull(),
    notes: text("notes"),
    reconciledBy: uuid("reconciled_by")
      .references(() => users.id)
      .notNull(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("trust_reconciliations_org_idx").on(table.orgId, table.periodMonth),
    unique("trust_reconciliations_period_unique").on(
      table.accountId,
      table.periodMonth,
    ),
    check(
      "trust_reconciliations_status_check",
      sql`${table.status} IN ('matched','discrepancy','pending')`,
    ),
  ],
);

export type TrustReconciliation = typeof trustReconciliations.$inferSelect;
export type NewTrustReconciliation = typeof trustReconciliations.$inferInsert;
