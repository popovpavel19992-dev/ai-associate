// src/server/trpc/routers/deposition-prep.ts
//
// Discovery / Deposition Outline Prep (3.1.6) tRPC router.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseDepositionQuestions } from "@/server/db/schema/case-deposition-questions";
import { caseDepositionTopics } from "@/server/db/schema/case-deposition-topics";
import { cases } from "@/server/db/schema/cases";
import * as depositionService from "@/server/services/deposition-prep/service";
import { generateDepositionQuestions } from "@/server/services/deposition-prep/ai-generate";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId)
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const SERVING_PARTY = z.enum(["plaintiff", "defendant"]);
const DEPONENT_ROLE = z.enum([
  "party_witness",
  "expert",
  "opposing_party",
  "third_party",
  "custodian",
  "other",
]);
const CATEGORY = z.enum([
  "background",
  "foundation",
  "key_facts",
  "documents",
  "admissions",
  "damages",
  "wrap_up",
  "custom",
]);
const PRIORITY = z.enum(["must_ask", "important", "optional"]);

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

export const depositionPrepRouter = router({
  // ── Library ────────────────────────────────────────────────────────────
  listLibraryTemplates: protectedProcedure
    .input(
      z.object({
        deponentRole: DEPONENT_ROLE.optional(),
        category: CATEGORY.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = ctx.user.orgId ?? null;
      return depositionService.listLibraryTemplates(
        ctx.db,
        orgId,
        input.deponentRole,
        input.category,
      );
    }),

  // ── Outlines ───────────────────────────────────────────────────────────
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return depositionService.listForCase(ctx.db, input.caseId);
    }),

  getOutline: protectedProcedure
    .input(z.object({ outlineId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await depositionService
        .getOutline(ctx.db, input.outlineId)
        .catch(() => null);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      }
      await assertCaseAccess(ctx, result.outline.caseId);
      return result;
    }),

  getNextOutlineNumber: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        deponentName: z.string().min(1).max(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const next = await depositionService.getNextOutlineNumber(
        ctx.db,
        input.caseId,
        input.deponentName,
      );
      return { outlineNumber: next };
    }),

  createOutline: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        servingParty: SERVING_PARTY,
        deponentName: z.string().min(1).max(200),
        deponentRole: DEPONENT_ROLE,
        scheduledDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .nullable(),
        location: nullableTrimmed(500),
        title: z.string().min(1).max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);
      const outlineNumber = await depositionService.getNextOutlineNumber(
        ctx.db,
        input.caseId,
        input.deponentName,
      );
      const defaultTitle =
        outlineNumber === 1
          ? `Deposition Outline for ${input.deponentName} — Initial`
          : `Deposition Outline for ${input.deponentName} — Rev ${outlineNumber}`;
      return depositionService.createOutline(ctx.db, {
        orgId,
        caseId: input.caseId,
        servingParty: input.servingParty,
        deponentName: input.deponentName,
        deponentRole: input.deponentRole,
        outlineNumber,
        title: input.title?.trim() || defaultTitle,
        scheduledDate: input.scheduledDate ?? null,
        location: input.location ?? null,
        createdBy: ctx.user.id,
      });
    }),

  updateOutlineMeta: protectedProcedure
    .input(
      z.object({
        outlineId: z.string().uuid(),
        title: z.string().min(1).max(300).optional(),
        scheduledDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        location: nullableTrimmed(500),
        deponentName: z.string().min(1).max(200).optional(),
        deponentRole: DEPONENT_ROLE.optional(),
        servingParty: SERVING_PARTY.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await depositionService
        .getOutline(ctx.db, input.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        const { outlineId: _id, ...patch } = input;
        await depositionService.updateOutlineMeta(ctx.db, input.outlineId, patch);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update failed",
        });
      }
      return { ok: true as const };
    }),

  finalize: protectedProcedure
    .input(z.object({ outlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await depositionService
        .getOutline(ctx.db, input.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        await depositionService.finalizeOutline(ctx.db, input.outlineId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Finalize failed",
        });
      }
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ outlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await depositionService
        .getOutline(ctx.db, input.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        await depositionService.deleteOutline(ctx.db, input.outlineId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),

  // ── Topics ─────────────────────────────────────────────────────────────
  addTopic: protectedProcedure
    .input(
      z.object({
        outlineId: z.string().uuid(),
        category: CATEGORY,
        title: z.string().min(1).max(300),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await depositionService
        .getOutline(ctx.db, input.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        return await depositionService.addTopic(ctx.db, input.outlineId, {
          category: input.category,
          title: input.title,
          notes: input.notes ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Add topic failed",
        });
      }
    }),

  addTopicFromTemplate: protectedProcedure
    .input(
      z.object({
        outlineId: z.string().uuid(),
        templateId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await depositionService
        .getOutline(ctx.db, input.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        return await depositionService.addTopicFromTemplate(
          ctx.db,
          input.outlineId,
          input.templateId,
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Add from template failed",
        });
      }
    }),

  updateTopic: protectedProcedure
    .input(
      z.object({
        topicId: z.string().uuid(),
        category: CATEGORY.optional(),
        title: z.string().min(1).max(300).optional(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(caseDepositionTopics)
        .where(eq(caseDepositionTopics.id, input.topicId))
        .limit(1);
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      const result = await depositionService
        .getOutline(ctx.db, row.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        const { topicId: _id, ...patch } = input;
        await depositionService.updateTopic(ctx.db, input.topicId, patch);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update topic failed",
        });
      }
      return { ok: true as const };
    }),

  deleteTopic: protectedProcedure
    .input(z.object({ topicId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(caseDepositionTopics)
        .where(eq(caseDepositionTopics.id, input.topicId))
        .limit(1);
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      const result = await depositionService
        .getOutline(ctx.db, row.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        await depositionService.deleteTopic(ctx.db, input.topicId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Delete topic failed",
        });
      }
      return { ok: true as const };
    }),

  reorderTopics: protectedProcedure
    .input(
      z.object({
        outlineId: z.string().uuid(),
        orderedIds: z.array(z.string().uuid()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await depositionService
        .getOutline(ctx.db, input.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        await depositionService.reorderTopics(
          ctx.db,
          input.outlineId,
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

  // ── Questions ──────────────────────────────────────────────────────────
  addQuestion: protectedProcedure
    .input(
      z.object({
        topicId: z.string().uuid(),
        text: z.string().min(1).max(4000),
        expectedAnswer: nullableTrimmed(4000),
        notes: nullableTrimmed(4000),
        exhibitRefs: z.array(z.string().min(1).max(80)).max(50).optional(),
        priority: PRIORITY.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [topic] = await ctx.db
        .select()
        .from(caseDepositionTopics)
        .where(eq(caseDepositionTopics.id, input.topicId))
        .limit(1);
      if (!topic)
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      const result = await depositionService
        .getOutline(ctx.db, topic.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        return await depositionService.addQuestion(ctx.db, input.topicId, {
          text: input.text,
          expectedAnswer: input.expectedAnswer ?? null,
          notes: input.notes ?? null,
          exhibitRefs: input.exhibitRefs ?? [],
          priority: input.priority,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Add question failed",
        });
      }
    }),

  updateQuestion: protectedProcedure
    .input(
      z.object({
        questionId: z.string().uuid(),
        text: z.string().min(1).max(4000).optional(),
        expectedAnswer: nullableTrimmed(4000),
        notes: nullableTrimmed(4000),
        exhibitRefs: z.array(z.string().min(1).max(80)).max(50).optional(),
        priority: PRIORITY.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(caseDepositionQuestions)
        .where(eq(caseDepositionQuestions.id, input.questionId))
        .limit(1);
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "Question not found" });
      const [topic] = await ctx.db
        .select()
        .from(caseDepositionTopics)
        .where(eq(caseDepositionTopics.id, row.topicId))
        .limit(1);
      if (!topic)
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      const result = await depositionService
        .getOutline(ctx.db, topic.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        const { questionId: _id, ...patch } = input;
        await depositionService.updateQuestion(ctx.db, input.questionId, patch);
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
        .from(caseDepositionQuestions)
        .where(eq(caseDepositionQuestions.id, input.questionId))
        .limit(1);
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "Question not found" });
      const [topic] = await ctx.db
        .select()
        .from(caseDepositionTopics)
        .where(eq(caseDepositionTopics.id, row.topicId))
        .limit(1);
      if (!topic)
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      const result = await depositionService
        .getOutline(ctx.db, topic.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        await depositionService.deleteQuestion(ctx.db, input.questionId);
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
        topicId: z.string().uuid(),
        orderedIds: z.array(z.string().uuid()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [topic] = await ctx.db
        .select()
        .from(caseDepositionTopics)
        .where(eq(caseDepositionTopics.id, input.topicId))
        .limit(1);
      if (!topic)
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      const result = await depositionService
        .getOutline(ctx.db, topic.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      await assertCaseAccess(ctx, result.outline.caseId);
      try {
        await depositionService.reorderQuestions(
          ctx.db,
          input.topicId,
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

  // ── AI generation ──────────────────────────────────────────────────────
  generateQuestionsForTopic: protectedProcedure
    .input(
      z.object({
        topicId: z.string().uuid(),
        desiredCount: z.number().int().min(1).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [topic] = await ctx.db
        .select()
        .from(caseDepositionTopics)
        .where(eq(caseDepositionTopics.id, input.topicId))
        .limit(1);
      if (!topic)
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      const result = await depositionService
        .getOutline(ctx.db, topic.outlineId)
        .catch(() => null);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Outline not found" });
      const outline = result.outline;
      await assertCaseAccess(ctx, outline.caseId);

      const [caseRow] = await ctx.db
        .select()
        .from(cases)
        .where(eq(cases.id, outline.caseId))
        .limit(1);
      if (!caseRow)
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });

      let generated;
      try {
        generated = await generateDepositionQuestions({
          caseFacts: caseRow.description ?? "",
          caseType:
            caseRow.overrideCaseType ?? caseRow.detectedCaseType ?? "general",
          deponentName: outline.deponentName,
          deponentRole: outline.deponentRole,
          topicCategory: topic.category,
          topicTitle: topic.title,
          desiredCount: input.desiredCount,
          partyServing: outline.servingParty,
        });
      } catch (e) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: e instanceof Error ? e.message : "AI generation failed",
        });
      }

      const insertedIds: string[] = [];
      for (const q of generated) {
        const ins = await depositionService.addQuestion(ctx.db, input.topicId, {
          text: q.text,
          source: "ai",
          priority: "important",
        });
        insertedIds.push(ins.id);
      }
      return { count: insertedIds.length, ids: insertedIds };
    }),
});
