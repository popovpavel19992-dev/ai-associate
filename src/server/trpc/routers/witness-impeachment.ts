import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { assertCaseAccess } from "../lib/permissions";
import {
  attachStatement,
  detachStatement,
  listStatementsForWitness,
  runScanFlow,
  getScanForWitness,
  NotBetaOrgError,
  InsufficientCreditsError,
  WitnessNotFoundError,
  NoStatementsError,
  NotExtractedError,
  NoClaimsError,
} from "@/server/services/witness-impeachment";
import { STATEMENT_KIND } from "@/server/db/schema/case-witness-statements";

function requireOrg(orgId: string | null | undefined): string {
  if (!orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Organization required",
    });
  }
  return orgId;
}

function mapErr(e: unknown): never {
  if (e instanceof NotBetaOrgError) {
    throw new TRPCError({ code: "FORBIDDEN", message: e.message });
  }
  if (e instanceof InsufficientCreditsError) {
    throw new TRPCError({
      code: "PAYMENT_REQUIRED",
      message: e.message,
    });
  }
  if (e instanceof WitnessNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  }
  if (e instanceof NoStatementsError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: JSON.stringify({ kind: "noStatements" }),
    });
  }
  if (e instanceof NotExtractedError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: JSON.stringify({ kind: "notExtracted", filenames: e.filenames }),
    });
  }
  if (e instanceof NoClaimsError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: JSON.stringify({ kind: "noClaims" }),
    });
  }
  throw e;
}

export const witnessImpeachmentRouter = router({
  attachStatement: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        witnessId: z.string().uuid(),
        documentId: z.string().uuid(),
        statementKind: z.enum(STATEMENT_KIND),
        statementDate: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await attachStatement({
          orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          witnessId: input.witnessId,
          documentId: input.documentId,
          statementKind: input.statementKind,
          statementDate: input.statementDate ?? null,
          notes: input.notes ?? null,
        });
      } catch (e) {
        return mapErr(e);
      }
    }),

  detachStatement: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        statementId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        await detachStatement({ orgId, statementId: input.statementId });
        return { ok: true as const };
      } catch (e) {
        return mapErr(e);
      }
    }),

  listStatementsForWitness: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        witnessId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      return await listStatementsForWitness({
        orgId,
        caseId: input.caseId,
        witnessId: input.witnessId,
      });
    }),

  runScan: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        witnessId: z.string().uuid(),
        regenerate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await runScanFlow({
          orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          witnessId: input.witnessId,
          regenerateSalt: input.regenerate ? Date.now() : undefined,
        });
      } catch (e) {
        return mapErr(e);
      }
    }),

  getScan: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        witnessId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOrg(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      return await getScanForWitness({
        orgId,
        caseId: input.caseId,
        witnessId: input.witnessId,
      });
    }),
});
