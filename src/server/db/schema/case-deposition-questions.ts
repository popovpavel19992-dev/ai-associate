import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseDepositionTopics } from "./case-deposition-topics";
import { depositionTopicTemplates } from "./deposition-topic-templates";

export const DEPOSITION_QUESTION_SOURCE = [
  "library",
  "manual",
  "ai",
  "modified",
] as const;
export type DepositionQuestionSource = (typeof DEPOSITION_QUESTION_SOURCE)[number];

export const DEPOSITION_QUESTION_PRIORITY = [
  "must_ask",
  "important",
  "optional",
] as const;
export type DepositionQuestionPriority = (typeof DEPOSITION_QUESTION_PRIORITY)[number];

export const caseDepositionQuestions = pgTable(
  "case_deposition_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id")
      .references(() => caseDepositionTopics.id, { onDelete: "cascade" })
      .notNull(),
    questionOrder: integer("question_order").notNull(),
    text: text("text").notNull(),
    expectedAnswer: text("expected_answer"),
    notes: text("notes"),
    source: text("source")
      .$type<DepositionQuestionSource>()
      .notNull()
      .default("manual"),
    sourceTemplateId: uuid("source_template_id").references(
      () => depositionTopicTemplates.id,
      { onDelete: "set null" },
    ),
    exhibitRefs: jsonb("exhibit_refs").$type<string[]>().notNull().default([]),
    priority: text("priority")
      .$type<DepositionQuestionPriority>()
      .notNull()
      .default("important"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_deposition_questions_topic_idx").on(
      table.topicId,
      table.questionOrder,
    ),
    unique("case_deposition_questions_topic_order_unique").on(
      table.topicId,
      table.questionOrder,
    ),
    check(
      "case_deposition_questions_source_check",
      sql`${table.source} IN ('library','manual','ai','modified')`,
    ),
    check(
      "case_deposition_questions_priority_check",
      sql`${table.priority} IN ('must_ask','important','optional')`,
    ),
    check(
      "case_deposition_questions_order_check",
      sql`${table.questionOrder} BETWEEN 1 AND 999`,
    ),
  ],
);

export type CaseDepositionQuestion = typeof caseDepositionQuestions.$inferSelect;
export type NewCaseDepositionQuestion = typeof caseDepositionQuestions.$inferInsert;
