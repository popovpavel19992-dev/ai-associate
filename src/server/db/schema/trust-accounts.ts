// src/server/db/schema/trust-accounts.ts
//
// Phase 3.8 — IOLTA / Trust Accounting account schema.

import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";

export const TRUST_ACCOUNT_TYPE = ["iolta", "operating"] as const;
export type TrustAccountType = (typeof TRUST_ACCOUNT_TYPE)[number];

export const trustAccounts = pgTable(
  "trust_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    accountType: text("account_type").$type<TrustAccountType>().notNull(),
    bankName: text("bank_name"),
    accountNumberEncrypted: text("account_number_encrypted"),
    routingNumberEncrypted: text("routing_number_encrypted"),
    jurisdiction: text("jurisdiction").notNull().default("FEDERAL"),
    beginningBalanceCents: bigint("beginning_balance_cents", { mode: "number" })
      .notNull()
      .default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("trust_accounts_org_idx").on(table.orgId, table.isActive),
    check(
      "trust_accounts_type_check",
      sql`${table.accountType} IN ('iolta','operating')`,
    ),
  ],
);

export type TrustAccount = typeof trustAccounts.$inferSelect;
export type NewTrustAccount = typeof trustAccounts.$inferInsert;
