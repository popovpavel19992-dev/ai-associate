import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { clients } from "./clients";
import { cases } from "./cases";
import { conflictCheckLogs } from "./conflict-check-logs";

export const conflictOverrides = pgTable(
  "conflict_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    caseId: uuid("case_id").references(() => cases.id, {
      onDelete: "cascade",
    }),
    checkLogId: uuid("check_log_id")
      .references(() => conflictCheckLogs.id, { onDelete: "cascade" })
      .notNull(),
    reason: text("reason").notNull(),
    approvedBy: uuid("approved_by")
      .references(() => users.id)
      .notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("conflict_overrides_org_idx").on(
      table.orgId,
      sql`${table.approvedAt} DESC`,
    ),
    check(
      "conflict_overrides_target_check",
      sql`${table.clientId} IS NOT NULL OR ${table.caseId} IS NOT NULL`,
    ),
  ],
);

export type ConflictOverride = typeof conflictOverrides.$inferSelect;
export type NewConflictOverride = typeof conflictOverrides.$inferInsert;
