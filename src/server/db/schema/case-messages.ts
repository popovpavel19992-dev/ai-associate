import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { portalUsers } from "./portal-users";
import { documents } from "./documents";

export const caseMessages = pgTable(
  "case_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    authorType: text("author_type").notNull(),
    lawyerAuthorId: uuid("lawyer_author_id").references(() => users.id, { onDelete: "set null" }),
    portalAuthorId: uuid("portal_author_id").references(() => portalUsers.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("case_messages_case_created_idx").on(table.caseId, table.createdAt),
    check(
      "case_messages_author_check",
      sql`(author_type = 'lawyer' AND lawyer_author_id IS NOT NULL AND portal_author_id IS NULL) OR (author_type = 'client' AND portal_author_id IS NOT NULL AND lawyer_author_id IS NULL)`,
    ),
  ],
);
