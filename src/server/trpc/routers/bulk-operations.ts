// src/server/trpc/routers/bulk-operations.ts
//
// Phase 3.15 — Owner/admin-only bulk operations on cases.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { assertOrgRole } from "../lib/permissions";
import {
  bulkArchive,
  bulkReassignLead,
  bulkExportCsv,
  listLogs,
} from "@/server/services/bulk-operations/service";

const caseIdsSchema = z
  .array(z.string().uuid())
  .min(1, "Select at least one case")
  .max(200, "At most 200 cases per call");

export const bulkOperationsRouter = router({
  archive: protectedProcedure
    .input(z.object({ caseIds: caseIdsSchema }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);
      try {
        return await bulkArchive(ctx.db, {
          orgId: ctx.user.orgId!,
          caseIds: input.caseIds,
          performedBy: ctx.user.id,
        });
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Bulk archive failed",
        });
      }
    }),

  reassignLead: protectedProcedure
    .input(
      z.object({
        caseIds: caseIdsSchema,
        newLeadUserId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);
      try {
        return await bulkReassignLead(ctx.db, {
          orgId: ctx.user.orgId!,
          caseIds: input.caseIds,
          newLeadUserId: input.newLeadUserId,
          performedBy: ctx.user.id,
        });
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Bulk reassign failed",
        });
      }
    }),

  exportCsv: protectedProcedure
    .input(z.object({ caseIds: caseIdsSchema }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);
      try {
        return await bulkExportCsv(ctx.db, {
          orgId: ctx.user.orgId!,
          caseIds: input.caseIds,
          performedBy: ctx.user.id,
        });
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Bulk export failed",
        });
      }
    }),

  listLogs: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);
      return await listLogs(ctx.db, ctx.user.orgId!, input ?? {});
    }),
});
