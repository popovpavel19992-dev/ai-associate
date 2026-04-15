import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "./clients";
import { organizations } from "./organizations";
import { users } from "./users";

export const portalUsers = pgTable(
  "portal_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("portal_users_email_org_unique")
      .on(table.email, table.orgId)
      .where(sql`org_id IS NOT NULL`),
    uniqueIndex("portal_users_email_user_unique")
      .on(table.email, table.userId)
      .where(sql`user_id IS NOT NULL`),
    index("portal_users_client_idx").on(table.clientId),
    check("portal_users_scope_check", sql`(org_id IS NOT NULL) != (user_id IS NOT NULL)`),
  ],
);
