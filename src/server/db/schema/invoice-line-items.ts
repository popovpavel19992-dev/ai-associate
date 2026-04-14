import { pgTable, uuid, text, integer, numeric, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { invoices } from "./invoices";
import { cases } from "./cases";
import { timeEntries } from "./time-entries";
import { expenses } from "./expenses";

export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .references(() => invoices.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "restrict" })
      .notNull(),
    timeEntryId: uuid("time_entry_id").references(() => timeEntries.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "restrict" }),
    type: text("type").notNull(), // 'time' or 'expense'
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_invoice_line_items_invoice").on(table.invoiceId, table.sortOrder),
    uniqueIndex("idx_invoice_line_items_time_entry")
      .on(table.timeEntryId)
      .where(sql`${table.timeEntryId} IS NOT NULL`),
    uniqueIndex("idx_invoice_line_items_expense")
      .on(table.expenseId)
      .where(sql`${table.expenseId} IS NOT NULL`),
    check(
      "line_item_type_check",
      sql`(type = 'time' AND time_entry_id IS NOT NULL AND expense_id IS NULL)
          OR (type = 'expense' AND expense_id IS NOT NULL AND time_entry_id IS NULL)`,
    ),
  ],
);

export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert;
