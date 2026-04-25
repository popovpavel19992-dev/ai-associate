import { pgTable, uuid, text, jsonb, boolean, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

export const discoveryRequestTemplates = pgTable(
  "discovery_request_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    caseType: text("case_type").notNull(),
    requestType: text("request_type").notNull().default("interrogatories"),
    title: text("title").notNull(),
    description: text("description"),
    questions: jsonb("questions").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("discovery_request_templates_lookup_idx").on(table.orgId, table.caseType, table.isActive),
    index("discovery_request_templates_request_type_idx").on(
      table.requestType,
      table.caseType,
      table.isActive,
    ),
    check(
      "discovery_request_templates_case_type_check",
      sql`${table.caseType} IN ('employment','contract','personal_injury','general')`,
    ),
    check(
      "discovery_request_templates_request_type_check",
      sql`${table.requestType} IN ('interrogatories','rfp','rfa')`,
    ),
  ],
);

export type DiscoveryRequestTemplate = typeof discoveryRequestTemplates.$inferSelect;
export type NewDiscoveryRequestTemplate = typeof discoveryRequestTemplates.$inferInsert;
