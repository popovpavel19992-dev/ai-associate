import {
  pgTable, uuid, text, integer, timestamp, jsonb, pgEnum, index,
} from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { organizations } from "./organizations";
import { users } from "./users";

export const strategyRunStatusEnum = pgEnum("strategy_run_status", [
  "pending", "succeeded", "failed",
]);
export type StrategyRunStatus = (typeof strategyRunStatusEnum.enumValues)[number];

export const caseStrategyRuns = pgTable(
  "case_strategy_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    triggeredBy: uuid("triggered_by").references(() => users.id).notNull(),
    status: strategyRunStatusEnum("status").notNull().default("pending"),
    inputHash: text("input_hash"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    creditsCharged: integer("credits_charged").notNull().default(0),
    modelVersion: text("model_version").notNull(),
    rawResponse: jsonb("raw_response"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("case_strategy_runs_case_started_idx").on(t.caseId, t.startedAt),
  ],
);

export type CaseStrategyRun = typeof caseStrategyRuns.$inferSelect;
export type NewCaseStrategyRun = typeof caseStrategyRuns.$inferInsert;
