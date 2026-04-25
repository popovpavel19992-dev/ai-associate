// src/server/trpc/routers/witness-lists.ts
//
// Trial Prep / Witness Lists (3.2.1) tRPC router.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { cases } from "@/server/db/schema/cases";
import { caseWitnesses } from "@/server/db/schema/case-witnesses";
import * as witnessListsService from "@/server/services/witness-lists/service";
import { draftWitnessTestimony } from "@/server/services/witness-lists/ai-testimony";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const SERVING_PARTY = z.enum(["plaintiff", "defendant"]);
const PARTY_AFFILIATION = z.enum(["plaintiff", "defendant", "non_party"]);
const CATEGORY = z.enum(["fact", "expert", "impeachment", "rebuttal"]);

const ORDINAL_LIST_TITLES = [
  "Trial",
  "First Amended Trial",
  "Second Amended Trial",
  "Third Amended Trial",
  "Fourth Amended Trial",
  "Fifth Amended Trial",
];

function defaultListTitle(party: "plaintiff" | "defendant", n: number): string {
  const partyLabel = party === "plaintiff" ? "Plaintiff" : "Defendant";
  const adj = ORDINAL_LIST_TITLES[n - 1] ?? `${n}th Amended Trial`;
  return `${partyLabel}'s ${adj} Witness List`;
}

function buildCaseFacts(caseRow: {
  description: string | null;
  opposingParty: string | null;
  caseBrief: unknown;
}): string {
  const parts: string[] = [];
  if (caseRow.description) parts.push(`Description: ${caseRow.description}`);
  if (caseRow.opposingParty) parts.push(`Opposing party: ${caseRow.opposingParty}`);
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

const WITNESS_FIELDS = {
  category: CATEGORY,
  partyAffiliation: PARTY_AFFILIATION,
  fullName: z.string().min(1).max(200),
  titleOrRole: z.string().max(200).nullish(),
  address: z.string().max(500).nullish(),
  phone: z.string().max(50).nullish(),
  email: z.string().max(200).nullish(),
  expectedTestimony: z.string().max(8000).nullish(),
  exhibitRefs: z.array(z.string().min(1).max(20)).max(50).optional(),
  isWillCall: z.boolean().optional(),
};

export const witnessListsRouter = router({
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return witnessListsService.listForCase(ctx.db, input.caseId);
    }),

  getList: protectedProcedure
    .input(z.object({ listId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await witnessListsService
        .getList(ctx.db, input.listId)
        .catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Witness list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      return result;
    }),

  getNextListNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), servingParty: SERVING_PARTY }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const next = await witnessListsService.getNextListNumber(
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
      const listNumber = await witnessListsService.getNextListNumber(
        ctx.db,
        input.caseId,
        input.servingParty,
      );
      return witnessListsService.createList(ctx.db, {
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
      const result = await witnessListsService
        .getList(ctx.db, input.listId)
        .catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Witness list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await witnessListsService.updateListMeta(ctx.db, input.listId, { title: input.title });
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
      const result = await witnessListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Witness list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await witnessListsService.finalizeList(ctx.db, input.listId);
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
      const result = await witnessListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Witness list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await witnessListsService.markServed(ctx.db, input.listId, new Date(input.servedAt));
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
      const result = await witnessListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Witness list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await witnessListsService.deleteList(ctx.db, input.listId);
      } catch (e) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),

  addWitness: protectedProcedure
    .input(z.object({ listId: z.string().uuid(), ...WITNESS_FIELDS }))
    .mutation(async ({ ctx, input }) => {
      const result = await witnessListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Witness list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        return await witnessListsService.addWitness(ctx.db, input.listId, {
          category: input.category,
          partyAffiliation: input.partyAffiliation,
          fullName: input.fullName,
          titleOrRole: input.titleOrRole ?? null,
          address: input.address ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          expectedTestimony: input.expectedTestimony ?? null,
          exhibitRefs: input.exhibitRefs,
          isWillCall: input.isWillCall,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Add witness failed",
        });
      }
    }),

  updateWitness: protectedProcedure
    .input(
      z.object({
        witnessId: z.string().uuid(),
        category: CATEGORY.optional(),
        partyAffiliation: PARTY_AFFILIATION.optional(),
        fullName: z.string().min(1).max(200).optional(),
        titleOrRole: z.string().max(200).nullish(),
        address: z.string().max(500).nullish(),
        phone: z.string().max(50).nullish(),
        email: z.string().max(200).nullish(),
        expectedTestimony: z.string().max(8000).nullish(),
        exhibitRefs: z.array(z.string().min(1).max(20)).max(50).optional(),
        isWillCall: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [w] = await ctx.db
        .select()
        .from(caseWitnesses)
        .where(eq(caseWitnesses.id, input.witnessId))
        .limit(1);
      if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Witness not found" });
      const result = await witnessListsService.getList(ctx.db, w.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Witness list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        const { witnessId: _wid, ...patch } = input;
        await witnessListsService.updateWitness(ctx.db, input.witnessId, patch);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update witness failed",
        });
      }
      return { ok: true as const };
    }),

  deleteWitness: protectedProcedure
    .input(z.object({ witnessId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [w] = await ctx.db
        .select()
        .from(caseWitnesses)
        .where(eq(caseWitnesses.id, input.witnessId))
        .limit(1);
      if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Witness not found" });
      const result = await witnessListsService.getList(ctx.db, w.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Witness list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await witnessListsService.deleteWitness(ctx.db, input.witnessId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Delete witness failed",
        });
      }
      return { ok: true as const };
    }),

  reorderWitnesses: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        orderedIds: z.array(z.string().uuid()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await witnessListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Witness list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      try {
        await witnessListsService.reorderWitnesses(ctx.db, input.listId, input.orderedIds);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Reorder failed",
        });
      }
      return { ok: true as const };
    }),

  draftTestimony: protectedProcedure
    .input(z.object({ listId: z.string().uuid(), witnessId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await witnessListsService.getList(ctx.db, input.listId).catch(() => null);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Witness list not found" });
      await assertCaseAccess(ctx, result.list.caseId);
      const witness = result.witnesses.find((w) => w.id === input.witnessId);
      if (!witness) throw new TRPCError({ code: "NOT_FOUND", message: "Witness not in list" });

      const [caseRow] = await ctx.db
        .select()
        .from(cases)
        .where(eq(cases.id, result.list.caseId))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });

      let text: string;
      try {
        text = await draftWitnessTestimony({
          caseFacts: buildCaseFacts(caseRow),
          caseType: resolveCaseType(caseRow),
          witnessFullName: witness.fullName,
          witnessRole: witness.titleOrRole ?? undefined,
          witnessCategory: witness.category,
          partyAffiliation: witness.partyAffiliation,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AI generation failed";
        if (msg.includes("ANTHROPIC_API_KEY")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: msg });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      try {
        await witnessListsService.setExpectedTestimony(ctx.db, input.witnessId, text);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not persist testimony",
        });
      }
      return { text };
    }),
});
