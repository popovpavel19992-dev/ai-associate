import { z } from "zod/v4";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { chatMessages } from "../../db/schema/chat-messages";
import { cases } from "../../db/schema/cases";
import { documents } from "../../db/schema/documents";
import { documentAnalyses } from "../../db/schema/document-analyses";
import { contracts, contractClauses } from "../../db/schema/contracts";
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
        caseId: z.string().uuid().optional(),
        contractId: z.string().uuid().optional(),
        documentId: z.string().uuid().optional(),
        clauseRef: z.string().optional(),
        content: z.string().min(1).max(10_000),
      }).refine(
        (data) => {
          const has = [data.caseId, data.contractId].filter(Boolean).length;
          return has === 1;
        },
        { message: "Exactly one of caseId or contractId must be provided" },
      ),
    )
    .mutation(async ({ ctx, input }) => {
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

      let systemPrompt: string;
      let scopeCaseId: string | null = null;
      let scopeContractId: string | null = null;

      if (input.caseId) {
        // --- Case-scoped chat (existing logic) ---
        scopeCaseId = input.caseId;

        const [caseRecord] = await ctx.db
          .select()
          .from(cases)
          .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
          .limit(1);

        if (!caseRecord) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
        }

        // Plan message cap per case
        const plan = (ctx.user.plan ?? "trial") as Plan;
        const msgLimit = PLAN_LIMITS[plan].chatMessagesPerCase;

        if (msgLimit !== Infinity) {
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

          if (caseMessageCount >= msgLimit) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `Chat message limit reached for your plan (${msgLimit} messages per case). Upgrade to continue.`,
            });
          }
        }

        // Gather context for AI
        const docs = await ctx.db
          .select({ id: documents.id, filename: documents.filename })
          .from(documents)
          .where(eq(documents.caseId, input.caseId))
          .orderBy(documents.createdAt);

        const analyses = await ctx.db
          .select({ documentId: documentAnalyses.documentId, sections: documentAnalyses.sections })
          .from(documentAnalyses)
          .where(eq(documentAnalyses.caseId, input.caseId));

        const docAnalyses = docs.map((doc) => {
          const analysis = analyses.find((a) => a.documentId === doc.id);
          return { filename: doc.filename, sections: analysis?.sections ?? {} };
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
          caseRecord.overrideCaseType ?? caseRecord.detectedCaseType ?? "general";
        const jurisdiction = resolveJurisdiction(caseRecord, ctx.user);

        systemPrompt = buildChatSystemPrompt(caseType, jurisdiction, analysisSummary);
      } else {
        // --- Contract-scoped chat ---
        scopeContractId = input.contractId!;

        const [contract] = await ctx.db
          .select()
          .from(contracts)
          .where(and(eq(contracts.id, scopeContractId), eq(contracts.userId, ctx.user.id)))
          .limit(1);

        if (!contract) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
        }

        // Plan message cap per contract (reuse per-case limit)
        const plan = (ctx.user.plan ?? "trial") as Plan;
        const msgLimit = PLAN_LIMITS[plan].chatMessagesPerCase;

        if (msgLimit !== Infinity) {
          const [{ count: contractMessageCount }] = await ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(chatMessages)
            .where(
              and(
                eq(chatMessages.contractId, scopeContractId),
                eq(chatMessages.userId, ctx.user.id),
                eq(chatMessages.role, "user"),
              ),
            );

          if (contractMessageCount >= msgLimit) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `Chat message limit reached for your plan (${msgLimit} messages per contract). Upgrade to continue.`,
            });
          }
        }

        // Gather contract clauses for AI context
        const clauses = await ctx.db
          .select()
          .from(contractClauses)
          .where(eq(contractClauses.contractId, scopeContractId))
          .orderBy(contractClauses.sortOrder);

        const contractType =
          contract.overrideContractType ?? contract.detectedContractType ?? "generic";

        let contractContext = `Contract: ${contract.name}\nType: ${contractType}\n`;

        if (contract.analysisSections) {
          contractContext += `\nAnalysis:\n${JSON.stringify(contract.analysisSections, null, 2).slice(0, 60_000)}`;
        }

        if (clauses.length > 0) {
          const clausesSummary = clauses
            .map((c) => `[${c.clauseNumber ?? "?"}] ${c.title ?? "Untitled"} (${c.riskLevel ?? "ok"}): ${c.summary ?? ""}`)
            .join("\n");
          contractContext += `\n\nClauses:\n${clausesSummary.slice(0, 40_000)}`;
        }

        if (input.clauseRef) {
          const targetClause = clauses.find((c) => c.clauseNumber === input.clauseRef);
          if (targetClause) {
            contractContext += `\n\nFOCUSED CLAUSE [${targetClause.clauseNumber}]:\nTitle: ${targetClause.title}\nOriginal: ${targetClause.originalText}\nAnnotation: ${targetClause.annotation}\nSuggested Edit: ${targetClause.suggestedEdit ?? "none"}`;
          }
        }

        systemPrompt = buildChatSystemPrompt(contractType, null, contractContext);
      }

      // Fetch recent messages for context (last 20)
      const messageConditions = input.caseId
        ? [
            eq(chatMessages.caseId, input.caseId),
            input.documentId
              ? eq(chatMessages.documentId, input.documentId)
              : sql`${chatMessages.documentId} IS NULL`,
          ]
        : [eq(chatMessages.contractId, scopeContractId!)];

      const recentMessages = await ctx.db
        .select({ role: chatMessages.role, content: chatMessages.content })
        .from(chatMessages)
        .where(and(...messageConditions))
        .orderBy(desc(chatMessages.createdAt))
        .limit(20);

      const conversationHistory = recentMessages
        .reverse()
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

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
          caseId: scopeCaseId,
          contractId: scopeContractId,
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
          caseId: scopeCaseId,
          contractId: scopeContractId,
          documentId: input.documentId ?? null,
          role: "assistant",
          content: assistantContent,
          tokensUsed,
        })
        .returning();

      // Check if we need to inject compliance reminder (every 5th user message)
      const countConditions = input.caseId
        ? [eq(chatMessages.caseId, input.caseId), eq(chatMessages.userId, ctx.user.id), eq(chatMessages.role, "user")]
        : [eq(chatMessages.contractId, scopeContractId!), eq(chatMessages.userId, ctx.user.id), eq(chatMessages.role, "user")];

      const [{ count: totalUserMessages }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(chatMessages)
        .where(and(...countConditions));

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
