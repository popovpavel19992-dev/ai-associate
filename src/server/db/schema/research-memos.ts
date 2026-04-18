// src/server/db/schema/research-memos.ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { researchSessions } from "./research-sessions";
import { cases } from "./cases";
import { jurisdictionEnum } from "./cached-opinions";

export const memoStatusEnum = pgEnum("research_memo_status", [
  "generating",
  "ready",
  "failed",
]);

export const memoSectionTypeEnum = pgEnum("research_memo_section_type", [
  "issue",
  "rule",
  "application",
  "conclusion",
]);

export const researchMemos = pgTable(
  "research_memos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => researchSessions.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    jurisdiction: jurisdictionEnum("jurisdiction"),
    status: memoStatusEnum("status").notNull(),
    memoQuestion: text("memo_question").notNull(),
    contextOpinionIds: uuid("context_opinion_ids").array().notNull().default(sql`'{}'`),
    contextStatuteIds: uuid("context_statute_ids").array().notNull().default(sql`'{}'`),
    flags: jsonb("flags")
      .$type<{ unverifiedCitations?: string[]; uplViolations?: string[] }>()
      .notNull()
      .default({}),
    tokenUsage: jsonb("token_usage")
      .$type<{ input_tokens?: number; output_tokens?: number }>()
      .notNull()
      .default({}),
    creditsCharged: integer("credits_charged").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("research_memos_user_updated_idx").on(
      table.userId,
      table.deletedAt,
      table.updatedAt.desc(),
    ),
    index("research_memos_case_idx").on(table.caseId),
    index("research_memos_session_idx").on(table.sessionId),
  ],
);

export const researchMemoSections = pgTable(
  "research_memo_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoId: uuid("memo_id")
      .notNull()
      .references(() => researchMemos.id, { onDelete: "cascade" }),
    sectionType: memoSectionTypeEnum("section_type").notNull(),
    ord: integer("ord").notNull(),
    content: text("content").notNull(),
    citations: text("citations").array().notNull().default(sql`'{}'`),
    aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }).notNull(),
    userEditedAt: timestamp("user_edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("research_memo_sections_memo_type_unique").on(
      table.memoId,
      table.sectionType,
    ),
    index("research_memo_sections_memo_ord_idx").on(table.memoId, table.ord),
    check("research_memo_sections_ord_check", sql`${table.ord} BETWEEN 1 AND 4`),
  ],
);

export type ResearchMemo = typeof researchMemos.$inferSelect;
export type NewResearchMemo = typeof researchMemos.$inferInsert;
export type ResearchMemoSection = typeof researchMemoSections.$inferSelect;
export type NewResearchMemoSection = typeof researchMemoSections.$inferInsert;
