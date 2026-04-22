import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { caseSignatureRequests } from "./case-signature-requests";

export const caseSignatureRequestEvents = pgTable(
  "case_signature_request_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").references(() => caseSignatureRequests.id, { onDelete: "cascade" }).notNull(),
    eventType: text("event_type").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    eventHash: text("event_hash").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("case_signature_request_events_hash_unique").on(table.eventHash),
    index("case_signature_request_events_request_at_idx").on(table.requestId, table.eventAt),
  ],
);

export type CaseSignatureRequestEvent = typeof caseSignatureRequestEvents.$inferSelect;
export type NewCaseSignatureRequestEvent = typeof caseSignatureRequestEvents.$inferInsert;
