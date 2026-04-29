// src/server/db/schema/case-generated-documents.ts
//
// Phase 3.12 — instances rendered from a document_templates row.
// Either case_id OR client_id (or both) must be set; the row scopes to a case
// when generated from inside one, or to a client for pre-case docs (e.g. an
// initial retainer signed before a matter is opened).

import { pgTable, uuid, text, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { clients } from "./clients";
import { users } from "./users";
import { documentTemplates } from "./document-templates";
import type { DocumentTemplateCategory } from "./document-templates";

export type GeneratedDocumentStatus = "draft" | "finalized" | "sent" | "superseded";

export const caseGeneratedDocuments = pgTable(
  "case_generated_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => documentTemplates.id, { onDelete: "set null" }),
    category: text("category").$type<DocumentTemplateCategory>().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    variablesFilled: jsonb("variables_filled").$type<Record<string, string>>().notNull().default({}),
    status: text("status").$type<GeneratedDocumentStatus>().notNull().default("draft"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_generated_documents_case_idx").on(table.caseId, table.createdAt),
    index("case_generated_documents_client_idx").on(table.clientId, table.createdAt),
    index("case_generated_documents_org_idx").on(table.orgId, table.createdAt),
    check(
      "case_generated_documents_status_check",
      sql`${table.status} IN ('draft','finalized','sent','superseded')`,
    ),
    check(
      "case_generated_documents_scope_check",
      sql`(${table.caseId} IS NOT NULL) OR (${table.clientId} IS NOT NULL)`,
    ),
  ],
);

export type CaseGeneratedDocument = typeof caseGeneratedDocuments.$inferSelect;
export type NewCaseGeneratedDocument = typeof caseGeneratedDocuments.$inferInsert;
