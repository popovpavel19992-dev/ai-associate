// src/server/trpc/routers/discovery.ts
//
// Discovery (interrogatories) router for ClearTerms 3.1.1.
// Wave 1B: service + AI + router. Renderer + UI ship in later waves.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { cases } from "@/server/db/schema/cases";
import * as discoveryService from "@/server/services/discovery/service";
import {
  generateInterrogatoriesFromCase,
  generateRfpsFromCase,
} from "@/server/services/discovery/ai-generate";
import type { DiscoveryQuestion } from "@/server/db/schema/case-discovery-requests";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const SERVING_PARTY = z.enum(["plaintiff", "defendant"]);
const REQUEST_TYPE = z.enum(["interrogatories", "rfp"]);

function defaultTitleFor(
  requestType: "interrogatories" | "rfp",
  party: "plaintiff" | "defendant",
  setNumber: number,
  suffix: "" | " (AI)" = "",
): string {
  const partyLabel = party === "plaintiff" ? "Plaintiff" : "Defendant";
  const ordinals = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
  const ordinal = ordinals[setNumber - 1] ?? `${setNumber}th`;
  if (requestType === "rfp") {
    return `${partyLabel}'s ${ordinal} Requests for Production${suffix}`;
  }
  return `${partyLabel}'s ${ordinal} Set of Interrogatories${suffix}`;
}

const QUESTION_INPUT = z.object({
  number: z.number().int().min(1).optional(),
  text: z.string().min(1),
  source: z.enum(["library", "ai", "manual"]).optional(),
  subparts: z.array(z.string()).optional(),
});

function buildCaseFacts(caseRow: {
  description: string | null;
  opposingParty: string | null;
  caseBrief: unknown;
}): string {
  const parts: string[] = [];
  if (caseRow.description) parts.push(`Description: ${caseRow.description}`);
  if (caseRow.opposingParty) parts.push(`Opposing party: ${caseRow.opposingParty}`);
  // caseBrief is jsonb; pick the `facts` field if present.
  if (caseRow.caseBrief && typeof caseRow.caseBrief === "object") {
    const brief = caseRow.caseBrief as Record<string, unknown>;
    if (typeof brief.facts === "string" && brief.facts.trim()) {
      parts.push(`Brief facts: ${brief.facts}`);
    }
  }
  return parts.join("\n\n");
}

function resolveCaseType(caseRow: {
  overrideCaseType: string | null;
  detectedCaseType: string | null;
}): string {
  return caseRow.overrideCaseType ?? caseRow.detectedCaseType ?? "general";
}

export const discoveryRouter = router({
  listLibraryTemplates: protectedProcedure
    .input(
      z
        .object({
          caseType: z.string().optional(),
          requestType: REQUEST_TYPE.optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      return discoveryService.listLibraryTemplates(
        ctx.db,
        orgId,
        input?.caseType,
        input?.requestType,
      );
    }),

  getTemplate: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        return await discoveryService.getTemplate(ctx.db, input.templateId);
      } catch (e) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: e instanceof Error ? e.message : "Template not found",
        });
      }
    }),

  getNextSetNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), requestType: z.string().default("interrogatories") }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const next = await discoveryService.getNextSetNumber(ctx.db, input.caseId, input.requestType);
      return { setNumber: next };
    }),

  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return discoveryService.listForCase(ctx.db, input.caseId);
    }),

  get: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await discoveryService.getDiscoveryRequest(ctx.db, input.requestId).catch(() => null);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Discovery request not found" });
      await assertCaseAccess(ctx, row.caseId);
      return row;
    }),

  createFromLibrary: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        requestType: REQUEST_TYPE.default("interrogatories"),
        servingParty: SERVING_PARTY,
        templateId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        additionalQuestions: z.array(z.string().min(1)).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);

      const tpl = await discoveryService.getTemplate(ctx.db, input.templateId).catch(() => null);
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });

      const setNumber = await discoveryService.getNextSetNumber(ctx.db, input.caseId, input.requestType);
      const questions: DiscoveryQuestion[] = [
        ...tpl.questions.map((text, i) => ({ number: i + 1, text, source: "library" as const })),
        ...(input.additionalQuestions ?? []).map((text, i) => ({
          number: tpl.questions.length + i + 1,
          text,
          source: "manual" as const,
        })),
      ];
      const templateSource =
        input.additionalQuestions && input.additionalQuestions.length > 0 ? "mixed" : "library";

      return discoveryService.createDiscoveryRequest(ctx.db, {
        orgId,
        caseId: input.caseId,
        requestType: input.requestType,
        servingParty: input.servingParty,
        setNumber,
        title: input.title ?? `${tpl.title} (Set ${setNumber})`,
        templateSource,
        questions,
        createdBy: ctx.user.id,
      });
    }),

  createFromAi: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        requestType: REQUEST_TYPE.default("interrogatories"),
        servingParty: SERVING_PARTY,
        desiredCount: z.number().int().min(1).max(50).optional(),
        additionalContext: z.string().max(2000).optional(),
        title: z.string().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);

      const [caseRow] = await ctx.db.select().from(cases).where(eq(cases.id, input.caseId)).limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });

      const baseFacts = buildCaseFacts(caseRow);
      const caseFacts = input.additionalContext
        ? `${baseFacts}\n\nAdditional context from lawyer:\n${input.additionalContext}`
        : baseFacts;

      let questions: DiscoveryQuestion[];
      try {
        if (input.requestType === "rfp") {
          questions = await generateRfpsFromCase({
            caseFacts,
            caseType: resolveCaseType(caseRow),
            servingParty: input.servingParty,
            desiredCount: input.desiredCount,
          });
        } else {
          // FRCP 33: cap user-requested interrogatory count at 25.
          const cappedCount =
            input.desiredCount !== undefined
              ? Math.min(25, input.desiredCount)
              : undefined;
          questions = await generateInterrogatoriesFromCase({
            caseFacts,
            caseType: resolveCaseType(caseRow),
            servingParty: input.servingParty,
            desiredCount: cappedCount,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AI generation failed";
        if (msg.includes("ANTHROPIC_API_KEY")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: msg });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const setNumber = await discoveryService.getNextSetNumber(ctx.db, input.caseId, input.requestType);
      const fallbackTitle =
        input.requestType === "rfp"
          ? defaultTitleFor("rfp", input.servingParty, setNumber, " (AI)")
          : defaultTitleFor("interrogatories", input.servingParty, setNumber, " (AI)");
      return discoveryService.createDiscoveryRequest(ctx.db, {
        orgId,
        caseId: input.caseId,
        requestType: input.requestType,
        servingParty: input.servingParty,
        setNumber,
        title: input.title ?? fallbackTitle,
        templateSource: "ai",
        questions,
        createdBy: ctx.user.id,
      });
    }),

  createBlank: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        requestType: REQUEST_TYPE.default("interrogatories"),
        servingParty: SERVING_PARTY,
        title: z.string().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);
      const setNumber = await discoveryService.getNextSetNumber(ctx.db, input.caseId, input.requestType);
      const fallbackTitle = defaultTitleFor(input.requestType, input.servingParty, setNumber);
      return discoveryService.createDiscoveryRequest(ctx.db, {
        orgId,
        caseId: input.caseId,
        requestType: input.requestType,
        servingParty: input.servingParty,
        setNumber,
        title: input.title ?? fallbackTitle,
        templateSource: "manual",
        questions: [],
        createdBy: ctx.user.id,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        questions: z.array(QUESTION_INPUT).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await discoveryService.getDiscoveryRequest(ctx.db, input.requestId).catch(() => null);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Discovery request not found" });
      await assertCaseAccess(ctx, row.caseId);
      try {
        const questions = input.questions?.map((q) => ({
          number: q.number ?? 0,
          text: q.text,
          source: q.source,
          subparts: q.subparts,
        }));
        await discoveryService.updateDiscoveryRequest(ctx.db, input.requestId, {
          title: input.title,
          questions,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update failed",
        });
      }
      return { ok: true as const };
    }),

  finalize: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await discoveryService.getDiscoveryRequest(ctx.db, input.requestId).catch(() => null);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Discovery request not found" });
      await assertCaseAccess(ctx, row.caseId);
      try {
        await discoveryService.finalizeDiscoveryRequest(ctx.db, input.requestId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Finalize failed",
        });
      }
      return { ok: true as const };
    }),

  markServed: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        servedAt: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await discoveryService.getDiscoveryRequest(ctx.db, input.requestId).catch(() => null);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Discovery request not found" });
      await assertCaseAccess(ctx, row.caseId);
      try {
        await discoveryService.markServed(ctx.db, input.requestId, new Date(input.servedAt));
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-served failed",
        });
      }
      // Wave 3 will wire this into 2.4.5 service-tracking; for now status alone.
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await discoveryService.getDiscoveryRequest(ctx.db, input.requestId).catch(() => null);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Discovery request not found" });
      await assertCaseAccess(ctx, row.caseId);
      try {
        await discoveryService.deleteDiscoveryRequest(ctx.db, input.requestId);
      } catch (e) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),
});
