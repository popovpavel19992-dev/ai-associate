import { pgTable, uuid, text, integer, timestamp, date, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseExhibitLists } from "./case-exhibit-lists";
import { caseWitnesses } from "./case-witnesses";
import { documents } from "./documents";

export const EXHIBIT_DOC_TYPE = [
  "document",
  "photo",
  "video",
  "audio",
  "physical",
  "demonstrative",
  "electronic",
] as const;
export type ExhibitDocType = (typeof EXHIBIT_DOC_TYPE)[number];

export const EXHIBIT_ADMISSION_STATUS = [
  "proposed",
  "pre_admitted",
  "admitted",
  "not_admitted",
  "withdrawn",
  "objected",
] as const;
export type ExhibitAdmissionStatus = (typeof EXHIBIT_ADMISSION_STATUS)[number];

export const caseExhibits = pgTable(
  "case_exhibits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id").references(() => caseExhibitLists.id, { onDelete: "cascade" }).notNull(),
    exhibitOrder: integer("exhibit_order").notNull(),
    exhibitLabel: text("exhibit_label").notNull(),
    description: text("description").notNull(),
    docType: text("doc_type").$type<ExhibitDocType>().notNull().default("document"),
    exhibitDate: date("exhibit_date"),
    sponsoringWitnessId: uuid("sponsoring_witness_id").references(() => caseWitnesses.id, {
      onDelete: "set null",
    }),
    sponsoringWitnessName: text("sponsoring_witness_name"),
    admissionStatus: text("admission_status").$type<ExhibitAdmissionStatus>().notNull().default("proposed"),
    batesRange: text("bates_range"),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_exhibits_list_idx").on(table.listId, table.exhibitOrder),
    unique("case_exhibits_list_order_unique").on(table.listId, table.exhibitOrder),
    unique("case_exhibits_list_label_unique").on(table.listId, table.exhibitLabel),
    check(
      "case_exhibits_doc_type_check",
      sql`${table.docType} IN ('document','photo','video','audio','physical','demonstrative','electronic')`,
    ),
    check(
      "case_exhibits_admission_status_check",
      sql`${table.admissionStatus} IN ('proposed','pre_admitted','admitted','not_admitted','withdrawn','objected')`,
    ),
    check(
      "case_exhibits_order_check",
      sql`${table.exhibitOrder} BETWEEN 1 AND 9999`,
    ),
  ],
);

export type CaseExhibit = typeof caseExhibits.$inferSelect;
export type NewCaseExhibit = typeof caseExhibits.$inferInsert;
