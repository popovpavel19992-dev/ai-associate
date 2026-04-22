import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseSignatureRequests } from "./case-signature-requests";
import { users } from "./users";
import { clientContacts } from "./client-contacts";

export const caseSignatureRequestSigners = pgTable(
  "case_signature_request_signers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").references(() => caseSignatureRequests.id, { onDelete: "cascade" }).notNull(),
    signerRole: text("signer_role").notNull(),
    signerOrder: integer("signer_order").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    clientContactId: uuid("client_contact_id").references(() => clientContacts.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    hellosignSignatureId: text("hellosign_signature_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_signature_request_signers_request_order_idx").on(table.requestId, table.signerOrder),
    check(
      "case_signature_request_signers_role_check",
      sql`${table.signerRole} IN ('client','lawyer')`,
    ),
    check(
      "case_signature_request_signers_status_check",
      sql`${table.status} IN ('awaiting_turn','awaiting_signature','signed','declined')`,
    ),
  ],
);

export type CaseSignatureRequestSigner = typeof caseSignatureRequestSigners.$inferSelect;
export type NewCaseSignatureRequestSigner = typeof caseSignatureRequestSigners.$inferInsert;
