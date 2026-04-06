import {
  pgTable,
  uuid,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { icalFeeds } from "./ical-feeds";
import { cases } from "./cases";

export const icalFeedPreferences = pgTable(
  "ical_feed_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedId: uuid("feed_id")
      .references(() => icalFeeds.id, { onDelete: "cascade" })
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
    unique("ical_feed_preferences_feed_case_unique").on(t.feedId, t.caseId),
  ],
);

export type IcalFeedPreference = typeof icalFeedPreferences.$inferSelect;
export type NewIcalFeedPreference = typeof icalFeedPreferences.$inferInsert;
