import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { documents } from "./documents";

export const caseMilestones = pgTable(
  "case_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("draft"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    retractedReason: text("retracted_reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    retractedBy: uuid("retracted_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    retractedAt: timestamp("retracted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_milestones_case_status_idx").on(table.caseId, table.status),
    index("case_milestones_case_occurred_idx").on(table.caseId, table.occurredAt),
    check(
      "case_milestones_status_check",
      sql`${table.status} IN ('draft','published','retracted')`,
    ),
    check(
      "case_milestones_category_check",
      sql`${table.category} IN ('filing','discovery','hearing','settlement','communication','other')`,
    ),
  ],
);

export type CaseMilestone = typeof caseMilestones.$inferSelect;
export type NewCaseMilestone = typeof caseMilestones.$inferInsert;
