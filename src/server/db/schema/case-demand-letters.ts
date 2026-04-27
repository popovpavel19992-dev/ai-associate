import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  date,
  index,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";

export const DEMAND_LETTER_TYPE = [
  "initial_demand",
  "pre_litigation",
  "pre_trial",
  "response_to_demand",
] as const;
export type DemandLetterType = (typeof DEMAND_LETTER_TYPE)[number];

export const DEMAND_LETTER_STATUS = [
  "draft",
  "sent",
  "responded",
  "no_response",
  "rescinded",
] as const;
export type DemandLetterStatus = (typeof DEMAND_LETTER_STATUS)[number];

export const DEMAND_LETTER_METHOD = [
  "email",
  "mail",
  "certified_mail",
  "courier",
] as const;
export type DemandLetterMethod = (typeof DEMAND_LETTER_METHOD)[number];

export const caseDemandLetters = pgTable(
  "case_demand_letters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    letterNumber: integer("letter_number").notNull(),
    letterType: text("letter_type").$type<DemandLetterType>().notNull(),
    recipientName: text("recipient_name").notNull(),
    recipientAddress: text("recipient_address"),
    recipientEmail: text("recipient_email"),
    demandAmountCents: bigint("demand_amount_cents", { mode: "number" }),
    currency: text("currency").notNull().default("USD"),
    deadlineDate: date("deadline_date"),
    keyFacts: text("key_facts"),
    legalBasis: text("legal_basis"),
    demandTerms: text("demand_terms"),
    letterBody: text("letter_body"),
    status: text("status")
      .$type<DemandLetterStatus>()
      .notNull()
      .default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentMethod: text("sent_method").$type<DemandLetterMethod>(),
    responseReceivedAt: timestamp("response_received_at", {
      withTimezone: true,
    }),
    responseSummary: text("response_summary"),
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
    index("case_demand_letters_case_idx").on(table.caseId, table.status),
    unique("case_demand_letters_case_number_unique").on(
      table.caseId,
      table.letterNumber,
    ),
    check(
      "case_demand_letters_type_check",
      sql`${table.letterType} IN ('initial_demand','pre_litigation','pre_trial','response_to_demand')`,
    ),
    check(
      "case_demand_letters_status_check",
      sql`${table.status} IN ('draft','sent','responded','no_response','rescinded')`,
    ),
    check(
      "case_demand_letters_method_check",
      sql`${table.sentMethod} IS NULL OR ${table.sentMethod} IN ('email','mail','certified_mail','courier')`,
    ),
    check(
      "case_demand_letters_number_check",
      sql`${table.letterNumber} BETWEEN 1 AND 999`,
    ),
    check(
      "case_demand_letters_amount_check",
      sql`${table.demandAmountCents} IS NULL OR ${table.demandAmountCents} >= 0`,
    ),
  ],
);

export type CaseDemandLetter = typeof caseDemandLetters.$inferSelect;
export type NewCaseDemandLetter = typeof caseDemandLetters.$inferInsert;
