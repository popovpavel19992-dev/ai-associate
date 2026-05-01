import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const citeTreatments = pgTable(
  "cite_treatments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    citeKey: text("cite_key").notNull(),
    citeType: text("cite_type").notNull(),
    status: text("status").notNull(),
    summary: text("summary"),
    signals: jsonb("signals"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("cite_treatments_key_idx").on(t.citeKey),
    index("cite_treatments_expires_idx").on(t.expiresAt),
    check("cite_treatments_type_check", sql`${t.citeType} IN ('opinion','statute')`),
    check(
      "cite_treatments_status_check",
      sql`${t.status} IN ('good_law','caution','overruled','unverified','not_found','malformed')`,
    ),
  ],
);

export type CiteTreatment = typeof citeTreatments.$inferSelect;
export type NewCiteTreatment = typeof citeTreatments.$inferInsert;
