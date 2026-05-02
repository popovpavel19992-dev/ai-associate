import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { caseWitnesses } from "./case-witnesses";

export const CONTRADICTION_KIND = ["self", "evidence"] as const;
export type ContradictionKind = (typeof CONTRADICTION_KIND)[number];

export const SEVERITY = ["direct", "inferred", "tangential"] as const;
export type Severity = (typeof SEVERITY)[number];

export interface QuoteRef {
  text: string;
  /** Either statementId (within an attached statement) or documentId (case doc). Exactly one set. */
  statementId?: string | null;
  documentId?: string | null;
  locator: string | null;
}

export interface Contradiction {
  id: string;
  kind: ContradictionKind;
  severity: Severity;
  summary: string;
  leftQuote: QuoteRef;
  rightQuote: QuoteRef;
  /** 2-3 ready-to-use cross-examination questions. */
  impeachmentQuestions: string[];
}

export interface ExtractedClaim {
  id: string;
  text: string;
  locator: string | null;
  topic: string;
}

export interface ClaimsByStatement {
  statementId: string;
  claims: ExtractedClaim[];
}

export interface StatementSnapshot {
  statementId: string;
  documentId: string;
  statementKind: string;
  statementDate: string | null;
  /** sha256 of the statement document's extractedText at scan time. */
  contentHash: string;
}

export const caseWitnessImpeachmentScans = pgTable(
  "case_witness_impeachment_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    witnessId: uuid("witness_id").references(() => caseWitnesses.id, { onDelete: "cascade" }).notNull(),
    cacheHash: text("cache_hash").notNull(),

    statementsSnapshot: jsonb("statements_snapshot").$type<StatementSnapshot[]>().notNull(),
    claimsJson: jsonb("claims_json").$type<ClaimsByStatement[]>().notNull(),
    contradictionsJson: jsonb("contradictions_json").$type<Contradiction[]>().notNull(),

    reasoningMd: text("reasoning_md").notNull(),
    sourcesJson: jsonb("sources_json").$type<Array<{ id: string; title: string }>>().notNull(),
    confidenceOverall: text("confidence_overall").$type<"low" | "med" | "high" | null>(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cwis_cache_uq").on(table.orgId, table.cacheHash).where(sql`${table.cacheHash} IS NOT NULL`),
    index("cwis_witness_idx").on(table.witnessId, table.createdAt),
    index("cwis_case_idx").on(table.caseId, table.createdAt),
    check(
      "cwis_confidence_check",
      sql`${table.confidenceOverall} IS NULL OR ${table.confidenceOverall} IN ('low','med','high')`,
    ),
  ],
);

export type CaseWitnessImpeachmentScan = typeof caseWitnessImpeachmentScans.$inferSelect;
export type NewCaseWitnessImpeachmentScan = typeof caseWitnessImpeachmentScans.$inferInsert;
