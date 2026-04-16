// src/server/services/research/legal-rag.ts
//
// Wires Claude streaming + citation validator + UPL filter + re-prompt +
// DB persistence into one cohesive RAG service for legal Q&A. Always
// streams; never stores raw model output — persisted content is always
// UPL-filtered. Citations are validated against the opinions provided as
// context, and the service re-prompts once when too many are unverified.

import Anthropic from "@anthropic-ai/sdk";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { researchChatMessages } from "@/server/db/schema/research-chat-messages";
import { cachedOpinions, type CachedOpinion } from "@/server/db/schema/cached-opinions";
import { applyUplFilter } from "@/server/services/research/upl-filter";
import { validateCitations } from "@/server/services/research/citation-validator";
import type { OpinionCacheService } from "@/server/services/research/opinion-cache";

export type ResearchMode = "broad" | "deep";

export interface StreamChunk {
  type: "token" | "done" | "error";
  content?: string;
  messageId?: string;
  flags?: { unverifiedCitations?: string[]; uplViolations?: string[] };
  error?: string;
}

export interface AskBroadInput {
  sessionId: string;
  userId: string;
  question: string;
  topN?: number;
}

export interface AskDeepInput {
  sessionId: string;
  userId: string;
  opinionInternalId: string;
  question: string;
}

export interface LegalRagServiceDeps {
  db?: typeof defaultDb;
  anthropic?: Anthropic;
  opinionCache: OpinionCacheService;
}

type ChatMsg = { role: "user" | "assistant"; content: string };
interface TurnResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
const MAX_CTX_CHARS = 40_000;
const TRIM_RATIO = 0.6;
const REPROMPT_THRESHOLD = 2;
const GIVE_UP_THRESHOLD = 4;
const HISTORY_LIMIT = 10;

const SYSTEM_PROMPT =
  "You are a legal research assistant for a licensed-attorney audience. You analyze provided U.S. case law and give factual, well-cited summaries.\n\n" +
  "You do NOT give legal advice, predict outcomes, recommend actions, or address the reader's specific situation. Use only the opinions provided in this context. If the provided opinions do not address the question, say so explicitly.\n\n" +
  "Never use these words or phrases: should, must, recommend, advise, your rights, we suggest, best option, you have a case, legal advice. Prefer: \"the court held\", \"this opinion indicates\", \"consider that\", \"typically courts in this circuit\", \"the provided opinions do not address\".\n\n" +
  "Every factual claim must cite a provided opinion using its Bluebook citation. Do not invent citations. If uncertain, say so.";

function trim(text: string): string {
  return text.length <= MAX_CTX_CHARS ? text : text.slice(0, Math.floor(text.length * TRIM_RATIO));
}

function assembleBroad(opinions: CachedOpinion[], question: string): string {
  const blocks = opinions
    .map((o) => `## ${o.caseName} — ${o.citationBluebook}\n${trim(o.fullText ?? o.snippet ?? "")}`)
    .join("\n\n---\n\n");
  return `<opinions>\n\n${blocks}\n\n</opinions>\n\n${question}`;
}

function assembleDeep(o: CachedOpinion, question: string): string {
  return `<opinion>\n## ${o.caseName} — ${o.citationBluebook}\n${trim(o.fullText ?? o.snippet ?? "")}\n</opinion>\n\n${question}`;
}

function finalText(final: { content: Array<{ type: string; text?: string }> }): string {
  return final.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

export class LegalRagService {
  private readonly db: typeof defaultDb;
  private readonly anthropic: Anthropic;
  private readonly cache: OpinionCacheService;

  constructor(deps: LegalRagServiceDeps) {
    this.db = deps.db ?? defaultDb;
    this.anthropic = deps.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    this.cache = deps.opinionCache;
  }

  async *askBroad(input: AskBroadInput): AsyncGenerator<StreamChunk> {
    const history = await this.loadHistory(input.sessionId);
    const topN = input.topN ?? 10;
    const rows = await this.db
      .select()
      .from(cachedOpinions)
      .orderBy(desc(cachedOpinions.lastAccessedAt))
      .limit(topN);
    const opinions = await this.hydrate(rows as CachedOpinion[]);
    yield* this.runTurn({
      sessionId: input.sessionId,
      question: input.question,
      history,
      userContent: assembleBroad(opinions, input.question),
      contextCitations: opinions.map((o) => o.citationBluebook),
      opinionContextIds: opinions.map((o) => o.id),
      mode: "broad",
      opinionId: null,
    });
  }

  async *askDeep(input: AskDeepInput): AsyncGenerator<StreamChunk> {
    const history = await this.loadHistory(input.sessionId);
    let opinion: CachedOpinion;
    try {
      const found = await this.cache.getByInternalIds([input.opinionInternalId]);
      if (found.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Opinion not found" });
      }
      opinion = found[0]!;
      if (!opinion.fullText) opinion = await this.cache.getOrFetch(opinion.courtlistenerId);
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : "Failed to load opinion" };
      return;
    }
    yield* this.runTurn({
      sessionId: input.sessionId,
      question: input.question,
      history,
      userContent: assembleDeep(opinion, input.question),
      contextCitations: [opinion.citationBluebook],
      opinionContextIds: [opinion.id],
      mode: "deep",
      opinionId: opinion.id,
    });
  }

  private async loadHistory(sessionId: string): Promise<ChatMsg[]> {
    const rows = await this.db
      .select()
      .from(researchChatMessages)
      .where(eq(researchChatMessages.sessionId, sessionId))
      .orderBy(asc(researchChatMessages.createdAt))
      .limit(HISTORY_LIMIT);
    return rows.map((r) => ({ role: r.role, content: r.content }));
  }

  private async hydrate(opinions: CachedOpinion[]): Promise<CachedOpinion[]> {
    const out: CachedOpinion[] = [];
    for (let i = 0; i < opinions.length; i += 5) {
      const batch = opinions.slice(i, i + 5);
      const hydrated = await Promise.all(
        batch.map((o) => (o.fullText ? Promise.resolve(o) : this.cache.getOrFetch(o.courtlistenerId))),
      );
      out.push(...hydrated);
    }
    return out;
  }

  private async *runTurn(opts: {
    sessionId: string;
    question: string;
    history: ChatMsg[];
    userContent: string;
    contextCitations: string[];
    opinionContextIds: string[];
    mode: ResearchMode;
    opinionId: string | null;
  }): AsyncGenerator<StreamChunk> {
    // Persist the user message first so the session stays consistent on error.
    await this.db.insert(researchChatMessages).values({
      sessionId: opts.sessionId,
      role: "user",
      content: opts.question,
      mode: opts.mode,
      opinionId: opts.opinionId,
      opinionContextIds: opts.opinionContextIds,
      tokensUsed: 0,
      flags: {},
    });

    const messages: ChatMsg[] = [...opts.history, { role: "user", content: opts.userContent }];

    let turn: TurnResult;
    try {
      turn = yield* this.streamOnce(messages);
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }

    let filtered = applyUplFilter(turn.text);
    let { unverified } = validateCitations(filtered.filtered, opts.contextCitations);
    let usage = turn.usage;

    if (unverified.length >= REPROMPT_THRESHOLD) {
      const retryMessages: ChatMsg[] = [
        ...messages,
        { role: "assistant", content: filtered.filtered },
        {
          role: "user",
          content: `Your previous response cited ${unverified.join(", ")} which were not in the provided materials. Regenerate using only the provided opinions.`,
        },
      ];
      let retry: TurnResult;
      try {
        retry = yield* this.streamOnce(retryMessages);
      } catch (err) {
        yield { type: "error", error: err instanceof Error ? err.message : String(err) };
        return;
      }
      filtered = applyUplFilter(retry.text);
      unverified = validateCitations(filtered.filtered, opts.contextCitations).unverified;
      usage = retry.usage;

      if (unverified.length >= GIVE_UP_THRESHOLD) {
        yield { type: "error", error: "Could not ground answer in provided opinions." };
        return;
      }
    }

    const [assistantRow] = await this.db
      .insert(researchChatMessages)
      .values({
        sessionId: opts.sessionId,
        role: "assistant",
        content: filtered.filtered,
        mode: opts.mode,
        opinionId: opts.opinionId,
        opinionContextIds: opts.opinionContextIds,
        tokensUsed: usage.input_tokens + usage.output_tokens,
        flags: { unverifiedCitations: unverified, uplViolations: filtered.violations },
      })
      .returning();

    yield {
      type: "done",
      messageId: assistantRow!.id,
      flags: { unverifiedCitations: unverified, uplViolations: filtered.violations },
    };
  }

  private async *streamOnce(messages: ChatMsg[]): AsyncGenerator<StreamChunk, TurnResult> {
    const stream = this.anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      thinking: { type: "adaptive" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cache_control: { type: "ephemeral" } as any,
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    try {
      for await (const event of stream as AsyncIterable<unknown>) {
        const e = event as { type?: string; delta?: { type?: string; text?: string } };
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && typeof e.delta.text === "string") {
          yield { type: "token", content: e.delta.text };
        }
      }

      const final = await (stream as unknown as {
        finalMessage(): Promise<{
          content: Array<{ type: string; text?: string }>;
          usage: { input_tokens: number; output_tokens: number };
        }>;
      }).finalMessage();
      return { text: finalText(final), usage: final.usage };
    } finally {
      // abort is a no-op if already complete; safe to call unconditionally.
      // Guards against leaked HTTP connections when the generator rejects or
      // the caller stops consuming before the stream naturally ends.
      try {
        (stream as { abort?: () => void }).abort?.();
      } catch {
        /* intentionally ignored — abort on an already-closed stream is harmless */
      }
    }
  }
}
