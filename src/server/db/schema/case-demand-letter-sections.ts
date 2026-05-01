import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseDemandLetters } from "./case-demand-letters";

export const DEMAND_LETTER_SECTION_KEYS = [
  "header",
  "facts",
  "legal_basis",
  "demand",
  "consequences",
] as const;
export type DemandLetterSectionKey =
  (typeof DEMAND_LETTER_SECTION_KEYS)[number];

export const caseDemandLetterSections = pgTable(
  "case_demand_letter_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    letterId: uuid("letter_id")
      .references(() => caseDemandLetters.id, { onDelete: "cascade" })
      .notNull(),
    sectionKey: text("section_key").$type<DemandLetterSectionKey>().notNull(),
    contentMd: text("content_md").notNull(),
    regeneratedAt: timestamp("regenerated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("case_demand_letter_sections_letter_idx").on(table.letterId),
    unique("case_demand_letter_sections_letter_key_unique").on(
      table.letterId,
      table.sectionKey,
    ),
    check(
      "case_demand_letter_sections_key_check",
      sql`${table.sectionKey} IN ('header','facts','legal_basis','demand','consequences')`,
    ),
  ],
);

export type CaseDemandLetterSection =
  typeof caseDemandLetterSections.$inferSelect;
export type NewCaseDemandLetterSection =
  typeof caseDemandLetterSections.$inferInsert;
