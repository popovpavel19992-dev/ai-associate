import { pgTable, uuid, text, numeric, date, boolean, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { intakeForms } from "./intake-forms";
import { documents } from "./documents";

export const intakeFormAnswers = pgTable(
  "intake_form_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formId: uuid("form_id")
      .references(() => intakeForms.id, { onDelete: "cascade" })
      .notNull(),
    fieldId: text("field_id").notNull(),
    valueText: text("value_text"),
    valueNumber: numeric("value_number"),
    valueDate: date("value_date"),
    valueBool: boolean("value_bool"),
    valueJson: jsonb("value_json"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("intake_form_answers_form_field_unique").on(table.formId, table.fieldId),
    index("intake_form_answers_form_idx").on(table.formId),
  ],
);

export type IntakeFormAnswer = typeof intakeFormAnswers.$inferSelect;
export type NewIntakeFormAnswer = typeof intakeFormAnswers.$inferInsert;
