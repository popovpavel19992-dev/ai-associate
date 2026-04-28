import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { clients } from "./clients";
import { cases } from "./cases";

export const CONFLICT_SEVERITY = ["HIGH", "MEDIUM", "LOW"] as const;
export type ConflictSeverity = (typeof CONFLICT_SEVERITY)[number];

export const CONFLICT_CHECK_CONTEXT = [
  "client_create",
  "case_create",
  "manual_check",
] as const;
export type ConflictCheckContext = (typeof CONFLICT_CHECK_CONTEXT)[number];

export const CONFLICT_HIT_SOURCE = [
  "client",
  "opposing_party",
  "opposing_counsel",
  "witness",
  "subpoena_recipient",
  "mediator",
  "demand_recipient",
] as const;
export type ConflictHitSource = (typeof CONFLICT_HIT_SOURCE)[number];

export const CONFLICT_MATCH_TYPE = ["exact", "fuzzy", "token_overlap"] as const;
export type ConflictMatchType = (typeof CONFLICT_MATCH_TYPE)[number];

export interface StoredConflictHit {
  source: ConflictHitSource;
  matchedName: string;
  matchedValue: string;
  severity: ConflictSeverity;
  similarity: number;
  matchType: ConflictMatchType;
  caseId?: string;
  caseName?: string;
}

export const conflictCheckLogs = pgTable(
  "conflict_check_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    performedBy: uuid("performed_by")
      .references(() => users.id)
      .notNull(),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    queryName: text("query_name").notNull(),
    queryEmail: text("query_email"),
    queryAddress: text("query_address"),
    hitsFound: integer("hits_found").notNull().default(0),
    highestSeverity: text("highest_severity").$type<ConflictSeverity | null>(),
    hits: jsonb("hits")
      .$type<StoredConflictHit[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    context: text("context").$type<ConflictCheckContext>().notNull(),
    resultedInCreation: boolean("resulted_in_creation").notNull().default(false),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    caseId: uuid("case_id").references(() => cases.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("conflict_check_logs_org_idx").on(
      table.orgId,
      sql`${table.performedAt} DESC`,
    ),
    check(
      "conflict_check_logs_severity_check",
      sql`${table.highestSeverity} IS NULL OR ${table.highestSeverity} IN ('HIGH','MEDIUM','LOW')`,
    ),
    check(
      "conflict_check_logs_context_check",
      sql`${table.context} IN ('client_create','case_create','manual_check')`,
    ),
  ],
);

export type ConflictCheckLog = typeof conflictCheckLogs.$inferSelect;
export type NewConflictCheckLog = typeof conflictCheckLogs.$inferInsert;
