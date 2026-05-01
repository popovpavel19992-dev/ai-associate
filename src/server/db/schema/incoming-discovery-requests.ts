import { pgTable, uuid, text, jsonb, integer, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";
import { documents } from "./documents";

export type ParsedQuestion = {
  number: number;
  text: string;
  subparts?: string[];
};

export const incomingDiscoveryRequests = pgTable(
  "incoming_discovery_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    requestType: text("request_type").notNull(),
    setNumber: integer("set_number").notNull(),
    servingParty: text("serving_party").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("parsed"),
    sourceText: text("source_text"),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "set null" }),
    questions: jsonb("questions").$type<ParsedQuestion[]>().notNull().default(sql`'[]'::jsonb`),
    servedAt: timestamp("served_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("incoming_discovery_requests_case_idx").on(t.caseId, t.requestType, t.setNumber),
    uniqueIndex("incoming_discovery_requests_set_unique").on(t.caseId, t.requestType, t.setNumber),
    check(
      "incoming_discovery_requests_request_type_check",
      sql`${t.requestType} IN ('interrogatories','rfp','rfa')`,
    ),
    check(
      "incoming_discovery_requests_status_check",
      sql`${t.status} IN ('parsed','responding','served')`,
    ),
    check(
      "incoming_discovery_requests_set_number_check",
      sql`${t.setNumber} BETWEEN 1 AND 99`,
    ),
  ],
);

export type IncomingDiscoveryRequest = typeof incomingDiscoveryRequests.$inferSelect;
export type NewIncomingDiscoveryRequest = typeof incomingDiscoveryRequests.$inferInsert;
