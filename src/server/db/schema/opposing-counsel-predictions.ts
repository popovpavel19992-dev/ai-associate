import { pgTable, uuid, text, timestamp, index, uniqueIndex, numeric, integer, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { opposingCounselProfiles } from "./opposing-counsel-profiles";

export const PREDICTION_TARGET_KIND = ["motion", "demand_letter", "discovery_set"] as const;
export type PredictionTargetKind = (typeof PREDICTION_TARGET_KIND)[number];

export const opposingCounselPredictions = pgTable(
  "opposing_counsel_predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    profileId: uuid("profile_id").references(() => opposingCounselProfiles.id, { onDelete: "set null" }),
    targetKind: text("target_kind").$type<PredictionTargetKind>().notNull(),
    targetId: uuid("target_id").notNull(),
    cacheHash: text("cache_hash").notNull(),
    likelyResponse: text("likely_response").notNull(),
    keyObjections: jsonb("key_objections").notNull(),
    settleProbLow: numeric("settle_prob_low", { precision: 3, scale: 2 }),
    settleProbHigh: numeric("settle_prob_high", { precision: 3, scale: 2 }),
    estResponseDaysLow: integer("est_response_days_low"),
    estResponseDaysHigh: integer("est_response_days_high"),
    aggressiveness: integer("aggressiveness"),
    recommendedPrep: jsonb("recommended_prep"),
    reasoningMd: text("reasoning_md").notNull(),
    sourcesJson: jsonb("sources_json").notNull(),
    confidenceOverall: text("confidence_overall").$type<"low" | "med" | "high" | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ocp_pred_cache_uq").on(table.orgId, table.cacheHash),
    index("ocp_pred_case_target_idx").on(table.caseId, table.targetKind, table.targetId),
    check(
      "ocp_pred_target_kind_check",
      sql`${table.targetKind} IN ('motion','demand_letter','discovery_set')`,
    ),
    check(
      "ocp_pred_confidence_check",
      sql`${table.confidenceOverall} IS NULL OR ${table.confidenceOverall} IN ('low','med','high')`,
    ),
  ],
);

export type OpposingCounselPrediction = typeof opposingCounselPredictions.$inferSelect;
export type NewOpposingCounselPrediction = typeof opposingCounselPredictions.$inferInsert;
