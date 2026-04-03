import { pgTable, uuid, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { cases } from "./cases";
import { documents } from "./documents";

export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  tokensUsed: integer("tokens_used"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
