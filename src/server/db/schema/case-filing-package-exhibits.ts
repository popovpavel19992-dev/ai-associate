import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { caseFilingPackages } from "./case-filing-packages";
import { documents } from "./documents";

export const caseFilingPackageExhibits = pgTable(
  "case_filing_package_exhibits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id").references(() => caseFilingPackages.id, { onDelete: "cascade" }).notNull(),
    label: text("label").notNull(),
    displayOrder: integer("display_order").notNull(),
    sourceType: text("source_type").notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    adHocS3Key: text("ad_hoc_s3_key"),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("pkg_exhibits_package_order_idx").on(table.packageId, table.displayOrder),
  ],
);

export type CaseFilingPackageExhibit = typeof caseFilingPackageExhibits.$inferSelect;
export type NewCaseFilingPackageExhibit = typeof caseFilingPackageExhibits.$inferInsert;
