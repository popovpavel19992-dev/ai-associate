// src/server/db/schema/case-email-outreach-attachments.ts
import { pgTable, uuid, text, integer, index } from "drizzle-orm/pg-core";
import { caseEmailOutreach } from "./case-email-outreach";
import { documents } from "./documents";

export const caseEmailOutreachAttachments = pgTable(
  "case_email_outreach_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailId: uuid("email_id").references(() => caseEmailOutreach.id, { onDelete: "cascade" }).notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "restrict" }).notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
  },
  (table) => [
    index("case_email_outreach_attachments_email_idx").on(table.emailId),
  ],
);

export type CaseEmailOutreachAttachment = typeof caseEmailOutreachAttachments.$inferSelect;
export type NewCaseEmailOutreachAttachment = typeof caseEmailOutreachAttachments.$inferInsert;
