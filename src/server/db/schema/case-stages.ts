import { pgTable, uuid, text, timestamp, jsonb, boolean, integer, pgEnum, unique, index } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";

export const caseTypeEnum = pgEnum("case_type", [
  "personal_injury",
  "family_law",
  "traffic_defense",
  "contract_dispute",
  "criminal_defense",
  "employment_law",
  "general",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "stage_changed",
  "document_added",
  "analysis_completed",
  "manual",
  "contract_linked",
  "draft_linked",
  "task_added",
  "task_completed",
  "task_removed",
  "tasks_auto_created",
]);

export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);

export const taskStatusEnum = pgEnum("task_status", ["todo", "in_progress", "done"]);

export const taskCategoryEnum = pgEnum("task_category", [
  "filing",
  "research",
  "client_communication",
  "evidence",
  "court",
  "administrative",
]);

export const caseStages = pgTable(
  "case_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseType: caseTypeEnum("case_type").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull(),
    sortOrder: integer("sort_order").notNull(),
    color: text("color").notNull(),
    isCustom: boolean("is_custom").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("case_stages_type_slug_unique").on(table.caseType, table.slug),
    index("case_stages_case_type_idx").on(table.caseType),
  ],
);

export const stageTaskTemplates = pgTable(
  "stage_task_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageId: uuid("stage_id").references(() => caseStages.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    priority: taskPriorityEnum("priority").default("medium").notNull(),
    category: text("category").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    index("stage_task_templates_stage_id_idx").on(table.stageId),
  ],
);

export const caseEvents = pgTable(
  "case_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    type: eventTypeEnum("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_events_case_occurred_idx").on(table.caseId, table.occurredAt),
  ],
);
