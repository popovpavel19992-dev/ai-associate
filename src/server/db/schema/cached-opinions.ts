import { pgTable, uuid, text, bigint, jsonb, timestamp, date, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";

export const jurisdictionEnum = pgEnum("research_jurisdiction", ["federal", "ca", "ny", "tx", "fl", "il"]);
export const courtLevelEnum = pgEnum("research_court_level", [
  "scotus",
  "circuit",
  "district",
  "state_supreme",
  "state_appellate",
]);

export const cachedOpinions = pgTable(
  "cached_opinions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courtlistenerId: bigint("courtlistener_id", { mode: "number" }).notNull(),
    citationBluebook: text("citation_bluebook").notNull(),
    caseName: text("case_name").notNull(),
    court: text("court").notNull(),
    jurisdiction: jurisdictionEnum("jurisdiction").notNull(),
    courtLevel: courtLevelEnum("court_level").notNull(),
    decisionDate: date("decision_date").notNull(),
    fullText: text("full_text"),
    snippet: text("snippet"),
    metadata: jsonb("metadata").$type<{
      judges?: string[];
      syllabusUrl?: string;
      citedByCount?: number;
      citesTo?: string[];
      enrichmentStatus?: "pending" | "done" | "failed";
    }>().default({}).notNull(),
    firstCachedAt: timestamp("first_cached_at", { withTimezone: true }).defaultNow().notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cached_opinions_courtlistener_unique").on(table.courtlistenerId),
    index("cached_opinions_juris_date_idx").on(table.jurisdiction, table.decisionDate.desc()),
  ],
);

export type CachedOpinion = typeof cachedOpinions.$inferSelect;
export type NewCachedOpinion = typeof cachedOpinions.$inferInsert;
