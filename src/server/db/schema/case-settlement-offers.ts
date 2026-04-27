import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  index,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";

export const SETTLEMENT_OFFER_TYPE = [
  "opening_demand",
  "opening_offer",
  "counter_offer",
  "final_offer",
  "walkaway",
] as const;
export type SettlementOfferType = (typeof SETTLEMENT_OFFER_TYPE)[number];

export const SETTLEMENT_FROM_PARTY = ["plaintiff", "defendant"] as const;
export type SettlementFromParty = (typeof SETTLEMENT_FROM_PARTY)[number];

export const SETTLEMENT_RESPONSE = [
  "pending",
  "accepted",
  "rejected",
  "expired",
  "withdrawn",
] as const;
export type SettlementResponse = (typeof SETTLEMENT_RESPONSE)[number];

export const caseSettlementOffers = pgTable(
  "case_settlement_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    offerNumber: integer("offer_number").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    offerType: text("offer_type").$type<SettlementOfferType>().notNull(),
    fromParty: text("from_party").$type<SettlementFromParty>().notNull(),
    offeredAt: timestamp("offered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    terms: text("terms"),
    conditions: text("conditions"),
    response: text("response")
      .$type<SettlementResponse>()
      .notNull()
      .default("pending"),
    responseDate: timestamp("response_date", { withTimezone: true }),
    responseNotes: text("response_notes"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("case_settlement_offers_case_idx").on(
      table.caseId,
      table.offeredAt,
    ),
    unique("case_settlement_offers_case_number_unique").on(
      table.caseId,
      table.offerNumber,
    ),
    check(
      "case_settlement_offers_type_check",
      sql`${table.offerType} IN ('opening_demand','opening_offer','counter_offer','final_offer','walkaway')`,
    ),
    check(
      "case_settlement_offers_from_party_check",
      sql`${table.fromParty} IN ('plaintiff','defendant')`,
    ),
    check(
      "case_settlement_offers_response_check",
      sql`${table.response} IN ('pending','accepted','rejected','expired','withdrawn')`,
    ),
    check(
      "case_settlement_offers_number_check",
      sql`${table.offerNumber} BETWEEN 1 AND 999`,
    ),
    check(
      "case_settlement_offers_amount_check",
      sql`${table.amountCents} >= 0`,
    ),
  ],
);

export type CaseSettlementOffer = typeof caseSettlementOffers.$inferSelect;
export type NewCaseSettlementOffer = typeof caseSettlementOffers.$inferInsert;
