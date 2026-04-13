import { pgTable, uuid, text, integer, date, timestamp, index, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";
import { clients } from "./clients";
import { users } from "./users";
import { organizations } from "./organizations";

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "paid",
  "void",
]);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "restrict" })
      .notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    issuedDate: date("issued_date", { mode: "date" }),
    dueDate: date("due_date", { mode: "date" }),
    paidDate: date("paid_date", { mode: "date" }),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    notes: text("notes"),
    paymentTerms: text("payment_terms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_invoices_client").on(table.clientId, table.createdAt),
    index("idx_invoices_org_status").on(table.orgId, table.status),
    uniqueIndex("idx_invoices_number").on(table.orgId, table.invoiceNumber),
  ],
);

// scopeId = orgId for firm users, userId for solo users (avoids NULL PK)
export const invoiceCounters = pgTable("invoice_counters", {
  scopeId: uuid("scope_id").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceCounter = typeof invoiceCounters.$inferSelect;
