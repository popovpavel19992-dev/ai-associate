import { pgTable, uuid, text, date, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { caseWitnesses } from "./case-witnesses";
import { documents } from "./documents";
import { users } from "./users";

export const STATEMENT_KIND = [
  "deposition",
  "declaration",
  "affidavit",
  "rfa_response",
  "rog_response",
  "prior_testimony",
  "recorded_statement",
  "other",
] as const;
export type StatementKind = (typeof STATEMENT_KIND)[number];

export const caseWitnessStatements = pgTable(
  "case_witness_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    witnessId: uuid("witness_id").references(() => caseWitnesses.id, { onDelete: "cascade" }).notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),

    statementKind: text("statement_kind").$type<StatementKind>().notNull(),
    statementDate: date("statement_date"),
    notes: text("notes"),

    attachedBy: uuid("attached_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cws_witness_doc_uq").on(table.witnessId, table.documentId),
    index("cws_witness_idx").on(table.witnessId, table.createdAt),
    index("cws_case_idx").on(table.caseId),
    check(
      "cws_kind_check",
      sql`${table.statementKind} IN ('deposition','declaration','affidavit','rfa_response','rog_response','prior_testimony','recorded_statement','other')`,
    ),
  ],
);

export type CaseWitnessStatement = typeof caseWitnessStatements.$inferSelect;
export type NewCaseWitnessStatement = typeof caseWitnessStatements.$inferInsert;
