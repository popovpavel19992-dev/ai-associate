import { pgTable, uuid, text, date, boolean, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { deadlineRules } from "./deadline-rules";
import { caseTriggerEvents } from "./case-trigger-events";

export const caseDeadlines = pgTable(
  "case_deadlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull(),
    dueDate: date("due_date").notNull(),
    source: text("source").notNull(),
    ruleId: uuid("rule_id").references(() => deadlineRules.id, { onDelete: "set null" }),
    triggerEventId: uuid("trigger_event_id").references(() => caseTriggerEvents.id, { onDelete: "cascade" }),
    rawDate: date("raw_date"),
    shiftedReason: text("shifted_reason"),
    manualOverride: boolean("manual_override").notNull().default(false),
    reminders: jsonb("reminders").notNull().default(sql`'[7,3,1]'::jsonb`),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_deadlines_case_due_idx").on(table.caseId, table.dueDate),
    index("case_deadlines_trigger_idx").on(table.triggerEventId),
    check("case_deadlines_source_check", sql`${table.source} IN ('rule_generated','manual')`),
  ],
);

export type CaseDeadline = typeof caseDeadlines.$inferSelect;
export type NewCaseDeadline = typeof caseDeadlines.$inferInsert;
