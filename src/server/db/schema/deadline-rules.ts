import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

export const deadlineRules = pgTable(
  "deadline_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    triggerEvent: text("trigger_event").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    days: integer("days").notNull(),
    dayType: text("day_type").notNull(),
    shiftIfHoliday: boolean("shift_if_holiday").notNull().default(true),
    defaultReminders: jsonb("default_reminders").notNull().default(sql`'[7,3,1]'::jsonb`),
    jurisdiction: text("jurisdiction").notNull().default("FRCP"),
    citation: text("citation"),
    appliesToMotionTypes: text("applies_to_motion_types").array(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("deadline_rules_trigger_idx").on(table.triggerEvent, table.jurisdiction),
    index("deadline_rules_org_idx").on(table.orgId),
    check("deadline_rules_day_type_check", sql`${table.dayType} IN ('calendar','court')`),
  ],
);

export type DeadlineRule = typeof deadlineRules.$inferSelect;
export type NewDeadlineRule = typeof deadlineRules.$inferInsert;
