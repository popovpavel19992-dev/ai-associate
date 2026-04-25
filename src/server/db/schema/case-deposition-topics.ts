import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseDepositionOutlines } from "./case-deposition-outlines";
import type { DepositionTopicCategory } from "./deposition-topic-templates";

export const caseDepositionTopics = pgTable(
  "case_deposition_topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outlineId: uuid("outline_id")
      .references(() => caseDepositionOutlines.id, { onDelete: "cascade" })
      .notNull(),
    topicOrder: integer("topic_order").notNull(),
    category: text("category").$type<DepositionTopicCategory>().notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_deposition_topics_outline_idx").on(
      table.outlineId,
      table.topicOrder,
    ),
    unique("case_deposition_topics_outline_order_unique").on(
      table.outlineId,
      table.topicOrder,
    ),
    check(
      "case_deposition_topics_category_check",
      sql`${table.category} IN ('background','foundation','key_facts','documents','admissions','damages','wrap_up','custom')`,
    ),
    check(
      "case_deposition_topics_order_check",
      sql`${table.topicOrder} BETWEEN 1 AND 999`,
    ),
  ],
);

export type CaseDepositionTopic = typeof caseDepositionTopics.$inferSelect;
export type NewCaseDepositionTopic = typeof caseDepositionTopics.$inferInsert;
