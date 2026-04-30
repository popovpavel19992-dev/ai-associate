// src/server/db/schema/digest-preferences.ts
// Phase 3.18 — AI Case Digest user preferences.

import { pgTable, uuid, text, boolean, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export type DigestFrequency = "daily" | "weekly" | "off";

export const digestPreferences = pgTable(
  "digest_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    enabled: boolean("enabled").notNull().default(true),
    frequency: text("frequency").$type<DigestFrequency>().notNull().default("daily"),
    deliveryTimeUtc: text("delivery_time_utc").notNull().default("17:00"),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("digest_preferences_active_idx").on(table.enabled, table.frequency, table.deliveryTimeUtc),
    check("digest_preferences_frequency_check", sql`${table.frequency} IN ('daily','weekly','off')`),
    check(
      "digest_preferences_time_check",
      sql`${table.deliveryTimeUtc} ~ '^[0-2][0-9]:[0-5][0-9]$'`,
    ),
  ],
);

export type DigestPreference = typeof digestPreferences.$inferSelect;
export type NewDigestPreference = typeof digestPreferences.$inferInsert;
