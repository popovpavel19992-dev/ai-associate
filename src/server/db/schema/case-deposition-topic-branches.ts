import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { caseDepositionOutlines } from "./case-deposition-outlines";
import { caseDepositionTopics } from "./case-deposition-topics";

export const ANSWER_TYPES = ["admit", "deny", "evade", "idk"] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const LIKELIHOODS = ["low", "med", "high"] as const;
export type Likelihood = (typeof LIKELIHOODS)[number];

export interface QuestionSnapshot {
  questionId: string;
  number: number;
  text: string;
}
export interface FollowUp {
  text: string;
  purpose: string;
}
export interface Branch {
  answerType: AnswerType;
  likelyResponse: string;
  likelihood: Likelihood;
  followUps: FollowUp[];
}
export interface QuestionBranches {
  questionId: string;
  branches: Branch[];
}

export const caseDepositionTopicBranches = pgTable(
  "case_deposition_topic_branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    outlineId: uuid("outline_id").references(() => caseDepositionOutlines.id, { onDelete: "cascade" }).notNull(),
    topicId: uuid("topic_id").references(() => caseDepositionTopics.id, { onDelete: "cascade" }).notNull(),
    cacheHash: text("cache_hash").notNull(),

    questionsSnapshot: jsonb("questions_snapshot").$type<QuestionSnapshot[]>().notNull(),
    branchesJson: jsonb("branches_json").$type<QuestionBranches[]>().notNull(),

    reasoningMd: text("reasoning_md").notNull(),
    sourcesJson: jsonb("sources_json").$type<Array<{ id: string; title: string }>>().notNull(),
    confidenceOverall: text("confidence_overall").$type<Likelihood | null>(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cdtb_cache_uq").on(table.orgId, table.cacheHash).where(sql`${table.cacheHash} IS NOT NULL`),
    index("cdtb_topic_idx").on(table.topicId, table.createdAt),
    index("cdtb_outline_idx").on(table.outlineId, table.createdAt),
    check("cdtb_confidence_check", sql`${table.confidenceOverall} IS NULL OR ${table.confidenceOverall} IN ('low','med','high')`),
  ],
);

export type CaseDepositionTopicBranches = typeof caseDepositionTopicBranches.$inferSelect;
export type NewCaseDepositionTopicBranches = typeof caseDepositionTopicBranches.$inferInsert;
