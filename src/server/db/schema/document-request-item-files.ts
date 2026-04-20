// src/server/db/schema/document-request-item-files.ts
import { pgTable, uuid, timestamp, boolean, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { documentRequestItems } from "./document-request-items";
import { documents } from "./documents";
import { users } from "./users";
import { portalUsers } from "./portal-users";

export const documentRequestItemFiles = pgTable(
  "document_request_item_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .references(() => documentRequestItems.id, { onDelete: "cascade" })
      .notNull(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "restrict" })
      .notNull(),
    uploadedByPortalUserId: uuid("uploaded_by_portal_user_id")
      .references(() => portalUsers.id, { onDelete: "set null" }),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    archived: boolean("archived").notNull().default(false),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("document_request_item_files_item_archived_idx").on(table.itemId, table.archived),
    uniqueIndex("document_request_item_files_item_doc_unique").on(table.itemId, table.documentId),
    check(
      "document_request_item_files_uploader_check",
      sql`(uploaded_by_portal_user_id IS NOT NULL AND uploaded_by_user_id IS NULL) OR (uploaded_by_portal_user_id IS NULL AND uploaded_by_user_id IS NOT NULL)`,
    ),
  ],
);

export type DocumentRequestItemFile = typeof documentRequestItemFiles.$inferSelect;
export type NewDocumentRequestItemFile = typeof documentRequestItemFiles.$inferInsert;
