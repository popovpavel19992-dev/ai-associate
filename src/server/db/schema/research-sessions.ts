import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { cases } from "./cases";

export const researchSessions = pgTable(
  "research_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    jurisdictionFilter: jsonb("jurisdiction_filter").$type<{
      jurisdictions?: string[];
      courtLevels?: string[];
      fromYear?: number;
      toYear?: number;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("research_sessions_user_updated_idx").on(table.userId, table.deletedAt, table.updatedAt.desc()),
    index("research_sessions_case_idx").on(table.caseId),
  ],
);

export type ResearchSession = typeof researchSessions.$inferSelect;
export type NewResearchSession = typeof researchSessions.$inferInsert;
