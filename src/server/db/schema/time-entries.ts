import { pgTable, uuid, text, integer, boolean, date, timestamp, index, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { caseTasks } from "./case-tasks";
import { users } from "./users";
import { organizations } from "./organizations";

export const activityTypeEnum = pgEnum("activity_type", [
  "research",
  "drafting",
  "court_appearance",
  "client_communication",
  "filing",
  "review",
  "travel",
  "administrative",
  "other",
]);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id").references(() => caseTasks.id, { onDelete: "set null" }),
    activityType: activityTypeEnum("activity_type").notNull().default("other"),
    description: text("description").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    isBillable: boolean("is_billable").notNull().default(true),
    rateCents: integer("rate_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    entryDate: date("entry_date", { mode: "date" }).notNull(),
    timerStartedAt: timestamp("timer_started_at", { withTimezone: true }),
    timerStoppedAt: timestamp("timer_stopped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_time_entries_case").on(table.caseId, table.entryDate),
    index("idx_time_entries_user").on(table.userId, table.entryDate),
    index("idx_time_entries_org").on(table.orgId, table.entryDate),
    index("idx_time_entries_running")
      .on(table.userId)
      .where(sql`${table.timerStartedAt} IS NOT NULL AND ${table.timerStoppedAt} IS NULL`),
  ],
);

// NOTE: DESC sort on entry_date is enforced in the SQL migration (canonical).
// Drizzle schema indexes do not support sort direction — migration is the source of truth.

export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
