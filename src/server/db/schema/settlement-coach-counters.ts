import { pgTable, uuid, text, timestamp, index, uniqueIndex, bigint, jsonb, boolean, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { caseSettlementOffers } from "./case-settlement-offers";
import { settlementCoachBatnas } from "./settlement-coach-batnas";

export const COUNTER_VARIANT_TAGS = ["aggressive", "standard", "conciliatory"] as const;
export type CounterVariantTag = (typeof COUNTER_VARIANT_TAGS)[number];

export const settlementCoachCounters = pgTable(
  "settlement_coach_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    offerId: uuid("offer_id").references(() => caseSettlementOffers.id, { onDelete: "cascade" }).notNull(),
    batnaId: uuid("batna_id").references(() => settlementCoachBatnas.id, { onDelete: "set null" }),
    cacheHash: text("cache_hash").notNull(),

    variantsJson: jsonb("variants_json").notNull(),

    boundsLowCents: bigint("bounds_low_cents", { mode: "number" }).notNull(),
    boundsHighCents: bigint("bounds_high_cents", { mode: "number" }).notNull(),
    anyClamped: boolean("any_clamped").notNull().default(false),

    reasoningMd: text("reasoning_md").notNull(),
    sourcesJson: jsonb("sources_json").notNull(),
    confidenceOverall: text("confidence_overall").$type<"low" | "med" | "high" | null>(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("scc_cache_uq").on(table.orgId, table.cacheHash).where(sql`${table.cacheHash} IS NOT NULL`),
    index("scc_offer_idx").on(table.offerId, table.createdAt),
    check("scc_confidence_check", sql`${table.confidenceOverall} IS NULL OR ${table.confidenceOverall} IN ('low','med','high')`),
    check("scc_bounds_check", sql`${table.boundsLowCents} <= ${table.boundsHighCents}`),
  ],
);

export type SettlementCoachCounter = typeof settlementCoachCounters.$inferSelect;
export type NewSettlementCoachCounter = typeof settlementCoachCounters.$inferInsert;
