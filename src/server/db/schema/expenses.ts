import { pgTable, uuid, text, integer, date, timestamp, index, pgEnum } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";
import { organizations } from "./organizations";

export const expenseCategoryEnum = pgEnum("expense_category", [
  "filing_fee",
  "courier",
  "copying",
  "expert_fee",
  "travel",
  "postage",
  "service_of_process",
  "other",
]);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    category: expenseCategoryEnum("category").notNull().default("other"),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    expenseDate: date("expense_date", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_expenses_case").on(table.caseId, table.expenseDate),
  ],
);

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
