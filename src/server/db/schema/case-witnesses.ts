import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseWitnessLists } from "./case-witness-lists";

export const WITNESS_CATEGORY = ["fact", "expert", "impeachment", "rebuttal"] as const;
export type WitnessCategory = (typeof WITNESS_CATEGORY)[number];

export const WITNESS_PARTY_AFFILIATION = ["plaintiff", "defendant", "non_party"] as const;
export type WitnessPartyAffiliation = (typeof WITNESS_PARTY_AFFILIATION)[number];

export const caseWitnesses = pgTable(
  "case_witnesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id").references(() => caseWitnessLists.id, { onDelete: "cascade" }).notNull(),
    witnessOrder: integer("witness_order").notNull(),
    category: text("category").$type<WitnessCategory>().notNull(),
    partyAffiliation: text("party_affiliation").$type<WitnessPartyAffiliation>().notNull(),
    fullName: text("full_name").notNull(),
    titleOrRole: text("title_or_role"),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    expectedTestimony: text("expected_testimony"),
    exhibitRefs: jsonb("exhibit_refs").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    isWillCall: boolean("is_will_call").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_witnesses_list_idx").on(table.listId, table.witnessOrder),
    unique("case_witnesses_list_order_unique").on(table.listId, table.witnessOrder),
    check(
      "case_witnesses_category_check",
      sql`${table.category} IN ('fact','expert','impeachment','rebuttal')`,
    ),
    check(
      "case_witnesses_party_affiliation_check",
      sql`${table.partyAffiliation} IN ('plaintiff','defendant','non_party')`,
    ),
    check(
      "case_witnesses_order_check",
      sql`${table.witnessOrder} BETWEEN 1 AND 9999`,
    ),
  ],
);

export type CaseWitness = typeof caseWitnesses.$inferSelect;
export type NewCaseWitness = typeof caseWitnesses.$inferInsert;
