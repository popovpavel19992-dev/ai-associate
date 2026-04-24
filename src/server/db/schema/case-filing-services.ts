import { pgTable, uuid, text, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { caseFilings } from "./case-filings";
import { caseParties } from "./case-parties";

export const caseFilingServices = pgTable(
  "case_filing_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    filingId: uuid("filing_id").references(() => caseFilings.id, { onDelete: "cascade" }).notNull(),
    partyId: uuid("party_id").references(() => caseParties.id, { onDelete: "restrict" }).notNull(),
    method: text("method").notNull(),
    servedAt: timestamp("served_at", { withTimezone: true }).notNull(),
    servedEmail: text("served_email"),
    servedAddress: text("served_address"),
    trackingReference: text("tracking_reference"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_filing_services_filing_idx").on(table.filingId),
    index("case_filing_services_party_idx").on(table.partyId),
    check(
      "case_filing_services_method_check",
      sql`${table.method} IN ('cm_ecf_nef','email','mail','certified_mail','overnight','hand_delivery','fax')`,
    ),
    unique("case_filing_services_unique_filing_party").on(table.filingId, table.partyId),
  ],
);

export type CaseFilingService = typeof caseFilingServices.$inferSelect;
export type NewCaseFilingService = typeof caseFilingServices.$inferInsert;
