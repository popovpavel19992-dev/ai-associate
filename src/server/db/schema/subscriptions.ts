import { pgTable, uuid, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  orgId: uuid("org_id").references(() => organizations.id),
  stripeSubscriptionId: text("stripe_subscription_id").unique().notNull(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  plan: text("plan").notNull(),
  status: text("status").notNull().default("active"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("owner_check", sql`${table.userId} IS NOT NULL OR ${table.orgId} IS NOT NULL`),
]);
