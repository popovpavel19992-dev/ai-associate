import { pgTable, uuid, text, integer, timestamp, jsonb, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseDiscoveryRequests } from "./case-discovery-requests";
import { discoveryResponseTokens } from "./discovery-response-tokens";

export type ResponseType =
  | "admit"
  | "deny"
  | "object"
  | "lack_of_knowledge"
  | "written_response"
  | "produced_documents";

export const discoveryResponses = pgTable(
  "discovery_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .references(() => caseDiscoveryRequests.id, { onDelete: "cascade" })
      .notNull(),
    tokenId: uuid("token_id").references(() => discoveryResponseTokens.id, {
      onDelete: "set null",
    }),
    questionIndex: integer("question_index").notNull(),
    responseType: text("response_type").$type<ResponseType>().notNull(),
    responseText: text("response_text"),
    objectionBasis: text("objection_basis"),
    producedDocDescriptions: jsonb("produced_doc_descriptions")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    responderName: text("responder_name"),
    responderEmail: text("responder_email").notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("discovery_responses_request_q_email_unique").on(
      table.requestId,
      table.questionIndex,
      table.responderEmail,
    ),
    index("discovery_responses_request_idx").on(table.requestId, table.questionIndex),
    check(
      "discovery_responses_response_type_check",
      sql`${table.responseType} IN ('admit','deny','object','lack_of_knowledge','written_response','produced_documents')`,
    ),
    check(
      "discovery_responses_question_index_check",
      sql`${table.questionIndex} >= 0 AND ${table.questionIndex} <= 200`,
    ),
  ],
);

export type DiscoveryResponse = typeof discoveryResponses.$inferSelect;
export type NewDiscoveryResponse = typeof discoveryResponses.$inferInsert;
