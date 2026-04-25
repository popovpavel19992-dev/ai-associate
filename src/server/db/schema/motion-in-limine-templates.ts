import { pgTable, uuid, text, boolean, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

export const MIL_CATEGORY = [
  "exclude_character",
  "exclude_prior_bad_acts",
  "daubert",
  "hearsay",
  "settlement_negotiations",
  "insurance",
  "remedial_measures",
  "authentication",
  "other",
] as const;
export type MilCategory = (typeof MIL_CATEGORY)[number];

export const motionInLimineTemplates = pgTable(
  "motion_in_limine_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL = global library; non-null scopes to a single org's customized library.
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    category: text("category").$type<MilCategory>().notNull(),
    freRule: text("fre_rule"),
    title: text("title").notNull(),
    introduction: text("introduction").notNull(),
    reliefSought: text("relief_sought").notNull(),
    legalAuthority: text("legal_authority").notNull(),
    conclusion: text("conclusion").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("motion_in_limine_templates_lookup_idx").on(
      table.orgId,
      table.category,
      table.isActive,
    ),
    check(
      "motion_in_limine_templates_category_check",
      sql`${table.category} IN ('exclude_character','exclude_prior_bad_acts','daubert','hearsay','settlement_negotiations','insurance','remedial_measures','authentication','other')`,
    ),
  ],
);

export type MotionInLimineTemplate = typeof motionInLimineTemplates.$inferSelect;
export type NewMotionInLimineTemplate = typeof motionInLimineTemplates.$inferInsert;
