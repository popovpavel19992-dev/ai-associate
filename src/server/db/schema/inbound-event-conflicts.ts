import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { externalInboundEvents } from "./external-inbound-events";
import { caseCalendarEvents } from "./case-calendar-events";
import { users } from "./users";

export const conflictResolutionEnum = pgEnum("inbound_conflict_resolution", [
  "open",
  "dismissed",
  "rescheduled",
]);

export type ConflictResolution =
  (typeof conflictResolutionEnum.enumValues)[number];

export const inboundEventConflicts = pgTable(
  "inbound_event_conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    inboundEventId: uuid("inbound_event_id")
      .references(() => externalInboundEvents.id, { onDelete: "cascade" })
      .notNull(),
    caseEventId: uuid("case_event_id")
      .references(() => caseCalendarEvents.id, { onDelete: "cascade" })
      .notNull(),
    overlapStartsAt: timestamp("overlap_starts_at", {
      withTimezone: true,
    }).notNull(),
    overlapEndsAt: timestamp("overlap_ends_at", {
      withTimezone: true,
    }).notNull(),
    resolution: conflictResolutionEnum("resolution")
      .notNull()
      .default("open"),
    resolutionNote: text("resolution_note"),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    unique("inbound_event_conflicts_pair_unique").on(
      t.inboundEventId,
      t.caseEventId,
    ),
    index("inbound_event_conflicts_user_open_idx").on(
      t.userId,
      t.resolution,
    ),
  ],
);

export type InboundEventConflict = typeof inboundEventConflicts.$inferSelect;
export type NewInboundEventConflict =
  typeof inboundEventConflicts.$inferInsert;
