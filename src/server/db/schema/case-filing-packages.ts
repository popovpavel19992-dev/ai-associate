import { pgTable, uuid, text, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";
import { caseMotions } from "./case-motions";

export const caseFilingPackages = pgTable(
  "case_filing_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    motionId: uuid("motion_id").references(() => caseMotions.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    proposedOrderText: text("proposed_order_text"),
    coverSheetData: jsonb("cover_sheet_data").notNull(),
    exportedPdfPath: text("exported_pdf_path"),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_filing_packages_case_idx").on(table.caseId),
    index("case_filing_packages_motion_idx").on(table.motionId),
    index("case_filing_packages_org_idx").on(table.orgId),
    check("case_filing_packages_status_check", sql`${table.status} IN ('draft','finalized')`),
  ],
);

export type CaseFilingPackage = typeof caseFilingPackages.$inferSelect;
export type NewCaseFilingPackage = typeof caseFilingPackages.$inferInsert;
