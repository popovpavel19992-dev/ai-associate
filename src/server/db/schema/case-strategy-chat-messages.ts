import {
  pgTable, uuid, text, timestamp, pgEnum, index,
} from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";
import { caseStrategyRuns } from "./case-strategy-runs";

export const strategyChatRoleEnum = pgEnum("strategy_chat_role", [
  "user", "assistant",
]);
export type StrategyChatRole = (typeof strategyChatRoleEnum.enumValues)[number];

export const caseStrategyChatMessages = pgTable(
  "case_strategy_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    role: strategyChatRoleEnum("role").notNull(),
    body: text("body").notNull(),
    referencesRunId: uuid("references_run_id").references(() => caseStrategyRuns.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("case_strategy_chat_case_created_idx").on(t.caseId, t.createdAt),
  ],
);

export type CaseStrategyChatMessage = typeof caseStrategyChatMessages.$inferSelect;
export type NewCaseStrategyChatMessage = typeof caseStrategyChatMessages.$inferInsert;
