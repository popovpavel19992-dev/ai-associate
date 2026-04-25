import { pgTable, uuid, text, integer, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseMotionsInLimineSets } from "./case-motions-in-limine-sets";
import { motionInLimineTemplates, type MilCategory } from "./motion-in-limine-templates";

export const MIL_SOURCE = ["library", "manual", "modified"] as const;
export type MilSource = (typeof MIL_SOURCE)[number];

export const caseMotionsInLimine = pgTable(
  "case_motions_in_limine",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .references(() => caseMotionsInLimineSets.id, { onDelete: "cascade" })
      .notNull(),
    milOrder: integer("mil_order").notNull(),
    category: text("category").$type<MilCategory>().notNull(),
    freRule: text("fre_rule"),
    title: text("title").notNull(),
    introduction: text("introduction").notNull(),
    reliefSought: text("relief_sought").notNull(),
    legalAuthority: text("legal_authority").notNull(),
    conclusion: text("conclusion").notNull(),
    source: text("source").$type<MilSource>().notNull().default("manual"),
    sourceTemplateId: uuid("source_template_id").references(
      () => motionInLimineTemplates.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_motions_in_limine_set_idx").on(table.setId, table.milOrder),
    unique("case_motions_in_limine_set_order_unique").on(
      table.setId,
      table.milOrder,
    ),
    check(
      "case_motions_in_limine_category_check",
      sql`${table.category} IN ('exclude_character','exclude_prior_bad_acts','daubert','hearsay','settlement_negotiations','insurance','remedial_measures','authentication','other')`,
    ),
    check(
      "case_motions_in_limine_source_check",
      sql`${table.source} IN ('library','manual','modified')`,
    ),
    check(
      "case_motions_in_limine_order_check",
      sql`${table.milOrder} BETWEEN 1 AND 99`,
    ),
  ],
);

export type CaseMotionInLimine = typeof caseMotionsInLimine.$inferSelect;
export type NewCaseMotionInLimine = typeof caseMotionsInLimine.$inferInsert;
