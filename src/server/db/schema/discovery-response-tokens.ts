import { pgTable, uuid, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { caseDiscoveryRequests } from "./case-discovery-requests";

export const discoveryResponseTokens = pgTable(
  "discovery_response_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .references(() => caseDiscoveryRequests.id, { onDelete: "cascade" })
      .notNull(),
    opposingPartyEmail: text("opposing_party_email").notNull(),
    opposingPartyName: text("opposing_party_name"),
    tokenHash: text("token_hash").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  },
  (table) => [
    unique("discovery_response_tokens_request_email_unique").on(
      table.requestId,
      table.opposingPartyEmail,
    ),
    index("discovery_response_tokens_hash_idx").on(table.tokenHash),
    index("discovery_response_tokens_request_idx").on(table.requestId),
  ],
);

export type DiscoveryResponseToken = typeof discoveryResponseTokens.$inferSelect;
export type NewDiscoveryResponseToken = typeof discoveryResponseTokens.$inferInsert;
