import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { portalUsers } from "./portal-users";

export const portalMagicLinks = pgTable(
  "portal_magic_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portalUserId: uuid("portal_user_id")
      .references(() => portalUsers.id, { onDelete: "cascade" })
      .notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("portal_magic_links_user_used_idx").on(table.portalUserId, table.usedAt),
  ],
);
