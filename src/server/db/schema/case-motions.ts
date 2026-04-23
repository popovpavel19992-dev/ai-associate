import { pgTable, uuid, text, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";
import { motionTemplates } from "./motion-templates";
import { caseTriggerEvents } from "./case-trigger-events";

export const caseMotions = pgTable(
  "case_motions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    templateId: uuid("template_id").references(() => motionTemplates.id, { onDelete: "restrict" }).notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    caption: jsonb("caption").notNull(),
    sections: jsonb("sections").notNull().default({}),
    attachedMemoIds: uuid("attached_memo_ids").array().notNull().default([]),
    attachedCollectionIds: uuid("attached_collection_ids").array().notNull().default([]),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    triggerEventId: uuid("trigger_event_id").references(() => caseTriggerEvents.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_motions_case_idx").on(table.caseId),
    index("case_motions_org_idx").on(table.orgId),
    check("case_motions_status_check", sql`${table.status} IN ('draft','filed')`),
  ],
);

export type CaseMotion = typeof caseMotions.$inferSelect;
export type NewCaseMotion = typeof caseMotions.$inferInsert;
