// src/server/trpc/routers/conflict-checker.ts
//
// Phase 3.6 — Conflict Checker tRPC router.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import * as conflictCheckerService from "@/server/services/conflict-checker/service";

function requireOrgId(ctx: { user: { orgId: string | null } }): string {
  const orgId = ctx.user.orgId;
  if (!orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Organization required for conflict checks",
    });
  }
  return orgId;
}

export const conflictCheckerRouter = router({
  runCheck: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        email: z.string().trim().max(200).optional(),
        address: z.string().trim().max(500).optional(),
        context: z
          .enum(["client_create", "case_create", "manual_check"])
          .default("manual_check"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      return conflictCheckerService.runConflictCheck(
        ctx.db,
        orgId,
        { name: input.name, email: input.email, address: input.address },
        ctx.user.id,
        input.context,
      );
    }),

  recordOverride: protectedProcedure
    .input(
      z.object({
        logId: z.string().uuid(),
        clientId: z.string().uuid().optional(),
        caseId: z.string().uuid().optional(),
        reason: z.string().trim().min(3).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      if (!input.clientId && !input.caseId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "clientId or caseId required",
        });
      }
      return conflictCheckerService.recordOverride(ctx.db, orgId, {
        logId: input.logId,
        clientId: input.clientId,
        caseId: input.caseId,
        reason: input.reason,
        approvedBy: ctx.user.id,
      });
    }),

  attachTarget: protectedProcedure
    .input(
      z.object({
        logId: z.string().uuid(),
        clientId: z.string().uuid().optional(),
        caseId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireOrgId(ctx);
      await conflictCheckerService.attachLogTarget(ctx.db, input.logId, {
        clientId: input.clientId,
        caseId: input.caseId,
      });
      return { ok: true };
    }),

  listLogs: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 25, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      return conflictCheckerService.listLogs(ctx.db, orgId, input);
    }),

  getLog: protectedProcedure
    .input(z.object({ logId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const out = await conflictCheckerService.getLog(
        ctx.db,
        orgId,
        input.logId,
      );
      if (!out.log) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Log not found" });
      }
      return out;
    }),
});
