// src/server/trpc/routers/motions-in-limine.ts
//
// Trial Prep / Motions in Limine (3.2.5) tRPC router.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseMotionsInLimine } from "@/server/db/schema/case-motions-in-limine";
import * as milService from "@/server/services/motions-in-limine/service";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const SERVING_PARTY = z.enum(["plaintiff", "defendant"]);
const CATEGORY = z.enum([
  "exclude_character",
  "exclude_prior_bad_acts",
  "daubert",
  "hearsay",
  "settlement_negotiations",
  "insurance",
  "remedial_measures",
  "authentication",
  "other",
]);

const ORDINALS = [
  "First Set of",
  "Second Set of",
  "Third Set of",
  "Fourth Set of",
  "Fifth Set of",
];

function defaultSetTitle(party: "plaintiff" | "defendant", n: number): string {
  const partyLabel = party === "plaintiff" ? "Plaintiff" : "Defendant";
  const adj = ORDINALS[n - 1] ?? `${n}th Set of`;
  return `${partyLabel}'s ${adj} Motions in Limine`;
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

export const motionsInLimineRouter = router({
  // ── Library ────────────────────────────────────────────────────────────
  listLibraryTemplates: protectedProcedure
    .input(z.object({ category: CATEGORY.optional() }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.user.orgId ?? null;
      return milService.listLibraryTemplates(ctx.db, orgId, input.category);
    }),

  // ── Sets ───────────────────────────────────────────────────────────────
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return milService.listForCase(ctx.db, input.caseId);
    }),

  getSet: protectedProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await milService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine set not found" });
      }
      await assertCaseAccess(ctx, result.set.caseId);
      return result;
    }),

  getNextSetNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), servingParty: SERVING_PARTY }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const next = await milService.getNextSetNumber(
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
      const setNumber = await milService.getNextSetNumber(
        ctx.db,
        input.caseId,
        input.servingParty,
      );
      return milService.createSet(ctx.db, {
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
      const result = await milService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await milService.updateSetMeta(ctx.db, input.setId, { title: input.title });
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
      const result = await milService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await milService.finalizeSet(ctx.db, input.setId);
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
      const result = await milService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await milService.markSubmitted(
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
      const result = await milService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await milService.deleteSet(ctx.db, input.setId);
      } catch (e) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),

  // ── MILs ───────────────────────────────────────────────────────────────
  addMil: protectedProcedure
    .input(
      z.object({
        setId: z.string().uuid(),
        category: CATEGORY,
        freRule: z.string().max(40).nullish(),
        title: z.string().min(1).max(300),
        introduction: z.string().min(1).max(20000),
        reliefSought: z.string().min(1).max(20000),
        legalAuthority: z.string().min(1).max(20000),
        conclusion: z.string().min(1).max(20000),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await milService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        return await milService.addMil(ctx.db, input.setId, {
          category: input.category,
          freRule: input.freRule ?? null,
          title: input.title,
          introduction: input.introduction,
          reliefSought: input.reliefSought,
          legalAuthority: input.legalAuthority,
          conclusion: input.conclusion,
          notes: input.notes ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Add MIL failed",
        });
      }
    }),

  addFromTemplate: protectedProcedure
    .input(z.object({ setId: z.string().uuid(), templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await milService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        return await milService.addMilFromTemplate(
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

  updateMil: protectedProcedure
    .input(
      z.object({
        milId: z.string().uuid(),
        category: CATEGORY.optional(),
        freRule: z.string().max(40).nullish(),
        title: z.string().min(1).max(300).optional(),
        introduction: z.string().min(1).max(20000).optional(),
        reliefSought: z.string().min(1).max(20000).optional(),
        legalAuthority: z.string().min(1).max(20000).optional(),
        conclusion: z.string().min(1).max(20000).optional(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(caseMotionsInLimine)
        .where(eq(caseMotionsInLimine.id, input.milId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine not found" });
      const result = await milService.getSet(ctx.db, row.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        const { milId: _id, ...patch } = input;
        await milService.updateMil(ctx.db, input.milId, {
          ...patch,
          freRule: patch.freRule === undefined ? undefined : patch.freRule ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update MIL failed",
        });
      }
      return { ok: true as const };
    }),

  deleteMil: protectedProcedure
    .input(z.object({ milId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(caseMotionsInLimine)
        .where(eq(caseMotionsInLimine.id, input.milId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine not found" });
      const result = await milService.getSet(ctx.db, row.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await milService.deleteMil(ctx.db, input.milId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Delete MIL failed",
        });
      }
      return { ok: true as const };
    }),

  reorderMils: protectedProcedure
    .input(
      z.object({
        setId: z.string().uuid(),
        orderedIds: z.array(z.string().uuid()).min(1).max(99),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await milService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Motion in limine set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await milService.reorderMils(ctx.db, input.setId, input.orderedIds);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Reorder failed",
        });
      }
      return { ok: true as const };
    }),
});
