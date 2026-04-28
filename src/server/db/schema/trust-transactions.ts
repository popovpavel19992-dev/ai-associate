// src/server/db/schema/trust-transactions.ts
//
// Phase 3.8 — IOLTA / Trust Accounting append-only ledger.
// All amounts stored positive in `amountCents`; the sign of the running
// balance is derived from `transactionType` (see balances-service).
// Voids are NEVER hard deletes — a separate reversing entry is inserted
// pointing back via voidsTransactionId, and the original row is marked
// with voidedAt + voidReason.

import {
  pgTable,
  uuid,
  text,
  bigint,
  date,
  timestamp,
  index,
  check,
  AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { trustAccounts } from "./trust-accounts";
import { clients } from "./clients";
import { cases } from "./cases";
import { users } from "./users";

export const TRUST_TRANSACTION_TYPE = [
  "deposit",
  "disbursement",
  "transfer",
  "adjustment",
  "interest",
  "service_charge",
] as const;
export type TrustTransactionType = (typeof TRUST_TRANSACTION_TYPE)[number];

/** Types that increase the account/client balance. */
export const POSITIVE_TRUST_TYPES: TrustTransactionType[] = [
  "deposit",
  "interest",
  "adjustment",
];

/** Types that decrease the account/client balance. */
export const NEGATIVE_TRUST_TYPES: TrustTransactionType[] = [
  "disbursement",
  "transfer",
  "service_charge",
];

export const trustTransactions = pgTable(
  "trust_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id")
      .references(() => trustAccounts.id, { onDelete: "restrict" })
      .notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "restrict" }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    transactionType: text("transaction_type").$type<TrustTransactionType>().notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    transactionDate: date("transaction_date", { mode: "date" }).notNull(),
    payeeName: text("payee_name"),
    payorName: text("payor_name"),
    checkNumber: text("check_number"),
    wireReference: text("wire_reference"),
    description: text("description").notNull(),
    authorizedBy: uuid("authorized_by").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    voidsTransactionId: uuid("voids_transaction_id").references(
      (): AnyPgColumn => trustTransactions.id,
      { onDelete: "set null" },
    ),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("trust_transactions_account_date_idx").on(
      table.accountId,
      table.transactionDate,
    ),
    index("trust_transactions_client_idx").on(table.clientId, table.transactionDate),
    index("trust_transactions_case_idx").on(table.caseId, table.transactionDate),
    check(
      "trust_transactions_type_check",
      sql`${table.transactionType} IN ('deposit','disbursement','transfer','adjustment','interest','service_charge')`,
    ),
    check("trust_transactions_amount_check", sql`${table.amountCents} > 0`),
    check(
      "trust_transactions_void_consistency_check",
      sql`(${table.voidedAt} IS NULL AND ${table.voidReason} IS NULL) OR (${table.voidedAt} IS NOT NULL AND ${table.voidReason} IS NOT NULL)`,
    ),
  ],
);

export type TrustTransaction = typeof trustTransactions.$inferSelect;
export type NewTrustTransaction = typeof trustTransactions.$inferInsert;
