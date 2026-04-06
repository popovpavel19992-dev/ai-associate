import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  unique,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseCalendarEvents } from "./case-calendar-events";
import { calendarConnections } from "./calendar-connections";

export const syncStatusEnum = pgEnum("sync_status", [
  "pending",
  "synced",
  "failed",
]);

export type SyncStatus = (typeof syncStatusEnum.enumValues)[number];

export const calendarSyncLog = pgTable(
  "calendar_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .references(() => caseCalendarEvents.id, { onDelete: "cascade" })
      .notNull(),
    connectionId: uuid("connection_id")
      .references(() => calendarConnections.id, { onDelete: "cascade" })
      .notNull(),
    externalEventId: text("external_event_id"),
    status: syncStatusEnum("status").notNull().default("pending"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("calendar_sync_log_event_connection_unique").on(
      t.eventId,
      t.connectionId,
    ),
    index("idx_sync_log_pending")
      .on(t.status, t.retryCount)
      .where(sql`status IN ('pending', 'failed')`),
    index("idx_sync_log_connection").on(t.connectionId),
  ],
);

export type CalendarSyncLogEntry = typeof calendarSyncLog.$inferSelect;
export type NewCalendarSyncLogEntry = typeof calendarSyncLog.$inferInsert;
