import { pgTable, uuid, char, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

export const researchUsage = pgTable(
  "research_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    month: char("month", { length: 7 }).notNull(), // "YYYY-MM"
    qaCount: integer("qa_count").notNull().default(0),
    memoCount: integer("memo_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("research_usage_user_month_unique").on(table.userId, table.month),
  ],
);

export type ResearchUsage = typeof researchUsage.$inferSelect;
export type NewResearchUsage = typeof researchUsage.$inferInsert;
