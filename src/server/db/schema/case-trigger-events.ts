import { pgTable, uuid, text, date, timestamp, index } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";
import { caseMilestones } from "./case-milestones";

export const caseTriggerEvents = pgTable(
  "case_trigger_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    triggerEvent: text("trigger_event").notNull(),
    eventDate: date("event_date").notNull(),
    jurisdiction: text("jurisdiction").notNull().default("FRCP"),
    notes: text("notes"),
    publishedMilestoneId: uuid("published_milestone_id").references(() => caseMilestones.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_trigger_events_case_idx").on(table.caseId, table.eventDate),
  ],
);

export type CaseTriggerEvent = typeof caseTriggerEvents.$inferSelect;
export type NewCaseTriggerEvent = typeof caseTriggerEvents.$inferInsert;
