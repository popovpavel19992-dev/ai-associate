import { pgTable, uuid, text, integer, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member"]);
export const userPlanEnum = pgEnum("user_plan", ["trial", "solo"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").unique().notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  orgId: uuid("org_id").references(() => organizations.id),
  role: userRoleEnum("role").default("member"),
  practiceAreas: jsonb("practice_areas").$type<string[]>(),
  state: text("state"),
  jurisdiction: text("jurisdiction"),
  caseTypes: jsonb("case_types").$type<string[]>(),
  plan: userPlanEnum("plan").default("trial"),
  subscriptionStatus: text("subscription_status").default("trialing"),
  stripeCustomerId: text("stripe_customer_id"),
  creditsUsedThisMonth: integer("credits_used_this_month").notNull().default(0),
  bio: text("bio"),
  barNumber: text("bar_number"),
  barState: text("bar_state"),
  avatarUrl: text("avatar_url"),
  signatureImageUrl: text("signature_image_url"),
  icalTokenHash: text("ical_token_hash"),
  icalTokenCreatedAt: timestamp("ical_token_created_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
