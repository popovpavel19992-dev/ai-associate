import { pgTable, uuid, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { organizations } from "./organizations";

export const billingRates = pgTable(
  "billing_rates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    rateCents: integer("rate_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_billing_rates_user_case").on(
      table.userId,
      sql`COALESCE(${table.caseId}, '00000000-0000-0000-0000-000000000000')`,
    ),
  ],
);

export type BillingRate = typeof billingRates.$inferSelect;
