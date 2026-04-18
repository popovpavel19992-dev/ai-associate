// src/server/services/research/memo-generation.ts
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { researchMemos, researchMemoSections } from "@/server/db/schema/research-memos";
import type { CachedStatute } from "@/server/db/schema/cached-statutes";
import { applyUplFilter } from "@/server/services/research/upl-filter";
import { validateCitations } from "@/server/services/research/citation-validator";
import type { OpinionCacheService } from "@/server/services/research/opinion-cache";
import type { StatuteCacheService } from "@/server/services/research/statute-cache";
import {
  SECTION_ORDER,
  assembleSectionUserMessage,
  ordOf,
  type MemoSectionType,
} from "./memo-prompts";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS_PER_SECTION = 1500;
const REPROMPT_THRESHOLD = 4;

const SYSTEM_PROMPT =
  "You are a legal research assistant for a licensed-attorney audience writing one section of an IRAC research memo. " +
  "You analyze ONLY the provided U.S. case law and statutes and give factual, well-cited prose. " +
  "You do NOT give legal advice, predict outcomes, recommend actions, or address the reader's specific situation. " +
  "Never use these words or phrases: should, must, recommend, advise, your rights, we suggest, best option, you have a case, legal advice. " +
  "Prefer: \"the court held\", \"this opinion indicates\", \"consider that\", \"typically courts in this circuit\", \"the provided opinions do not address\". " +
  "Every factual claim must cite a provided opinion or statute using its Bluebook citation. Do not invent citations. If uncertain, say so.";

export interface MemoGenerationDeps {
  db?: typeof defaultDb;
  anthropic?: Anthropic;
  opinionCache: OpinionCacheService;
  statuteCache: StatuteCacheService;
}

export interface SectionResult {
  section_type: MemoSectionType;
  ord: number;
  content: string;
  citations: string[];
  uplViolations: string[];
  unverifiedCitations: string[];
  tokenUsage: { input_tokens: number; output_tokens: number };
}

export class MemoGenerationService {
  private readonly db: typeof defaultDb;
  private readonly anthropic: Anthropic;
  private readonly opinionCache: OpinionCacheService;
  private readonly statuteCache: StatuteCacheService;

  constructor(deps: MemoGenerationDeps) {
    this.db = deps.db ?? defaultDb;
    this.anthropic = deps.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    this.opinionCache = deps.opinionCache;
    this.statuteCache = deps.statuteCache;
  }

  async generateAll(opts: { memoId: string }): Promise<{
    status: "ready" | "failed";
    sections: SectionResult[];
    flags: { unverifiedCitations: string[]; uplViolations: string[] };
    tokenUsage: { input_tokens: number; output_tokens: number };
  }> {
    const [memo] = await this.db
      .select()
      .from(researchMemos)
      .where(eq(researchMemos.id, opts.memoId))
      .limit(1);
    if (!memo) throw new Error(`Memo ${opts.memoId} not found`);

    const opinions = memo.contextOpinionIds.length
      ? await this.opinionCache.getByInternalIds(memo.contextOpinionIds)
      : [];
    const statutes: CachedStatute[] = memo.contextStatuteIds.length
      ? await this.statuteCache.getByInternalIds(memo.contextStatuteIds)
      : [];
    const contextBlock = renderContextBlock(opinions, statutes);
    const contextCitations = [
      ...opinions.map((o) => o.citationBluebook),
      ...statutes.map((s) => s.citationBluebook),
    ];

    const sections = await Promise.all(
      SECTION_ORDER.map((section) =>
        this.generateOne({ section, memoQuestion: memo.memoQuestion, contextBlock, contextCitations }),
      ),
    );

    const aggregatedFlags = {
      unverifiedCitations: sections.flatMap((s) => s.unverifiedCitations),
      uplViolations: sections.flatMap((s) => s.uplViolations),
    };
    const totalUsage = sections.reduce(
      (acc, s) => ({
        input_tokens: acc.input_tokens + s.tokenUsage.input_tokens,
        output_tokens: acc.output_tokens + s.tokenUsage.output_tokens,
      }),
      { input_tokens: 0, output_tokens: 0 },
    );

    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const s of sections) {
        await tx.insert(researchMemoSections).values({
          memoId: opts.memoId,
          sectionType: s.section_type,
          ord: s.ord,
          content: s.content,
          citations: s.citations,
          aiGeneratedAt: now,
        });
      }
      await tx
        .update(researchMemos)
        .set({
          status: "ready",
          flags: aggregatedFlags,
          tokenUsage: totalUsage,
          updatedAt: now,
        })
        .where(eq(researchMemos.id, opts.memoId));
    });

    return { status: "ready", sections, flags: aggregatedFlags, tokenUsage: totalUsage };
  }

  async generateOne(args: {
    section: MemoSectionType;
    memoQuestion: string;
    contextBlock: string;
    contextCitations: string[];
    steeringMessage?: string;
  }): Promise<SectionResult> {
    const userMessage = assembleSectionUserMessage(args);

    const turn = await this.streamOnce(userMessage);
    let filtered = applyUplFilter(turn.text);
    let unverified = validateCitations(filtered.filtered, args.contextCitations).unverified;

    if (unverified.length >= REPROMPT_THRESHOLD) {
      const followup =
        userMessage +
        `\n\nYour previous response cited ${unverified.join(", ")} which were not in the provided materials. ` +
        "Regenerate using only the provided materials.";
      const retry = await this.streamOnce(followup);
      filtered = applyUplFilter(retry.text);
      unverified = validateCitations(filtered.filtered, args.contextCitations).unverified;
    }

    const citations = extractCitations(filtered.filtered, args.contextCitations);

    return {
      section_type: args.section,
      ord: ordOf(args.section),
      content: filtered.filtered,
      citations,
      uplViolations: filtered.violations,
      unverifiedCitations: unverified,
      tokenUsage: turn.usage,
    };
  }

  private async streamOnce(userMessage: string): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
    const stream = this.anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS_PER_SECTION,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    let text = "";
    try {
      for await (const event of stream as AsyncIterable<unknown>) {
        const e = event as { type?: string; delta?: { type?: string; text?: string } };
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && typeof e.delta.text === "string") {
          text += e.delta.text;
        }
      }
      const final = await (stream as unknown as {
        finalMessage(): Promise<{
          content: Array<{ type: string; text?: string }>;
          usage: { input_tokens: number; output_tokens: number };
        }>;
      }).finalMessage();
      const usage = final.usage ?? { input_tokens: 0, output_tokens: 0 };
      return { text, usage };
    } finally {
      try {
        (stream as { abort?: () => void }).abort?.();
      } catch {
        /* noop */
      }
    }
  }
}

function renderContextBlock(
  opinions: { citationBluebook: string; fullText: string | null; caseName: string }[],
  statutes: CachedStatute[],
): string {
  const parts: string[] = [];
  opinions.forEach((o, i) => {
    const text = (o.fullText ?? "").slice(0, 6000);
    parts.push(`[Opinion ${i + 1}] ${o.caseName} (${o.citationBluebook})\n${text}`);
  });
  statutes.forEach((s, i) => {
    const text = (s.bodyText ?? "").slice(0, 4000);
    parts.push(`[Statute ${i + 1}] ${s.citationBluebook}\n${text}`);
  });
  return parts.join("\n\n---\n\n");
}

function extractCitations(text: string, contextCitations: string[]): string[] {
  const seen = new Set<string>();
  for (const c of contextCitations) {
    if (text.includes(c)) seen.add(c);
  }
  return Array.from(seen);
}
