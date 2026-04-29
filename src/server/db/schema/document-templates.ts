// src/server/db/schema/document-templates.ts
//
// Phase 3.12 — Firm Document Templates Engine.
// Reusable, mergeable firm templates (retainer/NDA/engagement/etc).
// org_id NULL ⇒ global library row seeded for every firm.

import { pgTable, uuid, text, jsonb, boolean, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

export type DocumentTemplateCategory =
  | "retainer"
  | "engagement"
  | "fee_agreement"
  | "nda"
  | "conflict_waiver"
  | "termination"
  | "demand"
  | "settlement"
  | "authorization"
  | "other";

export type VariableType = "text" | "textarea" | "date" | "currency" | "number" | "select";

export interface VariableDef {
  key: string;
  label: string;
  type: VariableType;
  required: boolean;
  defaultValue?: string;
  options?: string[];
  helpText?: string;
}

export const documentTemplates = pgTable(
  "document_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    category: text("category").$type<DocumentTemplateCategory>().notNull(),
    name: text("name").notNull(),
    description: text("description"),
    body: text("body").notNull(),
    variables: jsonb("variables").$type<VariableDef[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    isGlobal: boolean("is_global").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("document_templates_lookup_idx").on(table.orgId, table.category, table.isActive),
    check(
      "document_templates_category_check",
      sql`${table.category} IN ('retainer','engagement','fee_agreement','nda','conflict_waiver','termination','demand','settlement','authorization','other')`,
    ),
  ],
);

export type DocumentTemplate = typeof documentTemplates.$inferSelect;
export type NewDocumentTemplate = typeof documentTemplates.$inferInsert;
