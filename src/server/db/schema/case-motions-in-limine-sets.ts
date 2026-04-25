import { pgTable, uuid, text, integer, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";

export const MIL_SET_STATUS = ["draft", "final", "submitted", "closed"] as const;
export type MilSetStatus = (typeof MIL_SET_STATUS)[number];

export const MIL_SET_SERVING_PARTY = ["plaintiff", "defendant"] as const;
export type MilSetServingParty = (typeof MIL_SET_SERVING_PARTY)[number];

export const caseMotionsInLimineSets = pgTable(
  "case_motions_in_limine_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    servingParty: text("serving_party").$type<MilSetServingParty>().notNull(),
    setNumber: integer("set_number").notNull().default(1),
    title: text("title").notNull(),
    status: text("status").$type<MilSetStatus>().notNull().default("draft"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_motions_in_limine_sets_case_idx").on(table.caseId, table.status),
    unique("case_motions_in_limine_sets_case_party_number_unique").on(
      table.caseId,
      table.servingParty,
      table.setNumber,
    ),
    check(
      "case_motions_in_limine_sets_serving_party_check",
      sql`${table.servingParty} IN ('plaintiff','defendant')`,
    ),
    check(
      "case_motions_in_limine_sets_status_check",
      sql`${table.status} IN ('draft','final','submitted','closed')`,
    ),
    check(
      "case_motions_in_limine_sets_set_number_check",
      sql`${table.setNumber} BETWEEN 1 AND 99`,
    ),
  ],
);

export type CaseMotionsInLimineSet = typeof caseMotionsInLimineSets.$inferSelect;
export type NewCaseMotionsInLimineSet = typeof caseMotionsInLimineSets.$inferInsert;
