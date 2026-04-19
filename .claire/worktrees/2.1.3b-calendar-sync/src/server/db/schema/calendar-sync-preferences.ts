import {
  pgTable,
  uuid,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { calendarConnections } from "./calendar-connections";
import { cases } from "./cases";

export const calendarSyncPreferences = pgTable(
  "calendar_sync_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .references(() => calendarConnections.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    kinds: jsonb("kinds")
      .$type<string[]>()
      .default(["court_date", "filing_deadline", "meeting", "reminder", "other"])
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("calendar_sync_preferences_connection_case_unique").on(
      t.connectionId,
      t.caseId,
    ),
  ],
);

export type CalendarSyncPreference =
  typeof calendarSyncPreferences.$inferSelect;
export type NewCalendarSyncPreference =
  typeof calendarSyncPreferences.$inferInsert;
