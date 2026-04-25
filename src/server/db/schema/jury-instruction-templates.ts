import { pgTable, uuid, text, boolean, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

export const JURY_INSTRUCTION_CATEGORY = [
  "preliminary",
  "substantive",
  "damages",
  "concluding",
] as const;
export type JuryInstructionCategory = (typeof JURY_INSTRUCTION_CATEGORY)[number];

export const juryInstructionTemplates = pgTable(
  "jury_instruction_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL = global library; non-null scopes to a single org's customized library.
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    category: text("category").$type<JuryInstructionCategory>().notNull(),
    instructionNumber: text("instruction_number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    sourceAuthority: text("source_authority"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("jury_instruction_templates_lookup_idx").on(
      table.orgId,
      table.category,
      table.isActive,
    ),
    check(
      "jury_instruction_templates_category_check",
      sql`${table.category} IN ('preliminary','substantive','damages','concluding')`,
    ),
  ],
);

export type JuryInstructionTemplate = typeof juryInstructionTemplates.$inferSelect;
export type NewJuryInstructionTemplate = typeof juryInstructionTemplates.$inferInsert;
