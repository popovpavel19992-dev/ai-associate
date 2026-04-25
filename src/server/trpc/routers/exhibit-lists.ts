// src/server/trpc/routers/exhibit-lists.ts
//
// Trial Prep / Trial Exhibit List (3.2.2) tRPC router.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseExhibits } from "@/server/db/schema/case-exhibits";
import { caseWitnesses } from "@/server/db/schema/case-witnesses";
import { caseWitnessLists } from "@/server/db/schema/case-witness-lists";
import * as exhibitListsService from "@/server/services/exhibit-lists/service";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const SERVING_PARTY = z.enum(["plaintiff", "defendant"]);
const DOC_TYPE = z.enum([
  "document",
  "photo",
  "video",
  "audio",
  "physical",
  "demonstrative",
  "electronic",
]);
const ADMISSION_STATUS = z.enum([
  "proposed",
  "pre_admitted",
  "admitted",
  "not_admitted",
  "withdrawn",
  "objected",
]);

const ORDINALS = [
  "Trial",
  "First Amended Trial",
  "Second Amended Trial",
  "Third Amended Trial",
  "Fourth Amended Trial",
  "Fifth Amended Trial",
];

function defaultListTitle(party: "plaintiff" | "defendant", n: number): string {
  const partyLabel = party === "plaintiff" ? "Plaintiff" : "Defendant";
  const adj = ORDINALS[n - 1] ?? `${n}th Amended Trial`;
  return `${partyLabel}'s ${adj} Exhibit List`;
}

// Empty-string → null helper; lets clients send "" for clearing optional fields.
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

const EXHIBIT_FIELDS = {
  description: z.string().min(1).max(2000),
  docType: DOC_TYPE.optional(),
  exhibitDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "exhibitDate must be YYYY-MM-DD")
    .nullish(),
  sponsoringWitnessId: z.string().uuid().nullish(),
  sponsoringWitnessName: nullableTrimmed(200),
  admissionStatus: ADMISSION_STATUS.optional(),
  batesRange: nullableTrimmed(200),
  sourceDocumentId: z.string().uuid().nullish(),
  notes: nullableTrimmed(4000),
};

export const exhibitListsRouter = router({
  // Aggregated list of witnesses across every witness list on this case —
  // powers the sponsoring-witness autocomplete in the exhibit form.
  witnessesForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const rows = await ctx.db
        .select({
          id: caseWitnesses.id,
          fullName: caseWitnesses.fullName,
          listId: caseWitnesses.listId,
        })
        .from(caseWitnesses)
        .innerJoin(
          caseWitnessLists,
          eq(caseWitnesses.listId, caseWitnessLists.id),
        )
        .where(eq(caseWitnessLists.caseId, input.caseId));
      const seen = new Map<string, { id: string; fullName: string }>();
      for (const r of rows as { id: string; fullName: string }[]) {
        if (!seen.has(r.id)) seen.set(r.id, { id: r.id, fullName: r.fullName });
      }
      return [...seen.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
    }),

  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return exhibitListsService.listForCase(ctx.db, input.caseId);
    }),

  getList: protectedProcedure
    .input(z.object({ listId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await exhibitListsService
        .getList(ctx.db, input.listId)
        .catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      return result;
    }),

  getNextListNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), servingParty: SERVING_PARTY }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const next = await exhibitListsService.getNextListNumber(
        ctx.db,
        input.caseId,
        input.servingParty,
      );
      return { listNumber: next };
    }),

  createList: protectedProcedure
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
      const listNumber = await exhibitListsService.getNextListNumber(
        ctx.db,
        input.caseId,
        input.servingParty,
      );
      return exhibitListsService.createList(ctx.db, {
        orgId,
        caseId: input.caseId,
        servingParty: input.servingParty,
        listNumber,
        title: input.title ?? defaultListTitle(input.servingParty, listNumber),
        createdBy: ctx.user.id,
      });
    }),

  updateListMeta: protectedProcedure
    .input(z.object({ listId: z.string().uuid(), title: z.string().min(1).max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await exhibitListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await exhibitListsService.updateListMeta(ctx.db, input.listId, { title: input.title });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update failed",
        });
      }
      return { ok: true as const };
    }),

  finalize: protectedProcedure
    .input(z.object({ listId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await exhibitListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await exhibitListsService.finalizeList(ctx.db, input.listId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Finalize failed",
        });
      }
      return { ok: true as const };
    }),

  markServed: protectedProcedure
    .input(z.object({ listId: z.string().uuid(), servedAt: z.string().datetime() }))
    .mutation(async ({ ctx, input }) => {
      const result = await exhibitListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await exhibitListsService.markServed(ctx.db, input.listId, new Date(input.servedAt));
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-served failed",
        });
      }
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ listId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await exhibitListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await exhibitListsService.deleteList(ctx.db, input.listId);
      } catch (e) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),

  addExhibit: protectedProcedure
    .input(z.object({ listId: z.string().uuid(), ...EXHIBIT_FIELDS }))
    .mutation(async ({ ctx, input }) => {
      const result = await exhibitListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        return await exhibitListsService.addExhibit(ctx.db, input.listId, {
          description: input.description,
          docType: input.docType,
          exhibitDate: input.exhibitDate ?? null,
          sponsoringWitnessId: input.sponsoringWitnessId ?? null,
          sponsoringWitnessName: input.sponsoringWitnessName ?? null,
          admissionStatus: input.admissionStatus,
          batesRange: input.batesRange ?? null,
          sourceDocumentId: input.sourceDocumentId ?? null,
          notes: input.notes ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Add exhibit failed",
        });
      }
    }),

  updateExhibit: protectedProcedure
    .input(
      z.object({
        exhibitId: z.string().uuid(),
        description: z.string().min(1).max(2000).optional(),
        docType: DOC_TYPE.optional(),
        exhibitDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "exhibitDate must be YYYY-MM-DD")
          .nullish(),
        sponsoringWitnessId: z.string().uuid().nullish(),
        sponsoringWitnessName: nullableTrimmed(200),
        batesRange: nullableTrimmed(200),
        sourceDocumentId: z.string().uuid().nullish(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [w] = await ctx.db
        .select()
        .from(caseExhibits)
        .where(eq(caseExhibits.id, input.exhibitId))
        .limit(1);
      if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit not found" });
      const result = await exhibitListsService.getList(ctx.db, w.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        const { exhibitId: _id, ...patch } = input;
        await exhibitListsService.updateExhibit(ctx.db, input.exhibitId, patch);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update exhibit failed",
        });
      }
      return { ok: true as const };
    }),

  updateAdmissionStatus: protectedProcedure
    .input(
      z.object({
        exhibitId: z.string().uuid(),
        admissionStatus: ADMISSION_STATUS,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [w] = await ctx.db
        .select()
        .from(caseExhibits)
        .where(eq(caseExhibits.id, input.exhibitId))
        .limit(1);
      if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit not found" });
      const result = await exhibitListsService.getList(ctx.db, w.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await exhibitListsService.updateAdmissionStatus(
          ctx.db,
          input.exhibitId,
          input.admissionStatus,
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update admission status failed",
        });
      }
      return { ok: true as const };
    }),

  deleteExhibit: protectedProcedure
    .input(z.object({ exhibitId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [w] = await ctx.db
        .select()
        .from(caseExhibits)
        .where(eq(caseExhibits.id, input.exhibitId))
        .limit(1);
      if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit not found" });
      const result = await exhibitListsService.getList(ctx.db, w.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await exhibitListsService.deleteExhibit(ctx.db, input.exhibitId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Delete exhibit failed",
        });
      }
      return { ok: true as const };
    }),

  reorderExhibits: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        orderedIds: z.array(z.string().uuid()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await exhibitListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Exhibit list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await exhibitListsService.reorderExhibits(ctx.db, input.listId, input.orderedIds);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Reorder failed",
        });
      }
      return { ok: true as const };
    }),
});
