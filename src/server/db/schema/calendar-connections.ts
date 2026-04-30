import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  unique,
  pgEnum,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const calendarProviderEnum = pgEnum("calendar_provider", [
  "google",
  "outlook",
]);

export type CalendarProvider = (typeof calendarProviderEnum.enumValues)[number];

export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    provider: calendarProviderEnum("provider").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    providerEmail: text("provider_email"),
    externalCalendarId: text("external_calendar_id"),
    scope: text("scope"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    encryptionKeyVersion: integer("encryption_key_version")
      .default(1)
      .notNull(),
    syncEnabled: boolean("sync_enabled").default(true).notNull(),
    inboundSyncEnabled: boolean("inbound_sync_enabled")
      .default(true)
      .notNull(),
    syncToken: text("sync_token"),
    deltaLink: text("delta_link"),
    lastInboundSyncAt: timestamp("last_inbound_sync_at", {
      withTimezone: true,
    }),
    inboundSyncError: text("inbound_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("calendar_connections_user_provider_unique").on(t.userId, t.provider),
  ],
);

export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type NewCalendarConnection = typeof calendarConnections.$inferInsert;
