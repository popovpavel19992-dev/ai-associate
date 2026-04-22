// src/server/db/schema/case-email-outreach.ts
import { pgTable, uuid, text, timestamp, boolean, integer, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { emailTemplates } from "./email-templates";

export const caseEmailOutreach = pgTable(
  "case_email_outreach",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    templateId: uuid("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
    sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    subject: text("subject").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    bodyHtml: text("body_html").notNull(),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    resendId: text("resend_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    bounceReason: text("bounce_reason"),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    lawyerLastSeenRepliesAt: timestamp("lawyer_last_seen_replies_at", { withTimezone: true }),
    trackingEnabled: boolean("tracking_enabled").notNull().default(false),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    firstClickedAt: timestamp("first_clicked_at", { withTimezone: true }),
    lastClickedAt: timestamp("last_clicked_at", { withTimezone: true }),
    clickCount: integer("click_count").notNull().default(0),
    complainedAt: timestamp("complained_at", { withTimezone: true }),
  },
  (table) => [
    index("case_email_outreach_case_created_idx").on(table.caseId, table.createdAt),
    check(
      "case_email_outreach_status_check",
      sql`${table.status} IN ('sent','failed')`,
    ),
  ],
);

export type CaseEmailOutreach = typeof caseEmailOutreach.$inferSelect;
export type NewCaseEmailOutreach = typeof caseEmailOutreach.$inferInsert;
