import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";
import { cases } from "./cases";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    actionUrl: text("action_url"),
    dedupKey: text("dedup_key"),
    isRead: boolean("is_read").default(false).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notifications_user_read_created_idx").on(table.userId, table.isRead, table.createdAt.desc()),
    index("notifications_user_type_created_idx").on(table.userId, table.type, table.createdAt.desc()),
    index("notifications_user_created_idx").on(table.userId, table.createdAt.desc()),
    uniqueIndex("notifications_dedup_key_unique")
      .on(table.dedupKey)
      .where(sql`dedup_key IS NOT NULL`),
  ],
);

export const notificationSignals = pgTable("notification_signals", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastSignalAt: timestamp("last_signal_at", { withTimezone: true }).defaultNow().notNull(),
});
