import { pgTable, uuid, text, date, uniqueIndex, index } from "drizzle-orm/pg-core";

export const courtHolidays = pgTable(
  "court_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jurisdiction: text("jurisdiction").notNull().default("FEDERAL"),
    name: text("name").notNull(),
    observedDate: date("observed_date").notNull(),
  },
  (table) => [
    uniqueIndex("court_holidays_jurisdiction_date_unique").on(table.jurisdiction, table.observedDate),
    index("court_holidays_jurisdiction_date_idx").on(table.jurisdiction, table.observedDate),
  ],
);

export type CourtHoliday = typeof courtHolidays.$inferSelect;
export type NewCourtHoliday = typeof courtHolidays.$inferInsert;
