// src/server/db/schema/ooo-auto-responses-log.ts
//
// Phase 3.14 — Per-recipient dedup log for auto-responses fired during an OOO
// period. UNIQUE (ooo_period_id, recipient_email) ensures we send at most one
// auto-response per sender per OOO period.

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { userOooPeriods } from "./user-ooo-periods";
import { caseEmailReplies } from "./case-email-replies";

export const oooAutoResponsesLog = pgTable(
  "ooo_auto_responses_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    oooPeriodId: uuid("ooo_period_id")
      .references(() => userOooPeriods.id, { onDelete: "cascade" })
      .notNull(),
    triggerReplyId: uuid("trigger_reply_id").references(
      () => caseEmailReplies.id,
      { onDelete: "set null" },
    ),
    recipientEmail: text("recipient_email").notNull(),
    wasEmergency: boolean("was_emergency").notNull().default(false),
    respondedAt: timestamp("responded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resendMessageId: text("resend_message_id"),
  },
  (table) => [
    unique("ooo_auto_responses_log_period_recipient_unique").on(
      table.oooPeriodId,
      table.recipientEmail,
    ),
    index("ooo_auto_responses_log_ooo_idx").on(
      table.oooPeriodId,
      table.respondedAt,
    ),
  ],
);

export type OooAutoResponseLog = typeof oooAutoResponsesLog.$inferSelect;
export type NewOooAutoResponseLog = typeof oooAutoResponsesLog.$inferInsert;
