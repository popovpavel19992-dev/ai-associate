import { pgTable, uuid, text, timestamp, jsonb, integer, index, varchar } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { caseStages, stageTaskTemplates, taskStatusEnum, taskPriorityEnum, taskCategoryEnum } from "./case-stages";
import { users } from "./users";

export type ChecklistItem = {
  id: string;
  title: string;
  completed: boolean;
};

export const caseTasks = pgTable(
  "case_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    stageId: uuid("stage_id").references(() => caseStages.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => stageTaskTemplates.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: taskStatusEnum("status").default("todo").notNull(),
    priority: taskPriorityEnum("priority").default("medium").notNull(),
    category: taskCategoryEnum("category"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    checklist: jsonb("checklist").$type<ChecklistItem[]>().default([]).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_tasks_case_status_idx").on(table.caseId, table.status),
    index("case_tasks_case_stage_idx").on(table.caseId, table.stageId),
    index("case_tasks_case_stage_template_idx").on(table.caseId, table.stageId, table.templateId),
  ],
);
