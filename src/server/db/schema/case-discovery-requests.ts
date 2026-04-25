import { pgTable, uuid, text, jsonb, integer, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";

export type DiscoveryQuestion = {
  number: number;
  text: string;
  source?: "library" | "ai" | "manual";
  subparts?: string[];
};

export const caseDiscoveryRequests = pgTable(
  "case_discovery_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    requestType: text("request_type").notNull().default("interrogatories"),
    servingParty: text("serving_party").notNull(),
    setNumber: integer("set_number").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    templateSource: text("template_source"),
    questions: jsonb("questions").$type<DiscoveryQuestion[]>().notNull().default(sql`'[]'::jsonb`),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    servedAt: timestamp("served_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_discovery_requests_set_idx").on(table.caseId, table.requestType, table.setNumber),
    unique("case_discovery_requests_set_unique").on(table.caseId, table.requestType, table.setNumber),
    check(
      "case_discovery_requests_request_type_check",
      sql`${table.requestType} IN ('interrogatories','rfp','rfa')`,
    ),
    check(
      "case_discovery_requests_serving_party_check",
      sql`${table.servingParty} IN ('plaintiff','defendant')`,
    ),
    check(
      "case_discovery_requests_status_check",
      sql`${table.status} IN ('draft','final','served','closed')`,
    ),
    check(
      "case_discovery_requests_set_number_check",
      sql`${table.setNumber} BETWEEN 1 AND 99`,
    ),
  ],
);

export type CaseDiscoveryRequest = typeof caseDiscoveryRequests.$inferSelect;
export type NewCaseDiscoveryRequest = typeof caseDiscoveryRequests.$inferInsert;
