import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { cases } from "./cases";
import { cachedOpinions } from "./cached-opinions";

export const opinionBookmarks = pgTable(
  "opinion_bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    opinionId: uuid("opinion_id").notNull().references(() => cachedOpinions.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("opinion_bookmarks_user_opinion_unique").on(table.userId, table.opinionId),
    index("opinion_bookmarks_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("opinion_bookmarks_case_idx").on(table.caseId),
  ],
);

export type OpinionBookmark = typeof opinionBookmarks.$inferSelect;
export type NewOpinionBookmark = typeof opinionBookmarks.$inferInsert;
