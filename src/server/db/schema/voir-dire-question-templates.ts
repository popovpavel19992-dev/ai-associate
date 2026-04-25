import { pgTable, uuid, text, boolean, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

export const VOIR_DIRE_CATEGORY = [
  "background",
  "employment",
  "prior_jury_experience",
  "attitudes_bias",
  "case_specific",
  "follow_up",
] as const;
export type VoirDireCategory = (typeof VOIR_DIRE_CATEGORY)[number];

export const voirDireQuestionTemplates = pgTable(
  "voir_dire_question_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL = global library; non-null scopes to a single org's customized library.
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    category: text("category").$type<VoirDireCategory>().notNull(),
    caseType: text("case_type"),
    text: text("text").notNull(),
    followUpPrompt: text("follow_up_prompt"),
    isForCause: boolean("is_for_cause").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("voir_dire_question_templates_lookup_idx").on(
      table.orgId,
      table.category,
      table.isActive,
    ),
    check(
      "voir_dire_question_templates_category_check",
      sql`${table.category} IN ('background','employment','prior_jury_experience','attitudes_bias','case_specific','follow_up')`,
    ),
  ],
);

export type VoirDireQuestionTemplate = typeof voirDireQuestionTemplates.$inferSelect;
export type NewVoirDireQuestionTemplate = typeof voirDireQuestionTemplates.$inferInsert;
