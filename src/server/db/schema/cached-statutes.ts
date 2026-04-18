import { pgTable, uuid, text, jsonb, timestamp, date, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";

export const statuteSourceEnum = pgEnum("statute_source", ["usc", "cfr"]);

export const cachedStatutes = pgTable(
  "cached_statutes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: statuteSourceEnum("source").notNull(),
    citationBluebook: text("citation_bluebook").notNull(),
    title: text("title").notNull(),
    chapter: text("chapter"),
    section: text("section").notNull(),
    heading: text("heading"),
    bodyText: text("body_text"),
    effectiveDate: date("effective_date"),
    metadata: jsonb("metadata").$type<{
      url?: string;
      parentTitleHeading?: string;
      crossRefs?: string[];
      enrichmentStatus?: "pending" | "done" | "failed";
    }>().default({}).notNull(),
    firstCachedAt: timestamp("first_cached_at", { withTimezone: true }).defaultNow().notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("cached_statutes_source_citation_unique").on(t.source, t.citationBluebook),
    index("cached_statutes_source_section_idx").on(t.source, t.title, t.section),
  ],
);

export type CachedStatute = typeof cachedStatutes.$inferSelect;
export type NewCachedStatute = typeof cachedStatutes.$inferInsert;
