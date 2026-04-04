import { pgTable, uuid, text, integer, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { contracts, clauseTypeEnum } from "./contracts";

export const draftStatusEnum = pgEnum("draft_status", ["draft", "generating", "ready", "failed"]);

export const contractDrafts = pgTable("contract_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  orgId: uuid("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  status: draftStatusEnum("status").default("draft").notNull(),
  contractType: text("contract_type").notNull(),
  partyA: text("party_a").notNull(),
  partyARole: text("party_a_role").default("Client"),
  partyB: text("party_b").notNull(),
  partyBRole: text("party_b_role").default("Counterparty"),
  jurisdiction: text("jurisdiction"),
  keyTerms: text("key_terms"),
  specialInstructions: text("special_instructions"),
  linkedCaseId: uuid("linked_case_id").references(() => cases.id, { onDelete: "set null" }),
  referenceContractId: uuid("reference_contract_id").references(() => contracts.id, { onDelete: "set null" }),
  referenceS3Key: text("reference_s3_key"),
  referenceFilename: text("reference_filename"),
  generatedText: text("generated_text"),
  generationParams: jsonb("generation_params"),
  creditsConsumed: integer("credits_consumed").default(3),
  deleteAt: timestamp("delete_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const draftClauses = pgTable("draft_clauses", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id").references(() => contractDrafts.id, { onDelete: "cascade" }).notNull(),
  clauseNumber: text("clause_number"),
  title: text("title"),
  generatedText: text("generated_text"),
  userEditedText: text("user_edited_text"),
  clauseType: clauseTypeEnum("clause_type"),
  aiNotes: text("ai_notes"),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
