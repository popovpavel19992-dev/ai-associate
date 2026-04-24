import { pgTable, uuid, text, jsonb, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const motionTemplates = pgTable(
  "motion_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    motionType: text("motion_type").notNull(),
    skeleton: jsonb("skeleton").notNull(),
    sectionPrompts: jsonb("section_prompts").notNull(),
    defaultDeadlineRuleSlugs: text("default_deadline_rule_slugs").array().notNull().default([]),
    active: boolean("active").notNull().default(true),
    supportsMemoSplit: boolean("supports_memo_split").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("motion_templates_org_idx").on(table.orgId),
    unique("motion_templates_slug_unique").on(table.orgId, table.slug),
  ],
);

export type MotionTemplate = typeof motionTemplates.$inferSelect;
export type NewMotionTemplate = typeof motionTemplates.$inferInsert;
