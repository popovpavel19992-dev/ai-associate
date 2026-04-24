import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { documents } from "./documents";

export const caseSignatureRequests = pgTable(
  "case_signature_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    templateId: text("template_id"),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    message: text("message"),
    requiresCountersign: boolean("requires_countersign").notNull().default(true),
    signingOrder: text("signing_order").notNull().default("parallel"),
    status: text("status").notNull(),
    hellosignRequestId: text("hellosign_request_id"),
    signedDocumentId: uuid("signed_document_id").references(() => documents.id, { onDelete: "set null" }),
    certificateS3Key: text("certificate_s3_key"),
    testMode: boolean("test_mode").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declinedReason: text("declined_reason"),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_signature_requests_case_created_idx").on(table.caseId, table.createdAt),
    uniqueIndex("case_signature_requests_hellosign_id_unique").on(table.hellosignRequestId),
    check(
      "case_signature_requests_status_check",
      sql`${table.status} IN ('draft','sent','in_progress','completed','declined','expired','cancelled')`,
    ),
    check(
      "case_signature_requests_signing_order_check",
      sql`${table.signingOrder} IN ('parallel','sequential')`,
    ),
  ],
);

export type CaseSignatureRequest = typeof caseSignatureRequests.$inferSelect;
export type NewCaseSignatureRequest = typeof caseSignatureRequests.$inferInsert;
