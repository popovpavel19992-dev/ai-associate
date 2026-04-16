import { pgTable, uuid, text, jsonb, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { researchSessions } from "./research-sessions";

export const researchChatRoleEnum = pgEnum("research_chat_role", ["user", "assistant"]);
export const researchChatModeEnum = pgEnum("research_chat_mode", ["broad", "deep"]);

export const researchChatMessages = pgTable(
  "research_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => researchSessions.id, { onDelete: "cascade" }),
    role: researchChatRoleEnum("role").notNull(),
    content: text("content").notNull(),
    mode: researchChatModeEnum("mode"),
    opinionId: uuid("opinion_id"),
    opinionContextIds: jsonb("opinion_context_ids").$type<string[]>().default([]).notNull(),
    tokensUsed: integer("tokens_used").default(0).notNull(),
    flags: jsonb("flags").$type<{
      unverifiedCitations?: string[];
      uplViolations?: string[];
    }>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sessionIdx: index("research_chat_session_idx").on(t.sessionId, t.createdAt.asc()),
  }),
);

export type ResearchChatMessage = typeof researchChatMessages.$inferSelect;
export type NewResearchChatMessage = typeof researchChatMessages.$inferInsert;
