import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { caseTasks } from "./case-tasks";
import { users } from "./users";

export const calendarEventKindEnum = pgEnum("calendar_event_kind", [
  "court_date",
  "filing_deadline",
  "meeting",
  "reminder",
  "other",
]);

export type CalendarEventKindDb =
  (typeof calendarEventKindEnum.enumValues)[number];

export const caseCalendarEvents = pgTable(
  "case_calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    kind: calendarEventKindEnum("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location"),
    linkedTaskId: uuid("linked_task_id").references(() => caseTasks.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("calendar_events_case_id_idx").on(table.caseId),
    index("calendar_events_starts_at_idx").on(table.startsAt),
    index("calendar_events_case_starts_idx").on(table.caseId, table.startsAt),
    index("calendar_events_linked_task_idx").on(table.linkedTaskId),
  ],
);

export type CaseCalendarEvent = typeof caseCalendarEvents.$inferSelect;
export type NewCaseCalendarEvent = typeof caseCalendarEvents.$inferInsert;
