// src/server/db/schema/user-ooo-periods.ts
//
// Phase 3.14 — Out-of-Office period tracking.

import {
  pgTable,
  uuid,
  text,
  date,
  boolean,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";

export const OOO_STATUSES = ["scheduled", "active", "ended", "cancelled"] as const;
export type OooStatus = (typeof OOO_STATUSES)[number];

export const userOooPeriods = pgTable(
  "user_ooo_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: text("status").$type<OooStatus>().notNull().default("scheduled"),
    autoResponseSubject: text("auto_response_subject")
      .notNull()
      .default("Out of Office Auto-Reply"),
    autoResponseBody: text("auto_response_body").notNull(),
    coverageUserId: uuid("coverage_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    emergencyKeywordResponse: text("emergency_keyword_response"),
    includeInSignature: boolean("include_in_signature").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("user_ooo_periods_user_dates_idx").on(
      table.userId,
      table.startDate,
      table.endDate,
    ),
    check(
      "user_ooo_periods_dates_check",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "user_ooo_periods_status_check",
      sql`${table.status} IN ('scheduled','active','ended','cancelled')`,
    ),
  ],
);

export type UserOooPeriod = typeof userOooPeriods.$inferSelect;
export type NewUserOooPeriod = typeof userOooPeriods.$inferInsert;
