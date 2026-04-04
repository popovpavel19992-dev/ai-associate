import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { documents } from "./documents";

export const contractStatusEnum = pgEnum("contract_status", ["draft", "uploading", "extracting", "analyzing", "ready", "failed"]);
export const clauseTypeEnum = pgEnum("clause_type", ["standard", "unusual", "favorable", "unfavorable"]);
export const clauseRiskLevelEnum = pgEnum("clause_risk_level", ["critical", "warning", "info", "ok"]);

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  orgId: uuid("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  status: contractStatusEnum("status").default("draft").notNull(),
  detectedContractType: text("detected_contract_type"),
  overrideContractType: text("override_contract_type"),
  linkedCaseId: uuid("linked_case_id").references(() => cases.id, { onDelete: "set null" }),
  sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "set null" }),
  s3Key: text("s3_key").notNull(),
  filename: text("filename").notNull(),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  checksumSha256: text("checksum_sha256"),
  pageCount: integer("page_count"),
  extractedText: text("extracted_text"),
  riskScore: integer("risk_score"),
  selectedSections: jsonb("selected_sections").$type<string[]>(),
  sectionsLocked: boolean("sections_locked").default(false).notNull(),
  analysisSections: jsonb("analysis_sections"),
  creditsConsumed: integer("credits_consumed").default(2),
  deleteAt: timestamp("delete_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contractClauses = pgTable("contract_clauses", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "cascade" }).notNull(),
  clauseNumber: text("clause_number"),
  title: text("title"),
  originalText: text("original_text"),
  clauseType: clauseTypeEnum("clause_type"),
  riskLevel: clauseRiskLevelEnum("risk_level"),
  summary: text("summary"),
  annotation: text("annotation"),
  suggestedEdit: text("suggested_edit"),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
