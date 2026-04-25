// src/server/trpc/routers/voir-dire.ts
//
// Trial Prep / Voir Dire Questions (3.2.4) tRPC router.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseVoirDireQuestions } from "@/server/db/schema/case-voir-dire-questions";
import * as voirDireService from "@/server/services/voir-dire/service";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const SERVING_PARTY = z.enum(["plaintiff", "defendant"]);
const CATEGORY = z.enum([
  "background",
  "employment",
  "prior_jury_experience",
  "attitudes_bias",
  "case_specific",
  "follow_up",
]);
const PANEL_TARGET = z.enum(["all", "individual"]);

const ORDINALS = [
  "Proposed",
  "First Amended Proposed",
  "Second Amended Proposed",
  "Third Amended Proposed",
  "Fourth Amended Proposed",
  "Fifth Amended Proposed",
];

function defaultSetTitle(party: "plaintiff" | "defendant", n: number): string {
  const partyLabel = party === "plaintiff" ? "Plaintiff" : "Defendant";
  const adj = ORDINALS[n - 1] ?? `${n}th Amended Proposed`;
  return `${partyLabel}'s ${adj} Voir Dire Questions`;
}

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

export const voirDireRouter = router({
  // ── Library ────────────────────────────────────────────────────────────
  listLibraryTemplates: protectedProcedure
    .input(
      z.object({
        category: CATEGORY.optional(),
        caseType: z.string().min(1).max(80).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = ctx.user.orgId ?? null;
      return voirDireService.listLibraryTemplates(
        ctx.db,
        orgId,
        input.category,
        input.caseType,
      );
    }),

  // ── Sets ───────────────────────────────────────────────────────────────
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return voirDireService.listForCase(ctx.db, input.caseId);
    }),

  getSet: protectedProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await voirDireService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire set not found" });
      }
      await assertCaseAccess(ctx, result.set.caseId);
      return result;
    }),

  getNextSetNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), servingParty: SERVING_PARTY }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const next = await voirDireService.getNextSetNumber(
        ctx.db,
        input.caseId,
        input.servingParty,
      );
      return { setNumber: next };
    }),

  createSet: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        servingParty: SERVING_PARTY,
        title: z.string().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);
      const setNumber = await voirDireService.getNextSetNumber(
        ctx.db,
        input.caseId,
        input.servingParty,
      );
      return voirDireService.createSet(ctx.db, {
        orgId,
        caseId: input.caseId,
        servingParty: input.servingParty,
        setNumber,
        title: input.title ?? defaultSetTitle(input.servingParty, setNumber),
        createdBy: ctx.user.id,
      });
    }),

  updateSetMeta: protectedProcedure
    .input(z.object({ setId: z.string().uuid(), title: z.string().min(1).max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await voirDireService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await voirDireService.updateSetMeta(ctx.db, input.setId, {
          title: input.title,
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
    .input(z.object({ setId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await voirDireService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await voirDireService.finalizeSet(ctx.db, input.setId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Finalize failed",
        });
      }
      return { ok: true as const };
    }),

  markSubmitted: protectedProcedure
    .input(z.object({ setId: z.string().uuid(), submittedAt: z.string().datetime() }))
    .mutation(async ({ ctx, input }) => {
      const result = await voirDireService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await voirDireService.markSubmitted(
          ctx.db,
          input.setId,
          new Date(input.submittedAt),
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-submitted failed",
        });
      }
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await voirDireService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await voirDireService.deleteSet(ctx.db, input.setId);
      } catch (e) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),

  // ── Questions ──────────────────────────────────────────────────────────
  addQuestion: protectedProcedure
    .input(
      z.object({
        setId: z.string().uuid(),
        category: CATEGORY,
        text: z.string().min(1).max(4000),
        followUpPrompt: nullableTrimmed(2000),
        isForCause: z.boolean().optional(),
        jurorPanelTarget: PANEL_TARGET.optional(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await voirDireService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        return await voirDireService.addQuestion(ctx.db, input.setId, {
          category: input.category,
          text: input.text,
          followUpPrompt: input.followUpPrompt ?? null,
          isForCause: input.isForCause,
          jurorPanelTarget: input.jurorPanelTarget,
          notes: input.notes ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Add question failed",
        });
      }
    }),

  addFromTemplate: protectedProcedure
    .input(z.object({ setId: z.string().uuid(), templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await voirDireService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        return await voirDireService.addQuestionFromTemplate(
          ctx.db,
          input.setId,
          input.templateId,
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Add from template failed",
        });
      }
    }),

  updateQuestion: protectedProcedure
    .input(
      z.object({
        questionId: z.string().uuid(),
        category: CATEGORY.optional(),
        text: z.string().min(1).max(4000).optional(),
        followUpPrompt: nullableTrimmed(2000),
        isForCause: z.boolean().optional(),
        jurorPanelTarget: PANEL_TARGET.optional(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(caseVoirDireQuestions)
        .where(eq(caseVoirDireQuestions.id, input.questionId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire question not found" });
      const result = await voirDireService.getSet(ctx.db, row.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        const { questionId: _id, ...patch } = input;
        await voirDireService.updateQuestion(ctx.db, input.questionId, patch);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update question failed",
        });
      }
      return { ok: true as const };
    }),

  deleteQuestion: protectedProcedure
    .input(z.object({ questionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(caseVoirDireQuestions)
        .where(eq(caseVoirDireQuestions.id, input.questionId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire question not found" });
      const result = await voirDireService.getSet(ctx.db, row.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await voirDireService.deleteQuestion(ctx.db, input.questionId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Delete question failed",
        });
      }
      return { ok: true as const };
    }),

  reorderQuestions: protectedProcedure
    .input(
      z.object({
        setId: z.string().uuid(),
        orderedIds: z.array(z.string().uuid()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await voirDireService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Voir dire set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await voirDireService.reorderQuestions(
          ctx.db,
          input.setId,
          input.orderedIds,
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Reorder failed",
        });
      }
      return { ok: true as const };
    }),
});
