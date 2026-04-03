import { pgTable, uuid, text, jsonb, boolean } from "drizzle-orm/pg-core";

export const sectionPresets = pgTable("section_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseType: text("case_type").notNull(),
  sections: jsonb("sections").$type<string[]>().notNull(),
  isSystem: boolean("is_system").default(true).notNull(),
});
