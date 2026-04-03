import { pgTable, uuid, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { cases } from "./cases";

export const documentAnalyses = pgTable("document_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
  sections: jsonb("sections").notNull(),
  userEdits: jsonb("user_edits").$type<Record<string, unknown>>(),
  riskScore: integer("risk_score"),
  modelUsed: text("model_used").notNull(),
  tokensUsed: integer("tokens_used"),
  processingTimeMs: integer("processing_time_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
