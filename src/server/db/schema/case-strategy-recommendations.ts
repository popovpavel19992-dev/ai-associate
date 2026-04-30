import {
  pgTable, uuid, text, integer, timestamp, jsonb, pgEnum, index,
} from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";
import { caseStrategyRuns } from "./case-strategy-runs";

export const strategyCategoryEnum = pgEnum("strategy_category", [
  "procedural", "discovery", "substantive", "client",
]);
export type StrategyCategory = (typeof strategyCategoryEnum.enumValues)[number];

export const caseStrategyRecommendations = pgTable(
  "case_strategy_recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => caseStrategyRuns.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    category: strategyCategoryEnum("category").notNull(),
    priority: integer("priority").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    citations: jsonb("citations").notNull().default([]),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissedBy: uuid("dismissed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("case_strategy_recs_case_active_idx").on(t.caseId, t.dismissedAt),
  ],
);

export type CaseStrategyRecommendation = typeof caseStrategyRecommendations.$inferSelect;
export type NewCaseStrategyRecommendation = typeof caseStrategyRecommendations.$inferInsert;
