// src/server/trpc/routers/privilege-log.ts
//
// Privilege log tRPC router — ClearTerms 3.1.5.
// Manual CRUD; no AI auto-generation in MVP.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import * as privilegeLogService from "@/server/services/privilege-log/service";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";
import { PRIVILEGE_BASIS_VALUES } from "@/server/db/schema/case-privilege-log-entries";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const PRIVILEGE_BASIS = z.enum([...PRIVILEGE_BASIS_VALUES] as [string, ...string[]]);
const WITHHELD_BY = z.enum(["plaintiff", "defendant"]);

const ENTRY_FIELDS = {
  relatedRequestId: z.string().uuid().nullable().optional(),
  entryNumber: z.number().int().min(1).max(9999).optional(),
  documentDate: z.string().nullable().optional(),
  documentType: z.string().max(100).nullable().optional(),
  author: z.string().max(500).nullable().optional(),
  recipients: z.array(z.string().max(500)).optional(),
  cc: z.array(z.string().max(500)).optional(),
  subject: z.string().max(500).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  privilegeBasis: PRIVILEGE_BASIS,
  basisExplanation: z.string().max(2000).nullable().optional(),
  withheldBy: WITHHELD_BY,
  batesRange: z.string().max(200).nullable().optional(),
};

async function assertRequestBelongsToCase(
  ctx: { db: any },
  requestId: string,
  caseId: string,
): Promise<void> {
  const [row] = await ctx.db
    .select({ caseId: caseDiscoveryRequests.caseId })
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, requestId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Discovery request not found" });
  }
  if (row.caseId !== caseId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Discovery request does not belong to this case",
    });
  }
}

export const privilegeLogRouter = router({
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return privilegeLogService.listForCase(ctx.db, input.caseId);
    }),

  listForRequest: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ caseId: caseDiscoveryRequests.caseId })
        .from(caseDiscoveryRequests)
        .where(eq(caseDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Discovery request not found" });
      }
      await assertCaseAccess(ctx, row.caseId);
      return privilegeLogService.listForRequest(ctx.db, input.requestId);
    }),

  getNextEntryNumber: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const next = await privilegeLogService.getNextEntryNumber(ctx.db, input.caseId);
      return { entryNumber: next };
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        ...ENTRY_FIELDS,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);
      if (input.relatedRequestId) {
        await assertRequestBelongsToCase(ctx, input.relatedRequestId, input.caseId);
      }
      try {
        return await privilegeLogService.createEntry(ctx.db, {
          orgId,
          caseId: input.caseId,
          relatedRequestId: input.relatedRequestId ?? null,
          entryNumber: input.entryNumber,
          documentDate: input.documentDate ?? null,
          documentType: input.documentType ?? null,
          author: input.author ?? null,
          recipients: input.recipients ?? [],
          cc: input.cc ?? [],
          subject: input.subject ?? null,
          description: input.description ?? null,
          privilegeBasis: input.privilegeBasis as any,
          basisExplanation: input.basisExplanation ?? null,
          withheldBy: input.withheldBy,
          batesRange: input.batesRange ?? null,
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
        id: z.string().uuid(),
        relatedRequestId: z.string().uuid().nullable().optional(),
        entryNumber: z.number().int().min(1).max(9999).optional(),
        documentDate: z.string().nullable().optional(),
        documentType: z.string().max(100).nullable().optional(),
        author: z.string().max(500).nullable().optional(),
        recipients: z.array(z.string().max(500)).optional(),
        cc: z.array(z.string().max(500)).optional(),
        subject: z.string().max(500).nullable().optional(),
        description: z.string().max(5000).nullable().optional(),
        privilegeBasis: PRIVILEGE_BASIS.optional(),
        basisExplanation: z.string().max(2000).nullable().optional(),
        withheldBy: WITHHELD_BY.optional(),
        batesRange: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await privilegeLogService
        .getEntry(ctx.db, input.id)
        .catch(() => null);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Privilege log entry not found" });
      }
      await assertCaseAccess(ctx, existing.caseId);
      if (input.relatedRequestId) {
        await assertRequestBelongsToCase(ctx, input.relatedRequestId, existing.caseId);
      }
      const { id, ...patch } = input;
      try {
        await privilegeLogService.updateEntry(ctx.db, id, patch as any);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Update failed",
        });
      }
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await privilegeLogService
        .getEntry(ctx.db, input.id)
        .catch(() => null);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Privilege log entry not found" });
      }
      await assertCaseAccess(ctx, existing.caseId);
      await privilegeLogService.deleteEntry(ctx.db, input.id);
      return { ok: true as const };
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        orderedIds: z.array(z.string().uuid()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      await privilegeLogService.reorder(ctx.db, input.caseId, input.orderedIds);
      return { ok: true as const };
    }),
});
