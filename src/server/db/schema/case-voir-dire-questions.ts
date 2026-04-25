import { pgTable, uuid, text, integer, boolean, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseVoirDireSets } from "./case-voir-dire-sets";
import { voirDireQuestionTemplates } from "./voir-dire-question-templates";

export const VOIR_DIRE_SOURCE = ["library", "manual", "modified"] as const;
export type VoirDireSource = (typeof VOIR_DIRE_SOURCE)[number];

export const VOIR_DIRE_PANEL_TARGET = ["all", "individual"] as const;
export type VoirDirePanelTarget = (typeof VOIR_DIRE_PANEL_TARGET)[number];

export const VOIR_DIRE_QUESTION_CATEGORY = [
  "background",
  "employment",
  "prior_jury_experience",
  "attitudes_bias",
  "case_specific",
  "follow_up",
] as const;
export type VoirDireQuestionCategory = (typeof VOIR_DIRE_QUESTION_CATEGORY)[number];

export const caseVoirDireQuestions = pgTable(
  "case_voir_dire_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .references(() => caseVoirDireSets.id, { onDelete: "cascade" })
      .notNull(),
    questionOrder: integer("question_order").notNull(),
    category: text("category").$type<VoirDireQuestionCategory>().notNull(),
    text: text("text").notNull(),
    followUpPrompt: text("follow_up_prompt"),
    isForCause: boolean("is_for_cause").notNull().default(false),
    jurorPanelTarget: text("juror_panel_target")
      .$type<VoirDirePanelTarget>()
      .notNull()
      .default("all"),
    source: text("source").$type<VoirDireSource>().notNull().default("manual"),
    sourceTemplateId: uuid("source_template_id").references(
      () => voirDireQuestionTemplates.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_voir_dire_questions_set_idx").on(table.setId, table.questionOrder),
    unique("case_voir_dire_questions_set_order_unique").on(
      table.setId,
      table.questionOrder,
    ),
    check(
      "case_voir_dire_questions_category_check",
      sql`${table.category} IN ('background','employment','prior_jury_experience','attitudes_bias','case_specific','follow_up')`,
    ),
    check(
      "case_voir_dire_questions_source_check",
      sql`${table.source} IN ('library','manual','modified')`,
    ),
    check(
      "case_voir_dire_questions_target_check",
      sql`${table.jurorPanelTarget} IN ('all','individual')`,
    ),
    check(
      "case_voir_dire_questions_order_check",
      sql`${table.questionOrder} BETWEEN 1 AND 9999`,
    ),
  ],
);

export type CaseVoirDireQuestion = typeof caseVoirDireQuestions.$inferSelect;
export type NewCaseVoirDireQuestion = typeof caseVoirDireQuestions.$inferInsert;
