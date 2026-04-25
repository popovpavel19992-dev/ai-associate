import { pgTable, uuid, text, integer, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";

export const EXHIBIT_LIST_STATUS = ["draft", "final", "served", "closed"] as const;
export type ExhibitListStatus = (typeof EXHIBIT_LIST_STATUS)[number];

export const EXHIBIT_LIST_SERVING_PARTY = ["plaintiff", "defendant"] as const;
export type ExhibitListServingParty = (typeof EXHIBIT_LIST_SERVING_PARTY)[number];

export const caseExhibitLists = pgTable(
  "case_exhibit_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    servingParty: text("serving_party").$type<ExhibitListServingParty>().notNull(),
    listNumber: integer("list_number").notNull().default(1),
    title: text("title").notNull(),
    status: text("status").$type<ExhibitListStatus>().notNull().default("draft"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    servedAt: timestamp("served_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_exhibit_lists_case_idx").on(table.caseId, table.status),
    unique("case_exhibit_lists_case_party_number_unique").on(
      table.caseId,
      table.servingParty,
      table.listNumber,
    ),
    check(
      "case_exhibit_lists_serving_party_check",
      sql`${table.servingParty} IN ('plaintiff','defendant')`,
    ),
    check(
      "case_exhibit_lists_status_check",
      sql`${table.status} IN ('draft','final','served','closed')`,
    ),
    check(
      "case_exhibit_lists_list_number_check",
      sql`${table.listNumber} BETWEEN 1 AND 99`,
    ),
  ],
);

export type CaseExhibitList = typeof caseExhibitLists.$inferSelect;
export type NewCaseExhibitList = typeof caseExhibitLists.$inferInsert;
