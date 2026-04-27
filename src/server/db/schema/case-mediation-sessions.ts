import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  index,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";

export const MEDIATION_SESSION_TYPE = ["initial", "continued", "final"] as const;
export type MediationSessionType = (typeof MEDIATION_SESSION_TYPE)[number];

export const MEDIATION_STATUS = [
  "scheduled",
  "completed",
  "cancelled",
  "rescheduled",
] as const;
export type MediationStatus = (typeof MEDIATION_STATUS)[number];

export const MEDIATION_OUTCOME = [
  "pending",
  "settled",
  "impasse",
  "continued",
] as const;
export type MediationOutcome = (typeof MEDIATION_OUTCOME)[number];

export const caseMediationSessions = pgTable(
  "case_mediation_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    sessionNumber: integer("session_number").notNull(),
    mediatorName: text("mediator_name").notNull(),
    mediatorFirm: text("mediator_firm"),
    mediatorEmail: text("mediator_email"),
    mediatorPhone: text("mediator_phone"),
    scheduledDate: timestamp("scheduled_date", { withTimezone: true }).notNull(),
    location: text("location"),
    sessionType: text("session_type")
      .$type<MediationSessionType>()
      .notNull()
      .default("initial"),
    status: text("status")
      .$type<MediationStatus>()
      .notNull()
      .default("scheduled"),
    outcome: text("outcome")
      .$type<MediationOutcome>()
      .notNull()
      .default("pending"),
    durationMinutes: integer("duration_minutes"),
    costCents: bigint("cost_cents", { mode: "number" }),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("case_mediation_sessions_case_idx").on(
      table.caseId,
      table.scheduledDate,
    ),
    unique("case_mediation_sessions_case_number_unique").on(
      table.caseId,
      table.sessionNumber,
    ),
    check(
      "case_mediation_sessions_type_check",
      sql`${table.sessionType} IN ('initial','continued','final')`,
    ),
    check(
      "case_mediation_sessions_status_check",
      sql`${table.status} IN ('scheduled','completed','cancelled','rescheduled')`,
    ),
    check(
      "case_mediation_sessions_outcome_check",
      sql`${table.outcome} IN ('pending','settled','impasse','continued')`,
    ),
    check(
      "case_mediation_sessions_number_check",
      sql`${table.sessionNumber} BETWEEN 1 AND 99`,
    ),
  ],
);

export type CaseMediationSession = typeof caseMediationSessions.$inferSelect;
export type NewCaseMediationSession =
  typeof caseMediationSessions.$inferInsert;
