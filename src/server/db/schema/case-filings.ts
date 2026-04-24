import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";
import { caseMotions } from "./case-motions";
import { caseFilingPackages } from "./case-filing-packages";

export const caseFilings = pgTable(
  "case_filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    motionId: uuid("motion_id").references(() => caseMotions.id, { onDelete: "set null" }),
    packageId: uuid("package_id").references(() => caseFilingPackages.id, { onDelete: "set null" }),
    confirmationNumber: text("confirmation_number").notNull(),
    court: text("court").notNull(),
    judgeName: text("judge_name"),
    submissionMethod: text("submission_method").notNull(),
    feePaidCents: integer("fee_paid_cents").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    submittedBy: uuid("submitted_by").references(() => users.id).notNull(),
    status: text("status").notNull().default("submitted"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_filings_case_idx").on(table.caseId),
    index("case_filings_org_list_idx").on(table.orgId, table.status, table.submittedAt.desc()),
    index("case_filings_motion_idx").on(table.motionId),
    index("case_filings_package_idx").on(table.packageId),
    check("case_filings_status_check", sql`${table.status} IN ('submitted','closed')`),
    check("case_filings_method_check", sql`${table.submissionMethod} IN ('cm_ecf','mail','hand_delivery','email','fax')`),
    check("case_filings_closed_reason_check", sql`${table.closedReason} IS NULL OR ${table.closedReason} IN ('granted','denied','withdrawn','other')`),
  ],
);

export type CaseFiling = typeof caseFilings.$inferSelect;
export type NewCaseFiling = typeof caseFilings.$inferInsert;
