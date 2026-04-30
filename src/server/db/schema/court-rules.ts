import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  check,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const COURT_RULE_CATEGORIES = [
  "procedural",
  "evidence",
  "local",
  "ethics",
  "appellate",
] as const;
export type CourtRuleCategory = (typeof COURT_RULE_CATEGORIES)[number];

export const courtRules = pgTable(
  "court_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jurisdiction: text("jurisdiction").notNull(),
    ruleNumber: text("rule_number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").$type<CourtRuleCategory>().notNull(),
    citationShort: text("citation_short").notNull(),
    citationFull: text("citation_full").notNull(),
    sourceUrl: text("source_url"),
    parentRuleId: uuid("parent_rule_id").references((): AnyPgColumn => courtRules.id, {
      onDelete: "cascade",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("court_rules_jurisdiction_rule_unique").on(table.jurisdiction, table.ruleNumber),
    index("court_rules_jurisdiction_category_idx").on(
      table.jurisdiction,
      table.category,
      table.isActive,
    ),
    check(
      "court_rules_category_check",
      sql`${table.category} IN ('procedural','evidence','local','ethics','appellate')`,
    ),
  ],
);

export type CourtRule = typeof courtRules.$inferSelect;
export type NewCourtRule = typeof courtRules.$inferInsert;

export const userRuleBookmarks = pgTable(
  "user_rule_bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    ruleId: uuid("rule_id")
      .references(() => courtRules.id, { onDelete: "cascade" })
      .notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("user_rule_bookmarks_user_rule_unique").on(table.userId, table.ruleId),
    index("user_rule_bookmarks_user_idx").on(table.userId, table.createdAt),
  ],
);

export type UserRuleBookmark = typeof userRuleBookmarks.$inferSelect;
export type NewUserRuleBookmark = typeof userRuleBookmarks.$inferInsert;
