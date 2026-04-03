import { z } from "zod/v4";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { chatMessages } from "../../db/schema/chat-messages";
import { cases } from "../../db/schema/cases";
import { documents } from "../../db/schema/documents";
import { documentAnalyses } from "../../db/schema/document-analyses";
import {
  CHAT_RATE_LIMIT_PER_HOUR,
  PLAN_LIMITS,
  BANNED_WORDS,
  APPROVED_PHRASES,
} from "@/lib/constants";
import {
  getCompliancePromptInstructions,
  resolveJurisdiction,
  getReportDisclaimer,
} from "../../services/compliance";
import type { Plan } from "@/lib/types";
import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _client;
}

function buildChatSystemPrompt(
  caseType: string,
  jurisdiction: string | null,
  analysisSummary: string,
): string {
  const complianceRules = getCompliancePromptInstructions(jurisdiction);
  const bannedList = BANNED_WORDS.map((w) => `"${w}"`).join(", ");
  const approvedList = APPROVED_PHRASES.map((p) => `"${p}"`).join(", ");

  return `You are a legal document analysis assistant helping attorneys review case materials. You have access to the analysis results below and answer follow-up questions about them.

${complianceRules}

Case type: ${caseType}
${jurisdiction ? `Jurisdiction: ${jurisdiction}` : ""}

IMPORTANT RULES:
- You are NOT a lawyer. Do NOT provide legal advice.
- Present analysis as observations, not directives.
- NEVER use these words/phrases: ${bannedList}
- PREFER these phrases: ${approvedList}
- If asked for legal advice, respond: "I can only provide document analysis. Please consult with a licensed attorney for legal advice."

ANALYSIS CONTEXT:
${analysisSummary}

${getReportDisclaimer()}`;
}

function buildAnalysisSummary(
  caseBrief: unknown,
  docAnalyses: { sections: unknown; filename: string }[],
  scope: "case" | "document",
  docIndex?: number,
): string {
  if (scope === "document" && docIndex !== undefined && docAnalyses[docIndex]) {
    const doc = docAnalyses[docIndex];
    return `Document: ${doc.filename}\nAnalysis:\n${JSON.stringify(doc.sections, null, 2)}`;
  }

  const parts: string[] = [];
  if (caseBrief) {
    parts.push(`Case Brief:\n${JSON.stringify(caseBrief, null, 2)}`);
  }
  for (const doc of docAnalyses.slice(0, 5)) {
    parts.push(
      `Document: ${doc.filename}\n${JSON.stringify(doc.sections, null, 2)}`,
    );
  }

  // Truncate to stay under ~30K tokens (~120K chars)
  const joined = parts.join("\n\n---\n\n");
  return joined.slice(0, 120_000);
}

const COMPLIANCE_REMINDER =
  "⚖️ Reminder: This AI assistant provides document analysis only, not legal advice. All outputs must be independently verified by a licensed attorney before use in any legal matter.";

export const chatRouter = router({
  send: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        documentId: z.string().uuid().optional(),
        content: z.string().min(1).max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify case ownership
      const [caseRecord] = await ctx.db
        .select()
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      // Rate limit: 30 messages/hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [{ count: hourlyCount }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.userId, ctx.user.id),
            eq(chatMessages.role, "user"),
            gte(chatMessages.createdAt, oneHourAgo),
          ),
        );

      if (hourlyCount >= CHAT_RATE_LIMIT_PER_HOUR) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Rate limit exceeded. Maximum 30 messages per hour.",
        });
      }

      // Plan message cap per case
      const plan = (ctx.user.plan ?? "trial") as Plan;
      const limit = PLAN_LIMITS[plan].chatMessagesPerCase;

      if (limit !== Infinity) {
        const [{ count: caseMessageCount }] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(chatMessages)
          .where(
            and(
              eq(chatMessages.caseId, input.caseId),
              eq(chatMessages.userId, ctx.user.id),
              eq(chatMessages.role, "user"),
            ),
          );

        if (caseMessageCount >= limit) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Chat message limit reached for your plan (${limit} messages per case). Upgrade to continue.`,
          });
        }
      }

      // Gather context for AI
      const docs = await ctx.db
        .select({
          id: documents.id,
          filename: documents.filename,
        })
        .from(documents)
        .where(eq(documents.caseId, input.caseId))
        .orderBy(documents.createdAt);

      const analyses = await ctx.db
        .select({
          documentId: documentAnalyses.documentId,
          sections: documentAnalyses.sections,
        })
        .from(documentAnalyses)
        .where(eq(documentAnalyses.caseId, input.caseId));

      const docAnalyses = docs.map((doc) => {
        const analysis = analyses.find((a) => a.documentId === doc.id);
        return {
          filename: doc.filename,
          sections: analysis?.sections ?? {},
        };
      });

      const scope = input.documentId ? "document" : "case";
      const docIndex = input.documentId
        ? docs.findIndex((d) => d.id === input.documentId)
        : undefined;

      const analysisSummary = buildAnalysisSummary(
        caseRecord.caseBrief,
        docAnalyses,
        scope,
        docIndex,
      );

      const caseType =
        caseRecord.overrideCaseType ??
        caseRecord.detectedCaseType ??
        "general";
      const jurisdiction = resolveJurisdiction(caseRecord, ctx.user);

      const systemPrompt = buildChatSystemPrompt(
        caseType,
        jurisdiction,
        analysisSummary,
      );

      // Fetch recent messages for context (last 20)
      const recentMessages = await ctx.db
        .select({
          role: chatMessages.role,
          content: chatMessages.content,
        })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.caseId, input.caseId),
            input.documentId
              ? eq(chatMessages.documentId, input.documentId)
              : sql`${chatMessages.documentId} IS NULL`,
          ),
        )
        .orderBy(desc(chatMessages.createdAt))
        .limit(20);

      const conversationHistory = recentMessages
        .reverse()
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      // Add current user message
      conversationHistory.push({ role: "user", content: input.content });

      // Call Claude first — only persist messages on success
      const response = await getClient().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: conversationHistory,
      });

      const assistantContent =
        response.content[0].type === "text"
          ? response.content[0].text
          : "I was unable to generate a response. Please try again.";

      const tokensUsed =
        (response.usage?.input_tokens ?? 0) +
        (response.usage?.output_tokens ?? 0);

      // Save user message after successful Claude response
      const [userMsg] = await ctx.db
        .insert(chatMessages)
        .values({
          userId: ctx.user.id,
          caseId: input.caseId,
          documentId: input.documentId ?? null,
          role: "user",
          content: input.content,
        })
        .returning();

      // Save assistant message
      const [assistantMsg] = await ctx.db
        .insert(chatMessages)
        .values({
          userId: ctx.user.id,
          caseId: input.caseId,
          documentId: input.documentId ?? null,
          role: "assistant",
          content: assistantContent,
          tokensUsed,
        })
        .returning();

      // Check if we need to inject compliance reminder (every 5th user message)
      const [{ count: totalUserMessages }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.caseId, input.caseId),
            eq(chatMessages.userId, ctx.user.id),
            eq(chatMessages.role, "user"),
          ),
        );

      const includeDisclaimer = totalUserMessages % 5 === 0;

      return {
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        disclaimer: includeDisclaimer ? COMPLIANCE_REMINDER : null,
      };
    }),

  list: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        documentId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify case ownership
      const [caseRecord] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      const conditions = [eq(chatMessages.caseId, input.caseId)];

      if (input.documentId) {
        conditions.push(eq(chatMessages.documentId, input.documentId));
      } else {
        conditions.push(sql`${chatMessages.documentId} IS NULL`);
      }

      if (input.cursor) {
        const [cursorMsg] = await ctx.db
          .select({ createdAt: chatMessages.createdAt })
          .from(chatMessages)
          .where(and(eq(chatMessages.id, input.cursor), eq(chatMessages.caseId, input.caseId)))
          .limit(1);

        if (cursorMsg) {
          conditions.push(
            sql`${chatMessages.createdAt} < ${cursorMsg.createdAt}`,
          );
        }
      }

      const messages = await ctx.db
        .select()
        .from(chatMessages)
        .where(and(...conditions))
        .orderBy(desc(chatMessages.createdAt))
        .limit(input.limit + 1);

      const hasMore = messages.length > input.limit;
      const items = messages.slice(0, input.limit).reverse();

      return {
        messages: items,
        nextCursor: hasMore ? messages[input.limit]?.id : undefined,
      };
    }),
});
