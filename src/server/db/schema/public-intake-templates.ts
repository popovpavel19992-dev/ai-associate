import { pgTable, uuid, text, timestamp, jsonb, boolean, index, unique } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

export type PublicIntakeFieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "date"
  | "select"
  | "multiselect"
  | "yes_no"
  | "number";

export interface PublicIntakeFieldDef {
  id: string;
  key: string;
  label: string;
  type: PublicIntakeFieldType;
  required: boolean;
  options?: string[];
  helpText?: string;
  validation?: { min?: number; max?: number; pattern?: string };
}

export const publicIntakeTemplates = pgTable(
  "public_intake_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    fields: jsonb("fields").$type<PublicIntakeFieldDef[]>().notNull().default([]),
    caseType: text("case_type"),
    isActive: boolean("is_active").notNull().default(true),
    thankYouMessage: text("thank_you_message"),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("public_intake_templates_org_slug_unique").on(table.orgId, table.slug),
    index("public_intake_templates_org_idx").on(table.orgId, table.isActive),
  ],
);

export type PublicIntakeTemplate = typeof publicIntakeTemplates.$inferSelect;
export type NewPublicIntakeTemplate = typeof publicIntakeTemplates.$inferInsert;
