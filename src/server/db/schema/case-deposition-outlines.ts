import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  date,
  index,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";
import type { DeponentRole } from "./deposition-topic-templates";

export const DEPOSITION_OUTLINE_STATUS = ["draft", "finalized"] as const;
export type DepositionOutlineStatus = (typeof DEPOSITION_OUTLINE_STATUS)[number];

export const DEPOSITION_OUTLINE_SERVING_PARTY = ["plaintiff", "defendant"] as const;
export type DepositionOutlineServingParty =
  (typeof DEPOSITION_OUTLINE_SERVING_PARTY)[number];

export const caseDepositionOutlines = pgTable(
  "case_deposition_outlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    servingParty: text("serving_party")
      .$type<DepositionOutlineServingParty>()
      .notNull(),
    deponentName: text("deponent_name").notNull(),
    deponentRole: text("deponent_role").$type<DeponentRole>().notNull(),
    scheduledDate: date("scheduled_date"),
    location: text("location"),
    outlineNumber: integer("outline_number").notNull().default(1),
    title: text("title").notNull(),
    status: text("status")
      .$type<DepositionOutlineStatus>()
      .notNull()
      .default("draft"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_deposition_outlines_case_idx").on(table.caseId, table.status),
    unique("case_deposition_outlines_case_deponent_number_unique").on(
      table.caseId,
      table.deponentName,
      table.outlineNumber,
    ),
    check(
      "case_deposition_outlines_serving_party_check",
      sql`${table.servingParty} IN ('plaintiff','defendant')`,
    ),
    check(
      "case_deposition_outlines_role_check",
      sql`${table.deponentRole} IN ('party_witness','expert','opposing_party','third_party','custodian','other')`,
    ),
    check(
      "case_deposition_outlines_status_check",
      sql`${table.status} IN ('draft','finalized')`,
    ),
    check(
      "case_deposition_outlines_outline_number_check",
      sql`${table.outlineNumber} BETWEEN 1 AND 99`,
    ),
  ],
);

export type CaseDepositionOutline = typeof caseDepositionOutlines.$inferSelect;
export type NewCaseDepositionOutline = typeof caseDepositionOutlines.$inferInsert;
