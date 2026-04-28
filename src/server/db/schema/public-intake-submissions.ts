import { pgTable, uuid, text, timestamp, jsonb, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { clients } from "./clients";
import { cases } from "./cases";
import { publicIntakeTemplates } from "./public-intake-templates";

export type PublicIntakeStatus = "new" | "reviewing" | "accepted" | "declined" | "spam";

export const publicIntakeSubmissions = pgTable(
  "public_intake_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    templateId: uuid("template_id")
      .references(() => publicIntakeTemplates.id, { onDelete: "cascade" })
      .notNull(),
    submitterName: text("submitter_name"),
    submitterEmail: text("submitter_email"),
    submitterPhone: text("submitter_phone"),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
    sourceIp: text("source_ip"),
    userAgent: text("user_agent"),
    honeypotValue: text("honeypot_value"),
    status: text("status").$type<PublicIntakeStatus>().notNull().default("new"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    createdClientId: uuid("created_client_id").references(() => clients.id, { onDelete: "set null" }),
    createdCaseId: uuid("created_case_id").references(() => cases.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("public_intake_submissions_org_status_idx").on(table.orgId, table.status, table.submittedAt),
    index("public_intake_submissions_template_idx").on(table.templateId, table.submittedAt),
    check(
      "public_intake_submissions_status_check",
      sql`${table.status} IN ('new','reviewing','accepted','declined','spam')`,
    ),
  ],
);

export type PublicIntakeSubmission = typeof publicIntakeSubmissions.$inferSelect;
export type NewPublicIntakeSubmission = typeof publicIntakeSubmissions.$inferInsert;
