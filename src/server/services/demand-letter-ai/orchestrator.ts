import { createHash } from "node:crypto";
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/server/db";
import {
  caseDemandLetters,
  type DemandClaimType,
  type DemandLetterType,
} from "@/server/db/schema/case-demand-letters";
import {
  caseDemandLetterSections,
  type DemandLetterSectionKey,
} from "@/server/db/schema/case-demand-letter-sections";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { classifyClaim } from "./classify";
import {
  fetchCaseDocsExcerpts,
  fetchStatutesForClaim,
} from "./sources";
import { draftSection, SECTION_KEYS } from "./draft";

const COST = 3;

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}
export class NotBetaOrgError extends Error {
  constructor() {
    super("Org not in AI beta");
    this.name = "NotBetaOrgError";
  }
}

function assertBetaOrg(orgId: string) {
  const allowed = (process.env.STRATEGY_BETA_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(orgId)) throw new NotBetaOrgError();
}

function computeCacheHash(
  caseId: string,
  claimType: DemandClaimType,
  amountCents: number,
): string {
  return createHash("sha256")
    .update(`${caseId}:${claimType}:${amountCents}`)
    .digest("hex");
}

export interface AiSuggestArgs {
  caseId: string;
  caseTitle: string;
  caseSummary: string;
  documentTitles: string[];
  userId: string;
  orgId: string;
}

export async function aiSuggest(args: AiSuggestArgs) {
  assertBetaOrg(args.orgId);
  return classifyClaim({
    caseTitle: args.caseTitle,
    caseSummary: args.caseSummary,
    documentTitles: args.documentTitles,
  });
}

export interface AiGenerateArgs {
  caseId: string;
  claimType: DemandClaimType;
  claimTypeConfidence?: number;
  demandAmountCents: number;
  deadlineDate: string;
  recipientName: string;
  recipientAddress: string;
  recipientEmail?: string | null;
  summary: string;
  letterType: DemandLetterType;
  userId: string;
  orgId: string;
}

export interface AiGenerateResult {
  letterId: string;
  letterNumber: number;
  sections: Array<{ sectionKey: DemandLetterSectionKey; contentMd: string }>;
  cached: boolean;
}

export async function aiGenerate(
  args: AiGenerateArgs,
): Promise<AiGenerateResult> {
  assertBetaOrg(args.orgId);
  const cacheHash = computeCacheHash(
    args.caseId,
    args.claimType,
    args.demandAmountCents,
  );

  const [existing] = await db
    .select()
    .from(caseDemandLetters)
    .where(
      and(
        eq(caseDemandLetters.orgId, args.orgId),
        eq(caseDemandLetters.cacheHash, cacheHash),
      ),
    )
    .limit(1);

  if (existing) {
    const sections = await db
      .select()
      .from(caseDemandLetterSections)
      .where(eq(caseDemandLetterSections.letterId, existing.id))
      .orderBy(asc(caseDemandLetterSections.sectionKey));
    return {
      letterId: existing.id,
      letterNumber: existing.letterNumber,
      sections: sections.map((s) => ({
        sectionKey: s.sectionKey,
        contentMd: s.contentMd,
      })),
      cached: true,
    };
  }

  const ok = await decrementCredits(args.userId, COST);
  if (!ok) throw new InsufficientCreditsError();

  try {
    const [excerpts, statutes] = await Promise.all([
      fetchCaseDocsExcerpts(args.caseId, args.summary, 5),
      fetchStatutesForClaim(args.claimType, 3),
    ]);

    const ctx = {
      claimType: args.claimType,
      caseTitle: args.recipientName,
      recipientName: args.recipientName,
      demandAmountCents: args.demandAmountCents,
      deadlineDate: args.deadlineDate,
      summary: args.summary,
      caseExcerpts: excerpts,
      statutes,
    };

    const sectionContents: Array<{
      sectionKey: DemandLetterSectionKey;
      contentMd: string;
    }> = [];
    for (const key of SECTION_KEYS) {
      const md = await draftSection(key, ctx);
      sectionContents.push({ sectionKey: key, contentMd: md });
    }

    const result = await db.transaction(async (tx) => {
      const nextNum = await getNextLetterNumber(tx, args.caseId);
      const [inserted] = await (tx as typeof db)
        .insert(caseDemandLetters)
        .values({
          orgId: args.orgId,
          caseId: args.caseId,
          letterNumber: nextNum,
          letterType: args.letterType,
          recipientName: args.recipientName,
          recipientAddress: args.recipientAddress,
          recipientEmail: args.recipientEmail ?? null,
          demandAmountCents: args.demandAmountCents,
          deadlineDate: args.deadlineDate,
          status: "draft",
          createdBy: args.userId,
          claimType: args.claimType,
          claimTypeConfidence: args.claimTypeConfidence
            ? String(args.claimTypeConfidence)
            : null,
          cacheHash,
          aiSummary: args.summary,
          aiGenerated: true,
        })
        .returning({
          id: caseDemandLetters.id,
          letterNumber: caseDemandLetters.letterNumber,
        });

      await (tx as typeof db)
        .insert(caseDemandLetterSections)
        .values(
          sectionContents.map((s) => ({
            letterId: inserted.id,
            sectionKey: s.sectionKey,
            contentMd: s.contentMd,
          })),
        )
        .returning();
      return inserted;
    });

    return {
      letterId: result.id,
      letterNumber: result.letterNumber,
      sections: sectionContents,
      cached: false,
    };
  } catch (err) {
    await refundCredits(args.userId, COST);
    throw err;
  }
}

async function getNextLetterNumber(
  tx: unknown,
  caseId: string,
): Promise<number> {
  const rows = await (tx as typeof db)
    .select({ n: caseDemandLetters.letterNumber })
    .from(caseDemandLetters)
    .where(eq(caseDemandLetters.caseId, caseId))
    .limit(999);
  const max = (rows as Array<{ n: number }>).reduce(
    (m: number, r: { n: number }) => (r.n > m ? r.n : m),
    0,
  );
  return max + 1;
}

export interface RegenerateArgs {
  letterId: string;
  sectionKey: DemandLetterSectionKey;
  userId: string;
  orgId: string;
}

export async function aiRegenerateSection(args: RegenerateArgs) {
  assertBetaOrg(args.orgId);
  const [letter] = await db
    .select()
    .from(caseDemandLetters)
    .where(
      and(
        eq(caseDemandLetters.id, args.letterId),
        eq(caseDemandLetters.orgId, args.orgId),
      ),
    )
    .limit(1);
  if (!letter || !letter.aiGenerated) throw new Error("NOT_FOUND");
  if (letter.status !== "draft")
    throw new Error("Only draft demand letters can be regenerated");

  const [excerpts, statutes] = await Promise.all([
    fetchCaseDocsExcerpts(letter.caseId, letter.aiSummary ?? "", 5),
    fetchStatutesForClaim(letter.claimType as DemandClaimType, 3),
  ]);

  const md = await draftSection(args.sectionKey, {
    claimType: letter.claimType as DemandClaimType,
    caseTitle: letter.recipientName,
    recipientName: letter.recipientName,
    demandAmountCents: letter.demandAmountCents ?? 0,
    deadlineDate: (letter.deadlineDate as unknown as string) ?? "",
    summary: letter.aiSummary ?? "",
    caseExcerpts: excerpts,
    statutes,
  });

  await db
    .update(caseDemandLetterSections)
    .set({ contentMd: md, regeneratedAt: new Date() })
    .where(
      and(
        eq(caseDemandLetterSections.letterId, args.letterId),
        eq(caseDemandLetterSections.sectionKey, args.sectionKey),
      ),
    );

  return { contentMd: md };
}

export async function aiGetSections(letterId: string, orgId: string) {
  assertBetaOrg(orgId);
  const [letter] = await db
    .select()
    .from(caseDemandLetters)
    .where(
      and(
        eq(caseDemandLetters.id, letterId),
        eq(caseDemandLetters.orgId, orgId),
      ),
    )
    .limit(1);
  if (!letter) throw new Error("NOT_FOUND");
  const sections = await db
    .select()
    .from(caseDemandLetterSections)
    .where(eq(caseDemandLetterSections.letterId, letterId))
    .orderBy(asc(caseDemandLetterSections.sectionKey));
  return sections.map((s) => ({
    sectionKey: s.sectionKey,
    contentMd: s.contentMd,
  }));
}
