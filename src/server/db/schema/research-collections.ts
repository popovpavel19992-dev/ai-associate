// src/server/db/schema/research-collections.ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { cachedOpinions } from "./cached-opinions";
import { cachedStatutes } from "./cached-statutes";
import { researchMemos } from "./research-memos";
import { researchSessions } from "./research-sessions";

export const collectionItemTypeEnum = pgEnum("research_collection_item_type", [
  "opinion",
  "statute",
  "memo",
  "session",
]);

export const researchCollections = pgTable(
  "research_collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    sharedWithOrg: boolean("shared_with_org").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("research_collections_user_updated_idx").on(
      table.userId,
      table.deletedAt,
      table.updatedAt.desc(),
    ),
    index("research_collections_case_idx").on(table.caseId),
  ],
);

export const researchCollectionItems = pgTable(
  "research_collection_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id").notNull().references(() => researchCollections.id, { onDelete: "cascade" }),
    itemType: collectionItemTypeEnum("item_type").notNull(),
    opinionId: uuid("opinion_id").references(() => cachedOpinions.id, { onDelete: "cascade" }),
    statuteId: uuid("statute_id").references(() => cachedStatutes.id, { onDelete: "cascade" }),
    memoId: uuid("memo_id").references(() => researchMemos.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => researchSessions.id, { onDelete: "cascade" }),
    notes: text("notes"),
    position: integer("position").notNull().default(0),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "research_collection_items_polymorphic_check",
      sql`(${table.itemType} = 'opinion' AND ${table.opinionId} IS NOT NULL AND ${table.statuteId} IS NULL AND ${table.memoId} IS NULL AND ${table.sessionId} IS NULL)
       OR (${table.itemType} = 'statute' AND ${table.statuteId} IS NOT NULL AND ${table.opinionId} IS NULL AND ${table.memoId} IS NULL AND ${table.sessionId} IS NULL)
       OR (${table.itemType} = 'memo' AND ${table.memoId} IS NOT NULL AND ${table.opinionId} IS NULL AND ${table.statuteId} IS NULL AND ${table.sessionId} IS NULL)
       OR (${table.itemType} = 'session' AND ${table.sessionId} IS NOT NULL AND ${table.opinionId} IS NULL AND ${table.statuteId} IS NULL AND ${table.memoId} IS NULL)`,
    ),
    index("research_collection_items_collection_position_idx").on(table.collectionId, table.position),
  ],
);

export const researchItemTags = pgTable(
  "research_item_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionItemId: uuid("collection_item_id").notNull().references(() => researchCollectionItems.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("research_item_tags_item_tag_unique").on(table.collectionItemId, table.tag),
    index("research_item_tags_tag_idx").on(table.tag, table.collectionItemId),
    check("research_item_tags_length_check", sql`length(${table.tag}) BETWEEN 1 AND 50`),
  ],
);

export type ResearchCollection = typeof researchCollections.$inferSelect;
export type NewResearchCollection = typeof researchCollections.$inferInsert;
export type ResearchCollectionItem = typeof researchCollectionItems.$inferSelect;
export type NewResearchCollectionItem = typeof researchCollectionItems.$inferInsert;
export type ResearchItemTag = typeof researchItemTags.$inferSelect;
