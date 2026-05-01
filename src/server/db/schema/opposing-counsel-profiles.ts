import { pgTable, uuid, text, timestamp, index, uniqueIndex, numeric, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { caseParties } from "./case-parties";

export const opposingCounselProfiles = pgTable(
  "opposing_counsel_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    casePartyId: uuid("case_party_id").references(() => caseParties.id, { onDelete: "cascade" }).notNull(),
    clPersonId: text("cl_person_id"),
    clFirmName: text("cl_firm_name"),
    barNumber: text("bar_number"),
    barState: text("bar_state"),
    matchConfidence: numeric("match_confidence", { precision: 3, scale: 2 }),
    enrichmentJson: jsonb("enrichment_json"),
    enrichmentFetchedAt: timestamp("enrichment_fetched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ocp_org_party_uq").on(table.orgId, table.casePartyId),
    index("ocp_cl_person_idx").on(table.orgId, table.clPersonId).where(sql`${table.clPersonId} IS NOT NULL`),
  ],
);

export type OpposingCounselProfile = typeof opposingCounselProfiles.$inferSelect;
export type NewOpposingCounselProfile = typeof opposingCounselProfiles.$inferInsert;
