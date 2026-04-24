import { pgTable, uuid, text, integer, real, boolean, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseSignatureRequests } from "./case-signature-requests";
import { caseSignatureRequestSigners } from "./case-signature-request-signers";

export const caseSignatureRequestFields = pgTable(
  "case_signature_request_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").references(() => caseSignatureRequests.id, { onDelete: "cascade" }).notNull(),
    signerId: uuid("signer_id").references(() => caseSignatureRequestSigners.id, { onDelete: "cascade" }).notNull(),
    fieldType: text("field_type").notNull(),
    page: integer("page").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    width: real("width").notNull(),
    height: real("height").notNull(),
    required: boolean("required").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_signature_request_fields_request_idx").on(table.requestId),
    check(
      "case_signature_request_fields_type_check",
      sql`${table.fieldType} IN ('signature','date_signed','text','initials')`,
    ),
  ],
);

export type CaseSignatureRequestField = typeof caseSignatureRequestFields.$inferSelect;
export type NewCaseSignatureRequestField = typeof caseSignatureRequestFields.$inferInsert;
