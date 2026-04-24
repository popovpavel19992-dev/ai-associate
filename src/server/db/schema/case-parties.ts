import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";

export const caseParties = pgTable(
  "case_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    email: text("email"),
    address: text("address"),
    phone: text("phone"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_parties_case_idx").on(table.caseId),
    index("case_parties_org_name_idx").on(table.orgId, table.name),
    check(
      "case_parties_role_check",
      sql`${table.role} IN ('opposing_counsel','co_defendant','co_plaintiff','pro_se','third_party','witness','other')`,
    ),
  ],
);

export type CaseParty = typeof caseParties.$inferSelect;
export type NewCaseParty = typeof caseParties.$inferInsert;
