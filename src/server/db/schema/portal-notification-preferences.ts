import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { portalUsers } from "./portal-users";

export const portalNotificationPreferences = pgTable(
  "portal_notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portalUserId: uuid("portal_user_id")
      .references(() => portalUsers.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    emailEnabled: boolean("email_enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("portal_notif_pref_user_type_unique").on(table.portalUserId, table.type),
  ],
);
