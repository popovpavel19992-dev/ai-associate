// src/server/db/schema/case-activity-events.ts
//
// Phase 3.9 — Auto-Billable Activity Tracking. Append-only stream of
// in-app activity per (user, case) used to derive suggested time entries.

import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { cases } from "./cases";

export const ACTIVITY_EVENT_TYPES = [
  "case_view",
  "motion_draft",
  "document_read",
  "research_session",
  "discovery_request_edit",
  "email_compose",
  "email_send",
  "signature_request_create",
  "deposition_outline_edit",
  "witness_list_edit",
  "exhibit_list_edit",
  "mil_edit",
  "voir_dire_edit",
  "subpoena_edit",
  "trust_transaction_record",
  "other",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export const caseActivityEvents = pgTable(
  "case_activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    eventType: text("event_type").$type<ActivityEventType>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    contextUrl: text("context_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_activity_events_user_case_started_idx").on(
      table.userId,
      table.caseId,
      table.startedAt,
    ),
    index("case_activity_events_case_started_idx").on(table.caseId, table.startedAt),
  ],
);

export type CaseActivityEvent = typeof caseActivityEvents.$inferSelect;
export type NewCaseActivityEvent = typeof caseActivityEvents.$inferInsert;
