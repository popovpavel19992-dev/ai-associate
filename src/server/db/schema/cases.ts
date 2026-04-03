import { pgTable, uuid, text, timestamp, jsonb, boolean, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizations } from "./organizations";

export const caseStatusEnum = pgEnum("case_status", ["draft", "processing", "ready", "failed"]);

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  orgId: uuid("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  status: caseStatusEnum("status").default("draft").notNull(),
  detectedCaseType: text("detected_case_type"),
  overrideCaseType: text("override_case_type"),
  jurisdictionOverride: text("jurisdiction_override"),
  selectedSections: jsonb("selected_sections").$type<string[]>(),
  sectionsLocked: boolean("sections_locked").default(false).notNull(),
  caseBrief: jsonb("case_brief"),
  deleteAt: timestamp("delete_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
