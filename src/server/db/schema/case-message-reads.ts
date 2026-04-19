// src/server/db/schema/case-message-reads.ts
import {
  pgTable,
  uuid,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";

export const caseMessageReads = pgTable(
  "case_message_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("case_message_reads_case_user_unique").on(table.caseId, table.userId),
    index("case_message_reads_user_case_idx").on(table.userId, table.caseId),
  ],
);

export type CaseMessageRead = typeof caseMessageReads.$inferSelect;
export type NewCaseMessageRead = typeof caseMessageReads.$inferInsert;
