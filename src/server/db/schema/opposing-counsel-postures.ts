import { pgTable, uuid, text, timestamp, index, uniqueIndex, numeric, integer, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { opposingCounselProfiles } from "./opposing-counsel-profiles";

export const opposingCounselPostures = pgTable(
  "opposing_counsel_postures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    profileId: uuid("profile_id").references(() => opposingCounselProfiles.id, { onDelete: "cascade" }).notNull(),
    cacheHash: text("cache_hash").notNull(),
    aggressiveness: integer("aggressiveness"),
    settleLikelihood: numeric("settle_likelihood", { precision: 3, scale: 2 }),
    settleLow: numeric("settle_low", { precision: 3, scale: 2 }),
    settleHigh: numeric("settle_high", { precision: 3, scale: 2 }),
    typicalMotions: jsonb("typical_motions"),
    reasoningMd: text("reasoning_md").notNull(),
    sourcesJson: jsonb("sources_json").notNull(),
    confidenceOverall: text("confidence_overall").$type<"low" | "med" | "high" | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ocp_posture_cache_uq").on(table.orgId, table.cacheHash),
    index("ocp_posture_case_idx").on(table.caseId),
    check(
      "ocp_posture_confidence_check",
      sql`${table.confidenceOverall} IS NULL OR ${table.confidenceOverall} IN ('low','med','high')`,
    ),
  ],
);

export type OpposingCounselPosture = typeof opposingCounselPostures.$inferSelect;
export type NewOpposingCounselPosture = typeof opposingCounselPostures.$inferInsert;
