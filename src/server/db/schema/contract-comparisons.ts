import { pgTable, uuid, text, integer, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizations } from "./organizations";
import { contracts, contractClauses } from "./contracts";

export const comparisonStatusEnum = pgEnum("comparison_status", ["draft", "processing", "ready", "failed"]);
export const diffTypeEnum = pgEnum("diff_type", ["added", "removed", "modified", "unchanged"]);
export const impactEnum = pgEnum("impact", ["positive", "negative", "neutral"]);

export const contractComparisons = pgTable("contract_comparisons", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractAId: uuid("contract_a_id").references(() => contracts.id).notNull(),
  contractBId: uuid("contract_b_id").references(() => contracts.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  orgId: uuid("org_id").references(() => organizations.id),
  status: comparisonStatusEnum("status").default("draft").notNull(),
  summary: jsonb("summary"),
  creditsConsumed: integer("credits_consumed").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contractClauseDiffs = pgTable("contract_clause_diffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  comparisonId: uuid("comparison_id").references(() => contractComparisons.id, { onDelete: "cascade" }).notNull(),
  clauseAId: uuid("clause_a_id").references(() => contractClauses.id),
  clauseBId: uuid("clause_b_id").references(() => contractClauses.id),
  diffType: diffTypeEnum("diff_type"),
  impact: impactEnum("impact"),
  title: text("title"),
  description: text("description"),
  recommendation: text("recommendation"),
  sortOrder: integer("sort_order"),
});
