import { pgTable, uuid, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const orgPlanEnum = pgEnum("org_plan", ["small_firm", "firm_plus"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active", "past_due", "cancelled", "trialing",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  clerkOrgId: text("clerk_org_id").unique(),
  ownerUserId: uuid("owner_user_id").notNull(),
  plan: orgPlanEnum("plan").notNull(),
  maxSeats: integer("max_seats").notNull().default(5),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionStatus: subscriptionStatusEnum("subscription_status").default("active"),
  creditsUsedThisMonth: integer("credits_used_this_month").notNull().default(0),
  creditsLimit: integer("credits_limit").notNull().default(200),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
