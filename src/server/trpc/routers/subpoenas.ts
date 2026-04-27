// src/server/trpc/routers/subpoenas.ts
//
// FRCP 45 Subpoena Builder (3.1.7) tRPC router.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { cases } from "@/server/db/schema/cases";
import * as subpoenaService from "@/server/services/subpoenas/service";
import {
  suggestDocumentCategories,
  suggestTestimonyTopics,
} from "@/server/services/subpoenas/ai-suggest";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId)
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const SUBPOENA_TYPE = z.enum(["testimony", "documents", "both"]);
const ISSUING_PARTY = z.enum(["plaintiff", "defendant"]);
const SERVED_METHOD = z.enum(["personal", "mail", "email", "process_server"]);

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

const itemList = z.array(z.string().min(1).max(2000)).max(50);

async function loadOwned(
  ctx: any,
  subpoenaId: string,
): Promise<typeof subpoenaService.caseSubpoenas.$inferSelect> {
  const row = await subpoenaService
    .getSubpoena(ctx.db, subpoenaId)
    .catch(() => null);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Subpoena not found" });
  }
  await assertCaseAccess(ctx, row.caseId);
  return row;
}

export const subpoenasRouter = router({
  // ── Queries ─────────────────────────────────────────────────────────────
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return subpoenaService.listForCase(ctx.db, input.caseId);
    }),

  getNextNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const n = await subpoenaService.getNextSubpoenaNumber(ctx.db, input.caseId);
      return { subpoenaNumber: n };
    }),

  get: protectedProcedure
    .input(z.object({ subpoenaId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return loadOwned(ctx, input.subpoenaId);
    }),

  // ── Mutations ───────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        subpoenaType: SUBPOENA_TYPE,
        issuingParty: ISSUING_PARTY,
        issuingAttorneyId: z.string().uuid().nullish(),
        recipientName: z.string().min(1).max(300),
        recipientAddress: nullableTrimmed(1000),
        recipientEmail: nullableTrimmed(320),
        recipientPhone: nullableTrimmed(40),
        complianceDate: isoDate.nullish(),
        complianceLocation: nullableTrimmed(1000),
        documentsRequested: itemList.optional(),
        testimonyTopics: itemList.optional(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await subpoenaService.createSubpoena(ctx.db, {
          orgId,
          caseId: input.caseId,
          subpoenaType: input.subpoenaType,
          issuingParty: input.issuingParty,
          issuingAttorneyId: input.issuingAttorneyId ?? null,
          recipientName: input.recipientName,
          recipientAddress: input.recipientAddress ?? null,
          recipientEmail: input.recipientEmail ?? null,
          recipientPhone: input.recipientPhone ?? null,
          complianceDate: input.complianceDate ?? null,
          complianceLocation: input.complianceLocation ?? null,
          documentsRequested: input.documentsRequested ?? [],
          testimonyTopics: input.testimonyTopics ?? [],
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
        subpoenaId: z.string().uuid(),
        subpoenaType: SUBPOENA_TYPE.optional(),
        issuingParty: ISSUING_PARTY.optional(),
        issuingAttorneyId: z.string().uuid().nullish(),
        recipientName: z.string().min(1).max(300).optional(),
        recipientAddress: nullableTrimmed(1000),
        recipientEmail: nullableTrimmed(320),
        recipientPhone: nullableTrimmed(40),
        complianceDate: isoDate.nullish(),
        complianceLocation: nullableTrimmed(1000),
        documentsRequested: itemList.optional(),
        testimonyTopics: itemList.optional(),
        notes: nullableTrimmed(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx, input.subpoenaId);
      try {
        const { subpoenaId: _id, ...patch } = input;
        await subpoenaService.updateSubpoena(ctx.db, input.subpoenaId, {
          ...patch,
          issuingAttorneyId:
            patch.issuingAttorneyId === undefined
              ? undefined
              : patch.issuingAttorneyId ?? null,
          recipientAddress:
            patch.recipientAddress === undefined ? undefined : patch.recipientAddress,
          recipientEmail:
            patch.recipientEmail === undefined ? undefined : patch.recipientEmail,
          recipientPhone:
            patch.recipientPhone === undefined ? undefined : patch.recipientPhone,
          complianceDate:
            patch.complianceDate === undefined ? undefined : patch.complianceDate ?? null,
          complianceLocation:
            patch.complianceLocation === undefined ? undefined : patch.complianceLocation,
          notes: patch.notes === undefined ? undefined : patch.notes,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update failed",
        });
      }
      return { ok: true as const };
    }),

  markIssued: protectedProcedure
    .input(z.object({ subpoenaId: z.string().uuid(), dateIssued: isoDate }))
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx, input.subpoenaId);
      try {
        await subpoenaService.markIssued(
          ctx.db,
          input.subpoenaId,
          input.dateIssued,
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-issued failed",
        });
      }
      return { ok: true as const };
    }),

  markServed: protectedProcedure
    .input(
      z.object({
        subpoenaId: z.string().uuid(),
        servedAt: z.string().datetime(),
        servedByName: z.string().min(1).max(300),
        servedMethod: SERVED_METHOD,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx, input.subpoenaId);
      try {
        await subpoenaService.markServed(ctx.db, input.subpoenaId, {
          servedAt: new Date(input.servedAt),
          servedByName: input.servedByName,
          servedMethod: input.servedMethod,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-served failed",
        });
      }
      return { ok: true as const };
    }),

  markComplied: protectedProcedure
    .input(z.object({ subpoenaId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx, input.subpoenaId);
      try {
        await subpoenaService.markComplied(ctx.db, input.subpoenaId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-complied failed",
        });
      }
      return { ok: true as const };
    }),

  markObjected: protectedProcedure
    .input(z.object({ subpoenaId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx, input.subpoenaId);
      try {
        await subpoenaService.markObjected(ctx.db, input.subpoenaId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-objected failed",
        });
      }
      return { ok: true as const };
    }),

  markQuashed: protectedProcedure
    .input(z.object({ subpoenaId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx, input.subpoenaId);
      try {
        await subpoenaService.markQuashed(ctx.db, input.subpoenaId);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Mark-quashed failed",
        });
      }
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ subpoenaId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx, input.subpoenaId);
      try {
        await subpoenaService.deleteSubpoena(ctx.db, input.subpoenaId);
      } catch (e) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: e instanceof Error ? e.message : "Delete failed",
        });
      }
      return { ok: true as const };
    }),

  // ── AI helpers ──────────────────────────────────────────────────────────
  suggestDocuments: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        recipientName: z.string().min(1).max(300),
        recipientRole: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const [caseRow] = await ctx.db
        .select()
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .limit(1);
      if (!caseRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }
      try {
        const items = await suggestDocumentCategories({
          caseFacts: caseRow.description ?? "",
          caseType:
            caseRow.overrideCaseType ?? caseRow.detectedCaseType ?? "general",
          recipientName: input.recipientName,
          recipientRole: input.recipientRole,
        });
        return { items };
      } catch (e) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: e instanceof Error ? e.message : "AI suggestion failed",
        });
      }
    }),

  suggestTopics: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        recipientName: z.string().min(1).max(300),
        recipientRole: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const [caseRow] = await ctx.db
        .select()
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .limit(1);
      if (!caseRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }
      try {
        const items = await suggestTestimonyTopics({
          caseFacts: caseRow.description ?? "",
          caseType:
            caseRow.overrideCaseType ?? caseRow.detectedCaseType ?? "general",
          recipientName: input.recipientName,
          recipientRole: input.recipientRole,
        });
        return { items };
      } catch (e) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: e instanceof Error ? e.message : "AI suggestion failed",
        });
      }
    }),
});
