// src/server/db/schema/bulk-action-logs.ts
//
// Phase 3.15 — Audit log for bulk operations on cases.

import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";

export const BULK_ACTION_TYPES = [
  "archive",
  "reassign_lead",
  "export_csv",
  "restore",
] as const;
export type BulkActionType = (typeof BULK_ACTION_TYPES)[number];

export const bulkActionLogs = pgTable(
  "bulk_action_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    performedBy: uuid("performed_by")
      .references(() => users.id)
      .notNull(),
    actionType: text("action_type").$type<BulkActionType>().notNull(),
    targetCaseIds: jsonb("target_case_ids").$type<string[]>().notNull().default([]),
    targetCount: integer("target_count").notNull(),
    parameters: jsonb("parameters").$type<Record<string, unknown> | null>(),
    summary: text("summary"),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("bulk_action_logs_org_idx").on(table.orgId, table.performedAt),
    check(
      "bulk_action_logs_action_type_check",
      sql`${table.actionType} IN ('archive','reassign_lead','export_csv','restore')`,
    ),
  ],
);

export type BulkActionLog = typeof bulkActionLogs.$inferSelect;
export type NewBulkActionLog = typeof bulkActionLogs.$inferInsert;
