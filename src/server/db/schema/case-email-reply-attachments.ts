// src/server/db/schema/case-email-reply-attachments.ts
import { pgTable, uuid, text, integer, index, timestamp } from "drizzle-orm/pg-core";
import { caseEmailReplies } from "./case-email-replies";
import { documents } from "./documents";

export const caseEmailReplyAttachments = pgTable(
  "case_email_reply_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    replyId: uuid("reply_id").references(() => caseEmailReplies.id, { onDelete: "cascade" }).notNull(),
    s3Key: text("s3_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    promotedDocumentId: uuid("promoted_document_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_email_reply_attachments_reply_idx").on(table.replyId),
  ],
);

export type CaseEmailReplyAttachment = typeof caseEmailReplyAttachments.$inferSelect;
export type NewCaseEmailReplyAttachment = typeof caseEmailReplyAttachments.$inferInsert;
