import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { calendarConnections } from "./calendar-connections";

export const externalInboundEvents = pgTable(
  "external_inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .references(() => calendarConnections.id, { onDelete: "cascade" })
      .notNull(),
    externalEventId: text("external_event_id").notNull(),
    externalEtag: text("external_etag"),
    title: text("title"),
    description: text("description"),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    isAllDay: text("is_all_day"),
    status: text("status"),
    raw: jsonb("raw"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("external_inbound_events_conn_ext_unique").on(
      t.connectionId,
      t.externalEventId,
    ),
    index("external_inbound_events_window_idx").on(
      t.connectionId,
      t.startsAt,
      t.endsAt,
    ),
  ],
);

export type ExternalInboundEvent = typeof externalInboundEvents.$inferSelect;
export type NewExternalInboundEvent =
  typeof externalInboundEvents.$inferInsert;
