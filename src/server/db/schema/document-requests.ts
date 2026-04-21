// src/server/db/schema/document-requests.ts
import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";

export const documentRequests = pgTable(
  "document_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    note: text("note"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    createdBy: uuid("created_by")
      .references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("document_requests_case_status_idx").on(table.caseId, table.status),
    index("document_requests_case_created_idx").on(table.caseId, table.createdAt),
    check(
      "document_requests_status_check",
      sql`${table.status} IN ('open','awaiting_review','completed','cancelled')`,
    ),
  ],
);

export type DocumentRequest = typeof documentRequests.$inferSelect;
export type NewDocumentRequest = typeof documentRequests.$inferInsert;
