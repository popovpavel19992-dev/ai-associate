import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { portalUsers } from "./portal-users";
import { cases } from "./cases";

export const portalNotifications = pgTable(
  "portal_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portalUserId: uuid("portal_user_id")
      .references(() => portalUsers.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    actionUrl: text("action_url"),
    isRead: boolean("is_read").default(false).notNull(),
    dedupKey: text("dedup_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("portal_notif_user_read_created_idx").on(table.portalUserId, table.isRead, table.createdAt.desc()),
    uniqueIndex("portal_notif_dedup_key_unique")
      .on(table.dedupKey)
      .where(sql`dedup_key IS NOT NULL`),
  ],
);

export const portalNotificationSignals = pgTable(
  "portal_notification_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portalUserId: uuid("portal_user_id")
      .references(() => portalUsers.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);
