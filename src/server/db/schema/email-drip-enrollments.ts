// src/server/db/schema/email-drip-enrollments.ts
import { pgTable, uuid, text, integer, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { emailDripSequences } from "./email-drip-sequences";
import { clientContacts } from "./client-contacts";
import { cases } from "./cases";
import { organizations } from "./organizations";
import { users } from "./users";

export const emailDripEnrollments = pgTable(
  "email_drip_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequenceId: uuid("sequence_id").references(() => emailDripSequences.id, { onDelete: "restrict" }).notNull(),
    clientContactId: uuid("client_contact_id").references(() => clientContacts.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    status: text("status").notNull().default("active"),
    currentStepOrder: integer("current_step_order").notNull().default(0),
    nextSendAt: timestamp("next_send_at", { withTimezone: true }),
    enrolledBy: uuid("enrolled_by").references(() => users.id).notNull(),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).defaultNow().notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastStepSentAt: timestamp("last_step_sent_at", { withTimezone: true }),
  },
  (table) => [
    index("email_drip_enrollments_next_send_idx")
      .on(table.status, table.nextSendAt)
      .where(sql`status = 'active'`),
    index("email_drip_enrollments_contact_idx").on(table.clientContactId, table.status),
    index("email_drip_enrollments_case_idx").on(table.caseId, table.status),
    check(
      "email_drip_enrollments_status_check",
      sql`${table.status} IN ('active','completed','cancelled_reply','cancelled_bounce','cancelled_complaint','cancelled_manual')`,
    ),
    unique("email_drip_enrollments_unique_seq_contact_case").on(
      table.sequenceId,
      table.clientContactId,
      table.caseId,
    ),
  ],
);

export type EmailDripEnrollment = typeof emailDripEnrollments.$inferSelect;
export type NewEmailDripEnrollment = typeof emailDripEnrollments.$inferInsert;
