import { pgTable, uuid, text, integer, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";

export const WITNESS_LIST_STATUS = ["draft", "final", "served", "closed"] as const;
export type WitnessListStatus = (typeof WITNESS_LIST_STATUS)[number];

export const WITNESS_LIST_SERVING_PARTY = ["plaintiff", "defendant"] as const;
export type WitnessListServingParty = (typeof WITNESS_LIST_SERVING_PARTY)[number];

export const caseWitnessLists = pgTable(
  "case_witness_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    servingParty: text("serving_party").$type<WitnessListServingParty>().notNull(),
    listNumber: integer("list_number").notNull().default(1),
    title: text("title").notNull(),
    status: text("status").$type<WitnessListStatus>().notNull().default("draft"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    servedAt: timestamp("served_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_witness_lists_case_idx").on(table.caseId, table.status),
    unique("case_witness_lists_case_party_number_unique").on(
      table.caseId,
      table.servingParty,
      table.listNumber,
    ),
    check(
      "case_witness_lists_serving_party_check",
      sql`${table.servingParty} IN ('plaintiff','defendant')`,
    ),
    check(
      "case_witness_lists_status_check",
      sql`${table.status} IN ('draft','final','served','closed')`,
    ),
    check(
      "case_witness_lists_list_number_check",
      sql`${table.listNumber} BETWEEN 1 AND 99`,
    ),
  ],
);

export type CaseWitnessList = typeof caseWitnessLists.$inferSelect;
export type NewCaseWitnessList = typeof caseWitnessLists.$inferInsert;
