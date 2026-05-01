import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { incomingDiscoveryRequests } from "./incoming-discovery-requests";

export type OurResponseType =
  | "admit"
  | "deny"
  | "object"
  | "lack_of_knowledge"
  | "written_response"
  | "produced_documents";

export const ourDiscoveryResponseDrafts = pgTable(
  "our_discovery_response_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").references(() => incomingDiscoveryRequests.id, { onDelete: "cascade" }).notNull(),
    questionIndex: integer("question_index").notNull(),
    responseType: text("response_type").$type<OurResponseType>().notNull(),
    responseText: text("response_text"),
    objectionBasis: text("objection_basis"),
    aiGenerated: boolean("ai_generated").notNull().default(true),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("our_discovery_response_drafts_request_idx").on(t.requestId, t.questionIndex),
    uniqueIndex("our_discovery_response_drafts_unique").on(t.requestId, t.questionIndex),
    check(
      "our_discovery_response_drafts_response_type_check",
      sql`${t.responseType} IN ('admit','deny','object','lack_of_knowledge','written_response','produced_documents')`,
    ),
    check(
      "our_discovery_response_drafts_question_index_check",
      sql`${t.questionIndex} >= 0`,
    ),
  ],
);

export type OurDiscoveryResponseDraft = typeof ourDiscoveryResponseDrafts.$inferSelect;
export type NewOurDiscoveryResponseDraft = typeof ourDiscoveryResponseDrafts.$inferInsert;
