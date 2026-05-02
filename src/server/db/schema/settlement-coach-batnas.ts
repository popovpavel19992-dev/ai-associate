import { pgTable, uuid, text, timestamp, index, uniqueIndex, numeric, integer, bigint, jsonb, boolean, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";

export const settlementCoachBatnas = pgTable(
  "settlement_coach_batnas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    cacheHash: text("cache_hash").notNull(),

    damagesLowCents: bigint("damages_low_cents", { mode: "number" }),
    damagesLikelyCents: bigint("damages_likely_cents", { mode: "number" }),
    damagesHighCents: bigint("damages_high_cents", { mode: "number" }),
    damagesComponents: jsonb("damages_components").notNull(),

    winProbLow: numeric("win_prob_low", { precision: 3, scale: 2 }),
    winProbLikely: numeric("win_prob_likely", { precision: 3, scale: 2 }),
    winProbHigh: numeric("win_prob_high", { precision: 3, scale: 2 }),

    costsRemainingCents: bigint("costs_remaining_cents", { mode: "number" }),
    timeToTrialMonths: integer("time_to_trial_months"),
    discountRateAnnual: numeric("discount_rate_annual", { precision: 4, scale: 2 }),

    batnaLowCents: bigint("batna_low_cents", { mode: "number" }).notNull(),
    batnaLikelyCents: bigint("batna_likely_cents", { mode: "number" }).notNull(),
    batnaHighCents: bigint("batna_high_cents", { mode: "number" }).notNull(),
    zopaLowCents: bigint("zopa_low_cents", { mode: "number" }),
    zopaHighCents: bigint("zopa_high_cents", { mode: "number" }),
    zopaExists: boolean("zopa_exists").notNull(),

    sensitivityJson: jsonb("sensitivity_json").notNull(),

    reasoningMd: text("reasoning_md").notNull(),
    sourcesJson: jsonb("sources_json").notNull(),
    confidenceOverall: text("confidence_overall").$type<"low" | "med" | "high" | null>(),
    hasManualOverride: boolean("has_manual_override").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("scb_cache_uq").on(table.orgId, table.cacheHash).where(sql`${table.cacheHash} IS NOT NULL`),
    index("scb_case_idx").on(table.caseId, table.createdAt),
    check("scb_confidence_check", sql`${table.confidenceOverall} IS NULL OR ${table.confidenceOverall} IN ('low','med','high')`),
    check("scb_batna_low_high_check", sql`${table.batnaLowCents} <= ${table.batnaHighCents}`),
  ],
);

export type SettlementCoachBatna = typeof settlementCoachBatnas.$inferSelect;
export type NewSettlementCoachBatna = typeof settlementCoachBatnas.$inferInsert;
