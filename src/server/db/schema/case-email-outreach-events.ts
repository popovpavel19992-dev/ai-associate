// src/server/db/schema/case-email-outreach-events.ts
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseEmailOutreach } from "./case-email-outreach";

export const caseEmailOutreachEvents = pgTable(
  "case_email_outreach_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outreachId: uuid("outreach_id").references(() => caseEmailOutreach.id, { onDelete: "cascade" }).notNull(),
    eventType: text("event_type").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata"),
    resendEventId: text("resend_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("case_email_outreach_events_event_id_unique").on(table.resendEventId),
    index("case_email_outreach_events_outreach_event_idx").on(table.outreachId, table.eventAt),
    check(
      "case_email_outreach_events_type_check",
      sql`${table.eventType} IN ('delivered','opened','clicked','complained')`,
    ),
  ],
);

export type CaseEmailOutreachEvent = typeof caseEmailOutreachEvents.$inferSelect;
export type NewCaseEmailOutreachEvent = typeof caseEmailOutreachEvents.$inferInsert;
