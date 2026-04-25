// src/server/trpc/routers/jury-instructions.ts
//
// Trial Prep / Proposed Jury Instructions (3.2.3) tRPC router.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseJuryInstructions } from "@/server/db/schema/case-jury-instructions";
import * as juryInstructionsService from "@/server/services/jury-instructions/service";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const SERVING_PARTY = z.enum(["plaintiff", "defendant"]);
const CATEGORY = z.enum(["preliminary", "substantive", "damages", "concluding"]);
const PARTY_POSITION = z.enum([
  "plaintiff_proposed",
  "defendant_proposed",
  "agreed",
  "court_ordered",
]);

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
  return `${partyLabel}'s ${adj} Jury Instructions`;
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

export const juryInstructionsRouter = router({
  // ── Library ────────────────────────────────────────────────────────────
  listLibraryTemplates: protectedProcedure
    .input(z.object({ category: CATEGORY.optional() }))
    .query(async ({ ctx, input }) => {
      // Both global (NULL) + this org's customizations.
      const orgId = ctx.user.orgId ?? null;
      return juryInstructionsService.listLibraryTemplates(
        ctx.db,
        orgId,
        input.category,
      );
    }),

  // ── Sets ───────────────────────────────────────────────────────────────
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return juryInstructionsService.listForCase(ctx.db, input.caseId);
    }),

  getSet: protectedProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await juryInstructionsService
        .getSet(ctx.db, input.setId)
        .catch(() => null);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction set not found" });
      }
      await assertCaseAccess(ctx, result.set.caseId);
      return result;
    }),

  getNextSetNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), servingParty: SERVING_PARTY }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const next = await juryInstructionsService.getNextSetNumber(
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
      const setNumber = await juryInstructionsService.getNextSetNumber(
        ctx.db,
        input.caseId,
        input.servingParty,
      );
      return juryInstructionsService.createSet(ctx.db, {
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
      const result = await juryInstructionsService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await juryInstructionsService.updateSetMeta(ctx.db, input.setId, {
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
      const result = await juryInstructionsService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await juryInstructionsService.finalizeSet(ctx.db, input.setId);
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
      const result = await juryInstructionsService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await juryInstructionsService.markSubmitted(
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
      const result = await juryInstructionsService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await juryInstructionsService.deleteSet(ctx.db, input.setId);
      } catch (e) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),

  // ── Instructions ───────────────────────────────────────────────────────
  addInstruction: protectedProcedure
    .input(
      z.object({
        setId: z.string().uuid(),
        category: CATEGORY,
        instructionNumber: z.string().min(1).max(40),
        title: z.string().min(1).max(300),
        body: z.string().min(1).max(20000),
        partyPosition: PARTY_POSITION.optional(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await juryInstructionsService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        return await juryInstructionsService.addInstruction(ctx.db, input.setId, {
          category: input.category,
          instructionNumber: input.instructionNumber,
          title: input.title,
          body: input.body,
          partyPosition: input.partyPosition,
          notes: input.notes ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Add instruction failed",
        });
      }
    }),

  addFromTemplate: protectedProcedure
    .input(z.object({ setId: z.string().uuid(), templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await juryInstructionsService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        return await juryInstructionsService.addInstructionFromTemplate(
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

  updateInstruction: protectedProcedure
    .input(
      z.object({
        instructionId: z.string().uuid(),
        category: CATEGORY.optional(),
        instructionNumber: z.string().min(1).max(40).optional(),
        title: z.string().min(1).max(300).optional(),
        body: z.string().min(1).max(20000).optional(),
        partyPosition: PARTY_POSITION.optional(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(caseJuryInstructions)
        .where(eq(caseJuryInstructions.id, input.instructionId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction not found" });
      const result = await juryInstructionsService.getSet(ctx.db, row.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        const { instructionId: _id, ...patch } = input;
        await juryInstructionsService.updateInstruction(ctx.db, input.instructionId, patch);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update instruction failed",
        });
      }
      return { ok: true as const };
    }),

  deleteInstruction: protectedProcedure
    .input(z.object({ instructionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(caseJuryInstructions)
        .where(eq(caseJuryInstructions.id, input.instructionId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction not found" });
      const result = await juryInstructionsService.getSet(ctx.db, row.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await juryInstructionsService.deleteInstruction(ctx.db, input.instructionId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Delete instruction failed",
        });
      }
      return { ok: true as const };
    }),

  reorderInstructions: protectedProcedure
    .input(
      z.object({
        setId: z.string().uuid(),
        orderedIds: z.array(z.string().uuid()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await juryInstructionsService.getSet(ctx.db, input.setId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Jury instruction set not found" });
      await assertCaseAccess(ctx, result.set.caseId);
      try {
        await juryInstructionsService.reorderInstructions(
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
