import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { portalUsers } from "./portal-users";

export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portalUserId: uuid("portal_user_id")
      .references(() => portalUsers.id, { onDelete: "cascade" })
      .notNull(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("portal_sessions_token_idx").on(table.token),
    index("portal_sessions_portal_user_idx").on(table.portalUserId),
  ],
);
