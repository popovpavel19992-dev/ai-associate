import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
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

export const SUBPOENA_TYPE = ["testimony", "documents", "both"] as const;
export type SubpoenaType = (typeof SUBPOENA_TYPE)[number];

export const SUBPOENA_ISSUING_PARTY = ["plaintiff", "defendant"] as const;
export type SubpoenaIssuingParty = (typeof SUBPOENA_ISSUING_PARTY)[number];

export const SUBPOENA_STATUS = [
  "draft",
  "issued",
  "served",
  "complied",
  "objected",
  "quashed",
] as const;
export type SubpoenaStatus = (typeof SUBPOENA_STATUS)[number];

export const SUBPOENA_SERVED_METHOD = [
  "personal",
  "mail",
  "email",
  "process_server",
] as const;
export type SubpoenaServedMethod = (typeof SUBPOENA_SERVED_METHOD)[number];

export const caseSubpoenas = pgTable(
  "case_subpoenas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    subpoenaNumber: integer("subpoena_number").notNull(),
    subpoenaType: text("subpoena_type").$type<SubpoenaType>().notNull(),
    issuingParty: text("issuing_party").$type<SubpoenaIssuingParty>().notNull(),
    issuingAttorneyId: uuid("issuing_attorney_id").references(() => users.id, {
      onDelete: "set null",
    }),
    recipientName: text("recipient_name").notNull(),
    recipientAddress: text("recipient_address"),
    recipientEmail: text("recipient_email"),
    recipientPhone: text("recipient_phone"),
    dateIssued: date("date_issued"),
    complianceDate: date("compliance_date"),
    complianceLocation: text("compliance_location"),
    documentsRequested: jsonb("documents_requested")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    testimonyTopics: jsonb("testimony_topics")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    notes: text("notes"),
    status: text("status").$type<SubpoenaStatus>().notNull().default("draft"),
    servedAt: timestamp("served_at", { withTimezone: true }),
    servedByName: text("served_by_name"),
    servedMethod: text("served_method").$type<SubpoenaServedMethod>(),
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
    index("case_subpoenas_case_idx").on(table.caseId, table.status),
    unique("case_subpoenas_case_number_unique").on(
      table.caseId,
      table.subpoenaNumber,
    ),
    check(
      "case_subpoenas_type_check",
      sql`${table.subpoenaType} IN ('testimony','documents','both')`,
    ),
    check(
      "case_subpoenas_issuing_party_check",
      sql`${table.issuingParty} IN ('plaintiff','defendant')`,
    ),
    check(
      "case_subpoenas_status_check",
      sql`${table.status} IN ('draft','issued','served','complied','objected','quashed')`,
    ),
    check(
      "case_subpoenas_served_method_check",
      sql`${table.servedMethod} IS NULL OR ${table.servedMethod} IN ('personal','mail','email','process_server')`,
    ),
    check(
      "case_subpoenas_number_check",
      sql`${table.subpoenaNumber} BETWEEN 1 AND 999`,
    ),
  ],
);

export type CaseSubpoena = typeof caseSubpoenas.$inferSelect;
export type NewCaseSubpoena = typeof caseSubpoenas.$inferInsert;
