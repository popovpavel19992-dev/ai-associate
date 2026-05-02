import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { cases } from "@/server/db/schema/cases";
import { caseDepositionOutlines } from "@/server/db/schema/case-deposition-outlines";
import { caseDepositionTopics } from "@/server/db/schema/case-deposition-topics";
import { caseDepositionQuestions } from "@/server/db/schema/case-deposition-questions";
import {
  caseDepositionTopicBranches,
  type CaseDepositionTopicBranches,
  type QuestionSnapshot,
} from "@/server/db/schema/case-deposition-topic-branches";
import { opposingCounselPostures } from "@/server/db/schema/opposing-counsel-postures";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { collectDeponentSources } from "./sources";
import { generateBranches } from "./generate";
import { computeQuestionsHash } from "./compute";

const COST = 2;

export class NotBetaOrgError extends Error {
  constructor() {
    super("Org not in AI beta");
    this.name = "NotBetaOrgError";
  }
}
export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}
export class NoQuestionsError extends Error {
  constructor() {
    super("Topic has no questions");
    this.name = "NoQuestionsError";
  }
}
export class TopicNotFoundError extends Error {
  constructor() {
    super("Topic not found");
    this.name = "TopicNotFoundError";
  }
}
export class OutlineNotFoundError extends Error {
  constructor() {
    super("Outline not found");
    this.name = "OutlineNotFoundError";
  }
}

function assertBetaOrg(orgId: string) {
  const allowed = (process.env.STRATEGY_BETA_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(orgId)) throw new NotBetaOrgError();
}

function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface GenerateBranchesArgs {
  orgId: string;
  userId: string;
  caseId: string;
  outlineId: string;
  topicId: string;
  regenerateSalt?: number;
}

export async function generateBranchesFlow(
  args: GenerateBranchesArgs,
): Promise<CaseDepositionTopicBranches> {
  assertBetaOrg(args.orgId);

  // Load outline first (org+case scoped) to enforce defense-in-depth scope.
  const [outline] = await db
    .select()
    .from(caseDepositionOutlines)
    .where(
      and(
        eq(caseDepositionOutlines.id, args.outlineId),
        eq(caseDepositionOutlines.orgId, args.orgId),
        eq(caseDepositionOutlines.caseId, args.caseId),
      ),
    );
  if (!outline) throw new OutlineNotFoundError();

  const [topic] = await db
    .select()
    .from(caseDepositionTopics)
    .where(
      and(
        eq(caseDepositionTopics.id, args.topicId),
        eq(caseDepositionTopics.outlineId, args.outlineId),
      ),
    );
  if (!topic) throw new TopicNotFoundError();

  const questions = await db
    .select()
    .from(caseDepositionQuestions)
    .where(eq(caseDepositionQuestions.topicId, args.topicId))
    .orderBy(asc(caseDepositionQuestions.questionOrder));
  if (questions.length === 0) throw new NoQuestionsError();

  const questionsHash = computeQuestionsHash(
    questions.map((q) => ({ id: q.id, text: q.text })),
  );
  const cacheHash = sha(
    `${args.topicId}:${questionsHash}:${args.regenerateSalt ?? 0}`,
  );

  const hits = await db
    .select()
    .from(caseDepositionTopicBranches)
    .where(
      and(
        eq(caseDepositionTopicBranches.orgId, args.orgId),
        eq(caseDepositionTopicBranches.cacheHash, cacheHash),
      ),
    );
  if (hits[0]) return hits[0];

  const ok = await decrementCredits(args.userId, COST);
  if (!ok) throw new InsufficientCreditsError();

  try {
    const [c] = await db
      .select({ name: cases.name, description: cases.description })
      .from(cases)
      .where(and(eq(cases.id, args.caseId), eq(cases.orgId, args.orgId)));
    const caseSummary = (c?.description ?? c?.name) ?? "";

    const sources = await collectDeponentSources({
      caseId: args.caseId,
      deponentName: outline.deponentName,
      deponentRole: outline.deponentRole,
    });

    const postureRows = await db
      .select()
      .from(opposingCounselPostures)
      .where(
        and(
          eq(opposingCounselPostures.orgId, args.orgId),
          eq(opposingCounselPostures.caseId, args.caseId),
        ),
      )
      .orderBy(desc(opposingCounselPostures.createdAt))
      .limit(1);
    const posture = postureRows[0];

    const result = await generateBranches({
      topic: { id: topic.id, title: topic.title, category: topic.category },
      questions: questions.map((q) => ({
        id: q.id,
        number: q.questionOrder,
        text: q.text,
      })),
      outline: {
        deponentName: outline.deponentName,
        deponentRole: outline.deponentRole,
        servingParty: outline.servingParty,
      },
      caseSummary,
      sources,
      posture: posture
        ? {
            aggressiveness: posture.aggressiveness,
            settleHigh:
              posture.settleHigh != null ? Number(posture.settleHigh) : null,
            reasoningMd: posture.reasoningMd,
          }
        : null,
    });

    const snapshot: QuestionSnapshot[] = questions.map((q) => ({
      questionId: q.id,
      number: q.questionOrder,
      text: q.text,
    }));

    const inserted = await db
      .insert(caseDepositionTopicBranches)
      .values({
        orgId: args.orgId,
        caseId: args.caseId,
        outlineId: args.outlineId,
        topicId: args.topicId,
        cacheHash,
        questionsSnapshot: snapshot,
        branchesJson: result.questions,
        reasoningMd: result.reasoningMd,
        sourcesJson: result.sources,
        confidenceOverall: result.confidenceOverall,
      })
      .returning();
    return inserted[0];
  } catch (e) {
    await refundCredits(args.userId, COST);
    throw e;
  }
}

export async function getBranchesForTopic(args: {
  orgId: string;
  caseId: string;
  topicId: string;
}): Promise<CaseDepositionTopicBranches | null> {
  const [row] = await db
    .select()
    .from(caseDepositionTopicBranches)
    .where(
      and(
        eq(caseDepositionTopicBranches.orgId, args.orgId),
        eq(caseDepositionTopicBranches.caseId, args.caseId),
        eq(caseDepositionTopicBranches.topicId, args.topicId),
      ),
    )
    .orderBy(desc(caseDepositionTopicBranches.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listBranchesForOutline(args: {
  orgId: string;
  outlineId: string;
}): Promise<CaseDepositionTopicBranches[]> {
  const rows = await db
    .select()
    .from(caseDepositionTopicBranches)
    .where(
      and(
        eq(caseDepositionTopicBranches.orgId, args.orgId),
        eq(caseDepositionTopicBranches.outlineId, args.outlineId),
      ),
    )
    .orderBy(desc(caseDepositionTopicBranches.createdAt));
  // Keep only the latest row per topicId.
  const byTopic = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!byTopic.has(r.topicId)) byTopic.set(r.topicId, r);
  return Array.from(byTopic.values());
}
