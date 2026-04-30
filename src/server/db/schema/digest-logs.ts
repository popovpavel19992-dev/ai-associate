// src/server/db/schema/digest-logs.ts
// Phase 3.18 — Audit log of digest emails sent.

import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const digestLogs = pgTable(
  "digest_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    subject: text("subject").notNull(),
    preview: text("preview"),
    itemCount: integer("item_count").notNull(),
    aiSummary: text("ai_summary"),
    payload: jsonb("payload"),
    resendMessageId: text("resend_message_id"),
  },
  (table) => [index("digest_logs_user_idx").on(table.userId, table.sentAt)],
);

export type DigestLog = typeof digestLogs.$inferSelect;
export type NewDigestLog = typeof digestLogs.$inferInsert;
