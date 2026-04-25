import { pgTable, uuid, text, integer, timestamp, jsonb, date, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";
import { caseDiscoveryRequests } from "./case-discovery-requests";

export const PRIVILEGE_BASIS_VALUES = [
  "attorney_client",
  "work_product",
  "common_interest",
  "joint_defense",
  "other",
] as const;

export type PrivilegeBasis = (typeof PRIVILEGE_BASIS_VALUES)[number];

export const casePrivilegeLogEntries = pgTable(
  "case_privilege_log_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    relatedRequestId: uuid("related_request_id").references(() => caseDiscoveryRequests.id, {
      onDelete: "set null",
    }),
    entryNumber: integer("entry_number").notNull(),
    documentDate: date("document_date"),
    documentType: text("document_type"),
    author: text("author"),
    recipients: jsonb("recipients").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    cc: jsonb("cc").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    subject: text("subject"),
    description: text("description"),
    privilegeBasis: text("privilege_basis").$type<PrivilegeBasis>().notNull(),
    basisExplanation: text("basis_explanation"),
    withheldBy: text("withheld_by").$type<"plaintiff" | "defendant">().notNull(),
    batesRange: text("bates_range"),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_privilege_log_entries_case_idx").on(table.caseId, table.entryNumber),
    index("case_privilege_log_entries_request_idx").on(table.relatedRequestId),
    unique("case_privilege_log_entries_case_number_unique").on(table.caseId, table.entryNumber),
    check(
      "case_privilege_log_entries_basis_check",
      sql`${table.privilegeBasis} IN ('attorney_client','work_product','common_interest','joint_defense','other')`,
    ),
    check(
      "case_privilege_log_entries_withheld_check",
      sql`${table.withheldBy} IN ('plaintiff','defendant')`,
    ),
    check(
      "case_privilege_log_entries_number_check",
      sql`${table.entryNumber} BETWEEN 1 AND 9999`,
    ),
  ],
);

export type CasePrivilegeLogEntry = typeof casePrivilegeLogEntries.$inferSelect;
export type NewCasePrivilegeLogEntry = typeof casePrivilegeLogEntries.$inferInsert;
