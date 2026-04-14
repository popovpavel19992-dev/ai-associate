import { pgTable, uuid, text, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    notificationType: text("notification_type").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
  },
  (table) => [
    uniqueIndex("notification_prefs_user_type_channel_unique").on(
      table.userId,
      table.notificationType,
      table.channel,
    ),
  ],
);
