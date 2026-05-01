// src/server/trpc/routers/settlement.ts
//
// Settlement / Mediation / Demand Letter tRPC router (3.4).
// Three nested sub-routers grouped by entity type.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { isStrategyEnabled } from "@/server/lib/feature-flags";
import { cases } from "@/server/db/schema/cases";
import { documents } from "@/server/db/schema/documents";
import * as offersService from "@/server/services/settlement/offers-service";
import * as mediationService from "@/server/services/settlement/mediation-service";
import * as demandLettersService from "@/server/services/settlement/demand-letters-service";
import {
  aiSuggest,
  aiGenerate,
  aiRegenerateSection,
  aiGetSections,
  InsufficientCreditsError,
  NotBetaOrgError,
} from "@/server/services/demand-letter-ai";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId)
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const nullableTrimmed = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => {
      if (v === undefined || v === null) return v ?? null;
      const t = v.trim();
      return t.length === 0 ? null : t;
    });

const OFFER_TYPE = z.enum([
  "opening_demand",
  "opening_offer",
  "counter_offer",
  "final_offer",
  "walkaway",
]);
const FROM_PARTY = z.enum(["plaintiff", "defendant"]);
const OFFER_RESPONSE = z.enum(["accepted", "rejected", "expired", "withdrawn"]);

const SESSION_TYPE = z.enum(["initial", "continued", "final"]);
const SESSION_STATUS = z.enum([
  "scheduled",
  "completed",
  "cancelled",
  "rescheduled",
]);
const SESSION_OUTCOME = z.enum(["pending", "settled", "impasse", "continued"]);

const LETTER_TYPE = z.enum([
  "initial_demand",
  "pre_litigation",
  "pre_trial",
  "response_to_demand",
]);
const LETTER_METHOD = z.enum(["email", "mail", "certified_mail", "courier"]);

// ─── helpers ──────────────────────────────────────────────────────────────

async function loadOfferOwned(ctx: any, offerId: string) {
  const row = await offersService.getOffer(ctx.db, offerId).catch(() => null);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Offer not found" });
  await assertCaseAccess(ctx, row.caseId);
  return row;
}

async function loadSessionOwned(ctx: any, sessionId: string) {
  const row = await mediationService.getSession(ctx.db, sessionId).catch(() => null);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  await assertCaseAccess(ctx, row.caseId);
  return row;
}

async function loadLetterOwned(ctx: any, letterId: string) {
  const row = await demandLettersService.getLetter(ctx.db, letterId).catch(() => null);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Letter not found" });
  await assertCaseAccess(ctx, row.caseId);
  return row;
}

// ─── offers sub-router ────────────────────────────────────────────────────

const offersRouter = router({
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return offersService.listForCase(ctx.db, input.caseId);
    }),

  get: protectedProcedure
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return loadOfferOwned(ctx, input.offerId);
    }),

  getNextNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const n = await offersService.getNextOfferNumber(ctx.db, input.caseId);
      return { offerNumber: n };
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        amountCents: z.number().int().min(0),
        currency: z.string().length(3).default("USD"),
        offerType: OFFER_TYPE,
        fromParty: FROM_PARTY,
        offeredAt: z.string().datetime().optional(),
        expiresAt: z.string().datetime().nullish(),
        terms: nullableTrimmed(4000),
        conditions: nullableTrimmed(4000),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await offersService.createOffer(ctx.db, {
          orgId,
          caseId: input.caseId,
          amountCents: input.amountCents,
          currency: input.currency,
          offerType: input.offerType,
          fromParty: input.fromParty,
          offeredAt: input.offeredAt ? new Date(input.offeredAt) : undefined,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          terms: input.terms ?? null,
          conditions: input.conditions ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Create failed",
        });
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        offerId: z.string().uuid(),
        amountCents: z.number().int().min(0).optional(),
        currency: z.string().length(3).optional(),
        offerType: OFFER_TYPE.optional(),
        fromParty: FROM_PARTY.optional(),
        offeredAt: z.string().datetime().optional(),
        expiresAt: z.string().datetime().nullish(),
        terms: nullableTrimmed(4000),
        conditions: nullableTrimmed(4000),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadOfferOwned(ctx, input.offerId);
      try {
        await offersService.updateOffer(ctx.db, input.offerId, {
          amountCents: input.amountCents,
          currency: input.currency,
          offerType: input.offerType,
          fromParty: input.fromParty,
          offeredAt: input.offeredAt ? new Date(input.offeredAt) : undefined,
          expiresAt:
            input.expiresAt === undefined
              ? undefined
              : input.expiresAt
                ? new Date(input.expiresAt)
                : null,
          terms: input.terms === undefined ? undefined : input.terms,
          conditions: input.conditions === undefined ? undefined : input.conditions,
          notes: input.notes === undefined ? undefined : input.notes,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update failed",
        });
      }
      return { ok: true as const };
    }),

  recordResponse: protectedProcedure
    .input(
      z.object({
        offerId: z.string().uuid(),
        response: OFFER_RESPONSE,
        responseDate: z.string().datetime().optional(),
        responseNotes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadOfferOwned(ctx, input.offerId);
      try {
        await offersService.recordResponse(ctx.db, input.offerId, {
          response: input.response,
          responseDate: input.responseDate
            ? new Date(input.responseDate)
            : undefined,
          responseNotes: input.responseNotes ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Record response failed",
        });
      }
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ offerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOfferOwned(ctx, input.offerId);
      try {
        await offersService.deleteOffer(ctx.db, input.offerId);
      } catch (e) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),
});

// ─── mediation sub-router ─────────────────────────────────────────────────

const mediationRouter = router({
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return mediationService.listForCase(ctx.db, input.caseId);
    }),

  get: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return loadSessionOwned(ctx, input.sessionId);
    }),

  getNextNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const n = await mediationService.getNextSessionNumber(ctx.db, input.caseId);
      return { sessionNumber: n };
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        mediatorName: z.string().min(1).max(300),
        mediatorFirm: nullableTrimmed(300),
        mediatorEmail: nullableTrimmed(320),
        mediatorPhone: nullableTrimmed(40),
        scheduledDate: z.string().datetime(),
        location: nullableTrimmed(1000),
        sessionType: SESSION_TYPE.optional(),
        durationMinutes: z.number().int().min(0).max(10000).nullish(),
        costCents: z.number().int().min(0).nullish(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await mediationService.createSession(ctx.db, {
          orgId,
          caseId: input.caseId,
          mediatorName: input.mediatorName,
          mediatorFirm: input.mediatorFirm ?? null,
          mediatorEmail: input.mediatorEmail ?? null,
          mediatorPhone: input.mediatorPhone ?? null,
          scheduledDate: new Date(input.scheduledDate),
          location: input.location ?? null,
          sessionType: input.sessionType,
          durationMinutes: input.durationMinutes ?? null,
          costCents: input.costCents ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Create failed",
        });
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        mediatorName: z.string().min(1).max(300).optional(),
        mediatorFirm: nullableTrimmed(300),
        mediatorEmail: nullableTrimmed(320),
        mediatorPhone: nullableTrimmed(40),
        scheduledDate: z.string().datetime().optional(),
        location: nullableTrimmed(1000),
        sessionType: SESSION_TYPE.optional(),
        durationMinutes: z.number().int().min(0).max(10000).nullish(),
        costCents: z.number().int().min(0).nullish(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadSessionOwned(ctx, input.sessionId);
      try {
        await mediationService.updateSession(ctx.db, input.sessionId, {
          mediatorName: input.mediatorName,
          mediatorFirm:
            input.mediatorFirm === undefined ? undefined : input.mediatorFirm,
          mediatorEmail:
            input.mediatorEmail === undefined ? undefined : input.mediatorEmail,
          mediatorPhone:
            input.mediatorPhone === undefined ? undefined : input.mediatorPhone,
          scheduledDate: input.scheduledDate
            ? new Date(input.scheduledDate)
            : undefined,
          location: input.location === undefined ? undefined : input.location,
          sessionType: input.sessionType,
          durationMinutes:
            input.durationMinutes === undefined
              ? undefined
              : input.durationMinutes ?? null,
          costCents:
            input.costCents === undefined ? undefined : input.costCents ?? null,
          notes: input.notes === undefined ? undefined : input.notes,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update failed",
        });
      }
      return { ok: true as const };
    }),

  markStatus: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        status: SESSION_STATUS,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadSessionOwned(ctx, input.sessionId);
      try {
        await mediationService.markStatus(ctx.db, input.sessionId, input.status);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-status failed",
        });
      }
      return { ok: true as const };
    }),

  markOutcome: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        outcome: SESSION_OUTCOME,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadSessionOwned(ctx, input.sessionId);
      try {
        await mediationService.markOutcome(ctx.db, input.sessionId, input.outcome);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-outcome failed",
        });
      }
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadSessionOwned(ctx, input.sessionId);
      try {
        await mediationService.deleteSession(ctx.db, input.sessionId);
      } catch (e) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),
});

// ─── demand letters sub-router ────────────────────────────────────────────

const demandLettersRouter = router({
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return demandLettersService.listForCase(ctx.db, input.caseId);
    }),

  get: protectedProcedure
    .input(z.object({ letterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return loadLetterOwned(ctx, input.letterId);
    }),

  getNextNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const n = await demandLettersService.getNextLetterNumber(
        ctx.db,
        input.caseId,
      );
      return { letterNumber: n };
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        letterType: LETTER_TYPE,
        recipientName: z.string().min(1).max(300),
        recipientAddress: nullableTrimmed(1000),
        recipientEmail: nullableTrimmed(320),
        demandAmountCents: z.number().int().min(0).nullish(),
        currency: z.string().length(3).default("USD"),
        deadlineDate: isoDate.nullish(),
        keyFacts: nullableTrimmed(8000),
        legalBasis: nullableTrimmed(8000),
        demandTerms: nullableTrimmed(8000),
        letterBody: nullableTrimmed(20000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await demandLettersService.createLetter(ctx.db, {
          orgId,
          caseId: input.caseId,
          letterType: input.letterType,
          recipientName: input.recipientName,
          recipientAddress: input.recipientAddress ?? null,
          recipientEmail: input.recipientEmail ?? null,
          demandAmountCents: input.demandAmountCents ?? null,
          currency: input.currency,
          deadlineDate: input.deadlineDate ?? null,
          keyFacts: input.keyFacts ?? null,
          legalBasis: input.legalBasis ?? null,
          demandTerms: input.demandTerms ?? null,
          letterBody: input.letterBody ?? null,
          createdBy: ctx.user.id,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Create failed",
        });
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        letterId: z.string().uuid(),
        letterType: LETTER_TYPE.optional(),
        recipientName: z.string().min(1).max(300).optional(),
        recipientAddress: nullableTrimmed(1000),
        recipientEmail: nullableTrimmed(320),
        demandAmountCents: z.number().int().min(0).nullish(),
        currency: z.string().length(3).optional(),
        deadlineDate: isoDate.nullish(),
        keyFacts: nullableTrimmed(8000),
        legalBasis: nullableTrimmed(8000),
        demandTerms: nullableTrimmed(8000),
        letterBody: nullableTrimmed(20000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadLetterOwned(ctx, input.letterId);
      try {
        await demandLettersService.updateLetter(ctx.db, input.letterId, {
          letterType: input.letterType,
          recipientName: input.recipientName,
          recipientAddress:
            input.recipientAddress === undefined
              ? undefined
              : input.recipientAddress,
          recipientEmail:
            input.recipientEmail === undefined ? undefined : input.recipientEmail,
          demandAmountCents:
            input.demandAmountCents === undefined
              ? undefined
              : input.demandAmountCents ?? null,
          currency: input.currency,
          deadlineDate:
            input.deadlineDate === undefined
              ? undefined
              : input.deadlineDate ?? null,
          keyFacts: input.keyFacts === undefined ? undefined : input.keyFacts,
          legalBasis:
            input.legalBasis === undefined ? undefined : input.legalBasis,
          demandTerms:
            input.demandTerms === undefined ? undefined : input.demandTerms,
          letterBody:
            input.letterBody === undefined ? undefined : input.letterBody,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update failed",
        });
      }
      return { ok: true as const };
    }),

  markSent: protectedProcedure
    .input(
      z.object({
        letterId: z.string().uuid(),
        sentAt: z.string().datetime(),
        sentMethod: LETTER_METHOD,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadLetterOwned(ctx, input.letterId);
      try {
        await demandLettersService.markSent(ctx.db, input.letterId, {
          sentAt: new Date(input.sentAt),
          sentMethod: input.sentMethod,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-sent failed",
        });
      }
      return { ok: true as const };
    }),

  recordResponse: protectedProcedure
    .input(
      z.object({
        letterId: z.string().uuid(),
        responseReceivedAt: z.string().datetime(),
        responseSummary: nullableTrimmed(8000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadLetterOwned(ctx, input.letterId);
      try {
        await demandLettersService.recordResponse(ctx.db, input.letterId, {
          responseReceivedAt: new Date(input.responseReceivedAt),
          responseSummary: input.responseSummary ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Record response failed",
        });
      }
      return { ok: true as const };
    }),

  markNoResponse: protectedProcedure
    .input(z.object({ letterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadLetterOwned(ctx, input.letterId);
      try {
        await demandLettersService.markNoResponse(ctx.db, input.letterId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark no-response failed",
        });
      }
      return { ok: true as const };
    }),

  markRescinded: protectedProcedure
    .input(z.object({ letterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadLetterOwned(ctx, input.letterId);
      try {
        await demandLettersService.markRescinded(ctx.db, input.letterId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-rescinded failed",
        });
      }
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ letterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadLetterOwned(ctx, input.letterId);
      try {
        await demandLettersService.deleteLetter(ctx.db, input.letterId);
      } catch (e) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),

  // The PDF download endpoint is exposed via a Next.js API route at
  // /api/demand-letters/[letterId]/pdf — this stub returns the URL.
  downloadPdf: protectedProcedure
    .input(z.object({ letterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await loadLetterOwned(ctx, input.letterId);
      return { url: `/api/demand-letters/${input.letterId}/pdf` };
    }),

  aiSuggest: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Org required" });
      if (!isStrategyEnabled(ctx.user.orgId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "AI demand letters not enabled for this organization." });
      }
      await assertCaseAccess(ctx, input.caseId);

      const [c] = await ctx.db.select().from(cases).where(eq(cases.id, input.caseId)).limit(1);
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });

      const docs = await ctx.db
        .select({ filename: documents.filename })
        .from(documents)
        .where(eq(documents.caseId, input.caseId))
        .limit(10);

      const cAny = c as { name?: string | null; description?: string | null };
      return aiSuggest({
        caseId: input.caseId,
        caseTitle: cAny.name ?? "(case)",
        caseSummary: cAny.description ?? "",
        documentTitles: docs.map((d) => d.filename ?? "Untitled"),
        userId: ctx.user.id,
        orgId: ctx.user.orgId,
      });
    }),

  aiGenerate: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        claimType: z.enum(["contract", "personal_injury", "employment", "debt"]),
        claimTypeConfidence: z.number().min(0).max(1).optional(),
        demandAmountCents: z.number().int().positive().lt(1_000_000_000_000),
        deadlineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const d = new Date(s + "T00:00:00Z");
          const min = new Date(today); min.setDate(min.getDate() + 7);
          const max = new Date(today); max.setDate(max.getDate() + 90);
          return d >= min && d <= max;
        }, "Deadline must be 7-90 days from today"),
        recipientName: z.string().min(1).max(200),
        recipientAddress: z.string().min(1).max(500),
        recipientEmail: z.string().email().optional().nullable(),
        summary: z.string().min(50).max(5000),
        letterType: z.enum(["initial_demand", "pre_litigation", "pre_trial", "response_to_demand"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Org required" });
      if (!isStrategyEnabled(ctx.user.orgId)) throw new TRPCError({ code: "FORBIDDEN", message: "AI demand letters not enabled" });
      await assertCaseAccess(ctx, input.caseId);

      try {
        return await aiGenerate({
          ...input,
          userId: ctx.user.id,
          orgId: ctx.user.orgId,
        });
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "Insufficient credits." });
        }
        if (e instanceof NotBetaOrgError) {
          throw new TRPCError({ code: "FORBIDDEN", message: "AI demand letters not enabled" });
        }
        throw e;
      }
    }),

  aiRegenerateSection: protectedProcedure
    .input(
      z.object({
        letterId: z.string().uuid(),
        sectionKey: z.enum(["header", "facts", "legal_basis", "demand", "consequences"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Org required" });
      if (!isStrategyEnabled(ctx.user.orgId)) throw new TRPCError({ code: "FORBIDDEN", message: "AI demand letters not enabled" });

      try {
        return await aiRegenerateSection({ ...input, userId: ctx.user.id, orgId: ctx.user.orgId });
      } catch (e) {
        if (e instanceof Error && e.message === "NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        throw e;
      }
    }),

  aiGetSections: protectedProcedure
    .input(z.object({ letterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Org required" });
      if (!isStrategyEnabled(ctx.user.orgId)) throw new TRPCError({ code: "FORBIDDEN", message: "AI demand letters not enabled" });
      try {
        return await aiGetSections(input.letterId, ctx.user.orgId);
      } catch (e) {
        if (e instanceof Error && e.message === "NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        throw e;
      }
    }),
});

// ─── root settlement router ────────────────────────────────────────────────

export const settlementRouter = router({
  offers: offersRouter,
  mediation: mediationRouter,
  demandLetters: demandLettersRouter,
});
