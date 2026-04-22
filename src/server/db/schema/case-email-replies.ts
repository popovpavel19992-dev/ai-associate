// src/server/db/schema/case-email-replies.ts
import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { caseEmailOutreach } from "./case-email-outreach";

export const caseEmailReplies = pgTable(
  "case_email_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outreachId: uuid("outreach_id").references(() => caseEmailOutreach.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    replyKind: text("reply_kind").notNull(),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    subject: text("subject").notNull(),
    bodyText: text("body_text"),
    bodyHtml: text("body_html").notNull(),
    senderMismatch: boolean("sender_mismatch").notNull().default(false),
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    resendEventId: text("resend_event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("case_email_replies_event_id_unique").on(table.resendEventId),
    index("case_email_replies_outreach_received_idx").on(table.outreachId, table.receivedAt),
    index("case_email_replies_case_received_idx").on(table.caseId, table.receivedAt),
    check(
      "case_email_replies_kind_check",
      sql`${table.replyKind} IN ('human','auto_reply')`,
    ),
  ],
);

export type CaseEmailReply = typeof caseEmailReplies.$inferSelect;
export type NewCaseEmailReply = typeof caseEmailReplies.$inferInsert;
