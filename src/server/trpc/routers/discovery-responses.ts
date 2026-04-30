// src/server/trpc/routers/discovery-responses.ts
//
// Lawyer-side router for the Discovery Response Tracker (3.1.4). Handles
// token issuance, listing, revocation; viewing responses; AI summary;
// manual status flips. The opposing-party portal itself is on a public
// Next API route (no Clerk) — see src/app/api/discovery-responses/[token]/.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";
import * as tokensService from "@/server/services/discovery-responses/tokens-service";
import * as responsesService from "@/server/services/discovery-responses/responses-service";
import { summarizeResponses } from "@/server/services/discovery-responses/ai-summary";
import type { DiscoveryQuestion } from "@/server/db/schema/case-discovery-requests";

async function loadRequestOrThrow(ctx: any, requestId: string) {
  const [row] = await ctx.db
    .select()
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, requestId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Discovery request not found" });
  await assertCaseAccess(ctx, row.caseId);
  return row;
}

export const discoveryResponsesRouter = router({
  tokens: router({
    generate: protectedProcedure
      .input(
        z.object({
          requestId: z.string().uuid(),
          opposingEmail: z.string().email().max(254),
          opposingName: z.string().max(200).optional(),
          expiresInDays: z.number().int().min(1).max(180).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const request = await loadRequestOrThrow(ctx, input.requestId);
        if (request.status !== "served" && request.status !== "responses_received") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Discovery request must be served before generating a response link",
          });
        }
        const result = await tokensService.generateToken(ctx.db, {
          requestId: input.requestId,
          opposingEmail: input.opposingEmail,
          opposingName: input.opposingName,
          expiresInDays: input.expiresInDays,
        });
        return {
          tokenId: result.tokenId,
          tokenUrl: tokensService.buildResponseUrl(result.plainToken),
          expiresAt: result.expiresAt,
        };
      }),

    list: protectedProcedure
      .input(z.object({ requestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await loadRequestOrThrow(ctx, input.requestId);
        return tokensService.listForRequest(ctx.db, input.requestId);
      }),

    revoke: protectedProcedure
      .input(z.object({ tokenId: z.string().uuid(), requestId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await loadRequestOrThrow(ctx, input.requestId);
        await tokensService.revokeToken(ctx.db, input.tokenId);
        return { ok: true as const };
      }),
  }),

  responses: router({
    listForRequest: protectedProcedure
      .input(z.object({ requestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await loadRequestOrThrow(ctx, input.requestId);
        return responsesService.listForRequest(ctx.db, input.requestId);
      }),

    summary: protectedProcedure
      .input(z.object({ requestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await loadRequestOrThrow(ctx, input.requestId);
        return responsesService.getResponseSummary(ctx.db, input.requestId);
      }),

    aiSummarize: protectedProcedure
      .input(z.object({ requestId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const request = await loadRequestOrThrow(ctx, input.requestId);
        const responses = await responsesService.listForRequest(ctx.db, input.requestId);
        if (responses.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No responses to summarize yet",
          });
        }
        const questions = (request.questions as DiscoveryQuestion[]).map((q, i) => ({
          number: q.number ?? i + 1,
          text: q.text,
        }));
        try {
          const summary = await summarizeResponses({
            requestType: request.requestType,
            requestTitle: request.title,
            questions,
            responses,
          });
          return { summary };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "AI summary failed";
          if (msg.includes("ANTHROPIC_API_KEY")) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: msg });
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
        }
      }),

    markReceived: protectedProcedure
      .input(z.object({ requestId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await loadRequestOrThrow(ctx, input.requestId);
        await responsesService.markRequestResponsesReceived(ctx.db, input.requestId);
        return { ok: true as const };
      }),
  }),
});
