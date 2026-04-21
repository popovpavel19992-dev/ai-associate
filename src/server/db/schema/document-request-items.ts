// src/server/db/schema/document-request-items.ts
import { pgTable, uuid, text, timestamp, integer, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { documentRequests } from "./document-requests";

export const documentRequestItems = pgTable(
  "document_request_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .references(() => documentRequests.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("pending"),
    rejectionNote: text("rejection_note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("document_request_items_request_sort_idx").on(table.requestId, table.sortOrder),
    check(
      "document_request_items_status_check",
      sql`${table.status} IN ('pending','uploaded','reviewed','rejected')`,
    ),
  ],
);

export type DocumentRequestItem = typeof documentRequestItems.$inferSelect;
export type NewDocumentRequestItem = typeof documentRequestItems.$inferInsert;
