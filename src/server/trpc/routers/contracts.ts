import { z } from "zod/v4";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { contracts, contractClauses } from "../../db/schema/contracts";
import { cases } from "../../db/schema/cases";
import { checkCredits, decrementCredits, refundCredits } from "../../services/credits";
import { inngest } from "../../inngest/client";
import { AUTO_DELETE_DAYS, CONTRACT_REVIEW_CREDITS, CONTRACT_TYPES } from "@/lib/constants";

export const contractsRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        s3Key: z.string().min(1),
        filename: z.string().min(1),
        fileType: z.string().optional(),
        fileSize: z.number().int().optional(),
        checksum: z.string().optional(),
        contractType: z.enum(CONTRACT_TYPES).optional(),
        linkedCaseId: z.string().uuid().optional(),
        selectedSections: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = ctx.user.plan ?? "trial";
      const deleteDays = AUTO_DELETE_DAYS[plan as keyof typeof AUTO_DELETE_DAYS] ?? 30;
      const deleteAt = new Date(Date.now() + deleteDays * 24 * 60 * 60 * 1000);

      const [created] = await ctx.db
        .insert(contracts)
        .values({
          userId: ctx.user.id,
          orgId: ctx.user.orgId,
          name: input.name,
          s3Key: input.s3Key,
          filename: input.filename,
          fileType: input.fileType ?? null,
          fileSize: input.fileSize ?? null,
          checksumSha256: input.checksum ?? null,
          overrideContractType: input.contractType ?? null,
          linkedCaseId: input.linkedCaseId ?? null,
          selectedSections: input.selectedSections ?? null,
          status: "uploading",
          deleteAt,
        })
        .returning();

      return created;
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
          id: contracts.id,
          name: contracts.name,
          status: contracts.status,
          filename: contracts.filename,
          detectedContractType: contracts.detectedContractType,
          overrideContractType: contracts.overrideContractType,
          riskScore: contracts.riskScore,
          createdAt: contracts.createdAt,
          updatedAt: contracts.updatedAt,
          clauseCount: sql<number>`(SELECT count(*) FROM contract_clauses WHERE contract_id = ${contracts.id})`,
        })
        .from(contracts)
        .where(eq(contracts.userId, ctx.user.id))
        .orderBy(desc(contracts.createdAt))
        .limit(limit)
        .offset(offset);

      return rows;
    }),

  getById: protectedProcedure
    .input(z.object({ contractId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [contract] = await ctx.db
        .select()
        .from(contracts)
        .where(and(eq(contracts.id, input.contractId), eq(contracts.userId, ctx.user.id)))
        .limit(1);

      if (!contract) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      }

      const clauses = await ctx.db
        .select()
        .from(contractClauses)
        .where(eq(contractClauses.contractId, input.contractId))
        .orderBy(contractClauses.sortOrder);

      // Get linked case name if present
      let linkedCaseName: string | null = null;
      if (contract.linkedCaseId) {
        const [linkedCase] = await ctx.db
          .select({ name: cases.name })
          .from(cases)
          .where(eq(cases.id, contract.linkedCaseId))
          .limit(1);
        linkedCaseName = linkedCase?.name ?? null;
      }

      return { ...contract, clauses, linkedCaseName };
    }),

  analyze: protectedProcedure
    .input(z.object({ contractId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [contract] = await ctx.db
        .select()
        .from(contracts)
        .where(and(eq(contracts.id, input.contractId), eq(contracts.userId, ctx.user.id)))
        .limit(1);

      if (!contract) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      }

      const cost = CONTRACT_REVIEW_CREDITS;
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

      try {
        await inngest.send({
          name: "contract/analyze",
          data: { contractId: input.contractId },
        });
      } catch {
        await refundCredits(ctx.user.id, cost);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to start analysis. Credits have been refunded.",
        });
      }

      return { creditsUsed: cost };
    }),

  updateSections: protectedProcedure
    .input(
      z.object({
        contractId: z.string().uuid(),
        selectedSections: z.array(z.string()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [contract] = await ctx.db
        .select()
        .from(contracts)
        .where(and(eq(contracts.id, input.contractId), eq(contracts.userId, ctx.user.id)))
        .limit(1);

      if (!contract) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      }

      if (contract.sectionsLocked) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sections are locked after analysis has started",
        });
      }

      const [updated] = await ctx.db
        .update(contracts)
        .set({ selectedSections: input.selectedSections, updatedAt: new Date() })
        .where(and(eq(contracts.id, input.contractId), eq(contracts.userId, ctx.user.id)))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ contractId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [contract] = await ctx.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(and(eq(contracts.id, input.contractId), eq(contracts.userId, ctx.user.id)))
        .limit(1);

      if (!contract) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      }

      await ctx.db
        .delete(contracts)
        .where(and(eq(contracts.id, input.contractId), eq(contracts.userId, ctx.user.id)));

      return { success: true };
    }),

  linkToCase: protectedProcedure
    .input(z.object({ contractId: z.string().uuid(), caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [contract] = await ctx.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(and(eq(contracts.id, input.contractId), eq(contracts.userId, ctx.user.id)))
        .limit(1);

      if (!contract) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      }

      // Verify case ownership
      const [caseRecord] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      const [updated] = await ctx.db
        .update(contracts)
        .set({ linkedCaseId: input.caseId, updatedAt: new Date() })
        .where(and(eq(contracts.id, input.contractId), eq(contracts.userId, ctx.user.id)))
        .returning();

      return updated;
    }),

  unlinkFromCase: protectedProcedure
    .input(z.object({ contractId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [contract] = await ctx.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(and(eq(contracts.id, input.contractId), eq(contracts.userId, ctx.user.id)))
        .limit(1);

      if (!contract) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      }

      const [updated] = await ctx.db
        .update(contracts)
        .set({ linkedCaseId: null, updatedAt: new Date() })
        .where(and(eq(contracts.id, input.contractId), eq(contracts.userId, ctx.user.id)))
        .returning();

      return updated;
    }),

  exportDocx: protectedProcedure
    .input(z.object({ contractId: z.string().uuid() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "METHOD_NOT_SUPPORTED",
        message: "NOT_IMPLEMENTED: Contract DOCX export is not yet available.",
      });
    }),

  exportText: protectedProcedure
    .input(z.object({ contractId: z.string().uuid() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "METHOD_NOT_SUPPORTED",
        message: "NOT_IMPLEMENTED: Contract text export is not yet available.",
      });
    }),
});
