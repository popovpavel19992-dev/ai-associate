import { pgTable, uuid, text, integer, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseJuryInstructionSets } from "./case-jury-instruction-sets";
import { juryInstructionTemplates } from "./jury-instruction-templates";

export const JURY_INSTRUCTION_SOURCE = ["library", "manual", "modified"] as const;
export type JuryInstructionSource = (typeof JURY_INSTRUCTION_SOURCE)[number];

export const JURY_INSTRUCTION_PARTY_POSITION = [
  "plaintiff_proposed",
  "defendant_proposed",
  "agreed",
  "court_ordered",
] as const;
export type JuryInstructionPartyPosition =
  (typeof JURY_INSTRUCTION_PARTY_POSITION)[number];

export const JURY_INSTRUCTION_CATEGORY = [
  "preliminary",
  "substantive",
  "damages",
  "concluding",
] as const;
export type JuryInstructionCategory = (typeof JURY_INSTRUCTION_CATEGORY)[number];

export const caseJuryInstructions = pgTable(
  "case_jury_instructions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .references(() => caseJuryInstructionSets.id, { onDelete: "cascade" })
      .notNull(),
    instructionOrder: integer("instruction_order").notNull(),
    category: text("category").$type<JuryInstructionCategory>().notNull(),
    instructionNumber: text("instruction_number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    source: text("source").$type<JuryInstructionSource>().notNull().default("manual"),
    sourceTemplateId: uuid("source_template_id").references(
      () => juryInstructionTemplates.id,
      { onDelete: "set null" },
    ),
    partyPosition: text("party_position")
      .$type<JuryInstructionPartyPosition>()
      .notNull()
      .default("plaintiff_proposed"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_jury_instructions_set_idx").on(table.setId, table.instructionOrder),
    unique("case_jury_instructions_set_order_unique").on(
      table.setId,
      table.instructionOrder,
    ),
    check(
      "case_jury_instructions_category_check",
      sql`${table.category} IN ('preliminary','substantive','damages','concluding')`,
    ),
    check(
      "case_jury_instructions_source_check",
      sql`${table.source} IN ('library','manual','modified')`,
    ),
    check(
      "case_jury_instructions_party_position_check",
      sql`${table.partyPosition} IN ('plaintiff_proposed','defendant_proposed','agreed','court_ordered')`,
    ),
    check(
      "case_jury_instructions_order_check",
      sql`${table.instructionOrder} BETWEEN 1 AND 9999`,
    ),
  ],
);

export type CaseJuryInstruction = typeof caseJuryInstructions.$inferSelect;
export type NewCaseJuryInstruction = typeof caseJuryInstructions.$inferInsert;
