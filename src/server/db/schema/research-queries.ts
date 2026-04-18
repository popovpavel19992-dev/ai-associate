import { pgTable, uuid, text, jsonb, integer, timestamp, index } from "drizzle-orm/pg-core";
import { researchSessions } from "./research-sessions";

export const researchQueries = pgTable(
  "research_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => researchSessions.id, { onDelete: "cascade" }),
    queryText: text("query_text").notNull(),
    filters: jsonb("filters").$type<{
      jurisdictions?: string[];
      courtLevels?: string[];
      fromYear?: number;
      toYear?: number;
      courtName?: string;
    }>(),
    resultCount: integer("result_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("research_queries_session_idx").on(table.sessionId, table.createdAt.desc()),
  ],
);

export type ResearchQuery = typeof researchQueries.$inferSelect;
export type NewResearchQuery = typeof researchQueries.$inferInsert;
