// src/server/db/schema/suggested-time-entries.ts
//
// Phase 3.9 — Sessionized rollups of case_activity_events that the
// lawyer can accept (creating a real time_entries row), edit & accept,
// or dismiss.

import { pgTable, uuid, text, integer, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { cases } from "./cases";
import { timeEntries } from "./time-entries";

export const SUGGESTED_TIME_ENTRY_STATUSES = [
  "pending",
  "accepted",
  "dismissed",
  "edited_accepted",
] as const;

export type SuggestedTimeEntryStatus = (typeof SUGGESTED_TIME_ENTRY_STATUSES)[number];

export const suggestedTimeEntries = pgTable(
  "suggested_time_entries",
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
    sessionStartedAt: timestamp("session_started_at", { withTimezone: true }).notNull(),
    sessionEndedAt: timestamp("session_ended_at", { withTimezone: true }).notNull(),
    totalMinutes: integer("total_minutes").notNull(),
    suggestedDescription: text("suggested_description").notNull(),
    sourceEventIds: jsonb("source_event_ids").$type<string[]>().notNull().default([]),
    status: text("status").$type<SuggestedTimeEntryStatus>().notNull().default("pending"),
    acceptedTimeEntryId: uuid("accepted_time_entry_id").references(() => timeEntries.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("suggested_time_entries_user_status_idx").on(
      table.userId,
      table.status,
      table.sessionStartedAt,
    ),
    index("suggested_time_entries_case_idx").on(table.caseId, table.sessionStartedAt),
    unique("suggested_time_entries_unique_session").on(table.userId, table.sessionStartedAt),
  ],
);

export type SuggestedTimeEntry = typeof suggestedTimeEntries.$inferSelect;
export type NewSuggestedTimeEntry = typeof suggestedTimeEntries.$inferInsert;
