import { pgTable, uuid, text, integer, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";

export const documentStatusEnum = pgEnum("document_status", ["uploading", "extracting", "analyzing", "ready", "failed"]);
export const fileTypeEnum = pgEnum("file_type", ["pdf", "docx", "image"]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  filename: text("filename").notNull(),
  s3Key: text("s3_key").notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  fileType: fileTypeEnum("file_type").notNull(),
  pageCount: integer("page_count"),
  fileSize: integer("file_size").notNull(),
  status: documentStatusEnum("status").default("uploading").notNull(),
  extractedText: text("extracted_text"),
  creditsConsumed: integer("credits_consumed").default(1).notNull(),
  uploadedByPortalUserId: uuid("uploaded_by_portal_user_id"),
  suggestedAttorneyJson: jsonb("suggested_attorney_json"),
  suggestedAttorneyAt: timestamp("suggested_attorney_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
