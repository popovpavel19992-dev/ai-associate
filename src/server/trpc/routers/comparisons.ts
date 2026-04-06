import { z } from "zod/v4";
import { eq, and, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { contracts } from "../../db/schema/contracts";
import {
  contractComparisons,
  contractClauseDiffs,
} from "../../db/schema/contract-comparisons";
import { checkCredits, decrementCredits, refundCredits } from "../../services/credits";
import { inngest } from "../../inngest/client";
import { CONTRACT_REVIEW_CREDITS, COMPARISON_DIFF_CREDITS } from "@/lib/constants";

function contractFilter(ctx: { user: { id: string; orgId: string | null; role: string | null } }) {
  if (!ctx.user.orgId) return eq(contracts.userId, ctx.user.id);
  return eq(contracts.orgId, ctx.user.orgId);
}

function comparisonFilter(ctx: { user: { id: string; orgId: string | null; role: string | null } }) {
  if (!ctx.user.orgId) return eq(contractComparisons.userId, ctx.user.id);
  return eq(contractComparisons.orgId, ctx.user.orgId);
}

export const comparisonsRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        contractAId: z.string().uuid(),
        contractBId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify access to both contracts
      const [contractA] = await ctx.db
        .select()
        .from(contracts)
        .where(and(eq(contracts.id, input.contractAId), contractFilter(ctx)))
        .limit(1);

      if (!contractA) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract A not found" });
      }

      const [contractB] = await ctx.db
        .select()
        .from(contracts)
        .where(and(eq(contracts.id, input.contractBId), contractFilter(ctx)))
        .limit(1);

      if (!contractB) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract B not found" });
      }

      // Calculate credits: 2 per unanalyzed contract + 1 for diff
      // Don't charge for contracts already being processed (extracting/analyzing)
      const needsAnalysisA = contractA.status !== "ready" && contractA.status !== "extracting" && contractA.status !== "analyzing";
      const needsAnalysisB = contractB.status !== "ready" && contractB.status !== "extracting" && contractB.status !== "analyzing";
      let cost = COMPARISON_DIFF_CREDITS;
      if (needsAnalysisA) cost += CONTRACT_REVIEW_CREDITS;
      if (needsAnalysisB) cost += CONTRACT_REVIEW_CREDITS;

      const credits = await checkCredits(ctx.user.id);

      if (credits.available < cost) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Insufficient credits. Need ${cost}, have ${credits.available}.`,
        });
      }

      const success = await decrementCredits(ctx.user.id, cost);
      if (!success) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Credit limit reached" });
      }

      let comparison;
      try {
        const [created] = await ctx.db
          .insert(contractComparisons)
          .values({
            contractAId: input.contractAId,
            contractBId: input.contractBId,
            userId: ctx.user.id,
            orgId: ctx.user.orgId,
            status: "processing",
            creditsConsumed: cost,
          })
          .returning();

        comparison = created;

        await inngest.send({
          name: "contract/compare",
          data: { comparisonId: created.id },
        });
      } catch {
        await refundCredits(ctx.user.id, cost);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to start comparison. Credits have been refunded.",
        });
      }

      return { comparison, creditsUsed: cost };
    }),

  getById: protectedProcedure
    .input(z.object({ comparisonId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [comparison] = await ctx.db
        .select()
        .from(contractComparisons)
        .where(
          and(
            eq(contractComparisons.id, input.comparisonId),
            comparisonFilter(ctx),
          ),
        )
        .limit(1);

      if (!comparison) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comparison not found" });
      }

      const diffs = await ctx.db
        .select()
        .from(contractClauseDiffs)
        .where(eq(contractClauseDiffs.comparisonId, input.comparisonId))
        .orderBy(contractClauseDiffs.sortOrder);

      // Get contract names
      const [contractA] = await ctx.db
        .select({ name: contracts.name })
        .from(contracts)
        .where(eq(contracts.id, comparison.contractAId))
        .limit(1);

      const [contractB] = await ctx.db
        .select({ name: contracts.name })
        .from(contracts)
        .where(eq(contracts.id, comparison.contractBId))
        .limit(1);

      return {
        ...comparison,
        clauseDiffs: diffs,
        contractAName: contractA?.name ?? null,
        contractBName: contractB?.name ?? null,
      };
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const rows = await ctx.db
        .select({
          id: contractComparisons.id,
          status: contractComparisons.status,
          contractAId: contractComparisons.contractAId,
          contractBId: contractComparisons.contractBId,
          createdAt: contractComparisons.createdAt,
          updatedAt: contractComparisons.updatedAt,
        })
        .from(contractComparisons)
        .where(comparisonFilter(ctx))
        .orderBy(desc(contractComparisons.createdAt))
        .limit(limit)
        .offset(offset);

      // Fetch contract names for all comparisons in a single query
      const contractIds = new Set<string>();
      for (const row of rows) {
        contractIds.add(row.contractAId);
        contractIds.add(row.contractBId);
      }

      const contractNames = new Map<string, string>();
      if (contractIds.size > 0) {
        const contractRows = await ctx.db
          .select({ id: contracts.id, name: contracts.name })
          .from(contracts)
          .where(inArray(contracts.id, [...contractIds]));
        for (const c of contractRows) {
          contractNames.set(c.id, c.name);
        }
      }

      return rows.map((row) => ({
        ...row,
        contractAName: contractNames.get(row.contractAId) ?? null,
        contractBName: contractNames.get(row.contractBId) ?? null,
      }));
    }),

  delete: protectedProcedure
    .input(z.object({ comparisonId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [comparison] = await ctx.db
        .select({ id: contractComparisons.id })
        .from(contractComparisons)
        .where(
          and(
            eq(contractComparisons.id, input.comparisonId),
            comparisonFilter(ctx),
          ),
        )
        .limit(1);

      if (!comparison) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comparison not found" });
      }

      await ctx.db
        .delete(contractComparisons)
        .where(eq(contractComparisons.id, input.comparisonId));

      return { success: true };
    }),
});
