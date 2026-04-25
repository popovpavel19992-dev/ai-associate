import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

export const DEPONENT_ROLE = [
  "party_witness",
  "expert",
  "opposing_party",
  "third_party",
  "custodian",
  "other",
] as const;
export type DeponentRole = (typeof DEPONENT_ROLE)[number];

export const DEPOSITION_TOPIC_CATEGORY = [
  "background",
  "foundation",
  "key_facts",
  "documents",
  "admissions",
  "damages",
  "wrap_up",
  "custom",
] as const;
export type DepositionTopicCategory = (typeof DEPOSITION_TOPIC_CATEGORY)[number];

export const depositionTopicTemplates = pgTable(
  "deposition_topic_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL = global library; non-null scopes to a single org's customized library.
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    deponentRole: text("deponent_role").$type<DeponentRole>().notNull(),
    category: text("category").$type<DepositionTopicCategory>().notNull(),
    title: text("title").notNull(),
    questions: jsonb("questions").$type<string[]>().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("deposition_topic_templates_lookup_idx").on(
      table.orgId,
      table.deponentRole,
      table.category,
      table.isActive,
    ),
    check(
      "deposition_topic_templates_role_check",
      sql`${table.deponentRole} IN ('party_witness','expert','opposing_party','third_party','custodian','other')`,
    ),
    check(
      "deposition_topic_templates_category_check",
      sql`${table.category} IN ('background','foundation','key_facts','documents','admissions','damages','wrap_up','custom')`,
    ),
  ],
);

export type DepositionTopicTemplate = typeof depositionTopicTemplates.$inferSelect;
export type NewDepositionTopicTemplate = typeof depositionTopicTemplates.$inferInsert;
