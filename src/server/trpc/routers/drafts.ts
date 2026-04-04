import { z } from "zod/v4";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { contractDrafts, draftClauses } from "../../db/schema/contract-drafts";
import { contracts } from "../../db/schema/contracts";
import { cases } from "../../db/schema/cases";
import { checkCredits, decrementCredits, refundCredits } from "../../services/credits";
import { rewriteClause } from "../../services/contract-generate";
import { inngest } from "../../inngest/client";
import {
  AUTO_DELETE_DAYS,
  CONTRACT_REVIEW_CREDITS,
  CONTRACT_TYPES,
  GENERATION_CREDITS,
} from "@/lib/constants";

export const draftsRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        contractType: z.enum(CONTRACT_TYPES),
        partyA: z.string().min(1).max(500),
        partyARole: z.string().max(200).optional(),
        partyB: z.string().min(1).max(500),
        partyBRole: z.string().max(200).optional(),
        jurisdiction: z.string().optional(),
        keyTerms: z.string().max(5000).optional(),
        specialInstructions: z.string().max(5000).optional(),
        linkedCaseId: z.string().uuid().optional(),
        referenceContractId: z.string().uuid().optional(),
        referenceS3Key: z.string().optional(),
        referenceFilename: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cost = GENERATION_CREDITS;
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

      const plan = ctx.user.plan ?? "trial";
      const deleteDays = AUTO_DELETE_DAYS[plan as keyof typeof AUTO_DELETE_DAYS] ?? 30;
      const deleteAt = new Date(Date.now() + deleteDays * 24 * 60 * 60 * 1000);

      const [created] = await ctx.db
        .insert(contractDrafts)
        .values({
          userId: ctx.user.id,
          orgId: ctx.user.orgId,
          name: input.name,
          contractType: input.contractType,
          partyA: input.partyA,
          partyARole: input.partyARole ?? "Client",
          partyB: input.partyB,
          partyBRole: input.partyBRole ?? "Counterparty",
          jurisdiction: input.jurisdiction ?? null,
          keyTerms: input.keyTerms ?? null,
          specialInstructions: input.specialInstructions ?? null,
          linkedCaseId: input.linkedCaseId ?? null,
          referenceContractId: input.referenceContractId ?? null,
          referenceS3Key: input.referenceS3Key ?? null,
          referenceFilename: input.referenceFilename ?? null,
          creditsConsumed: cost,
          deleteAt,
        })
        .returning();

      try {
        await inngest.send({
          name: "contract/generate",
          data: { draftId: created.id, userId: ctx.user.id },
        });
      } catch {
        await refundCredits(ctx.user.id, cost);
        await ctx.db.delete(contractDrafts).where(eq(contractDrafts.id, created.id));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to start generation. Credits have been refunded.",
        });
      }

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
          id: contractDrafts.id,
          name: contractDrafts.name,
          status: contractDrafts.status,
          contractType: contractDrafts.contractType,
          createdAt: contractDrafts.createdAt,
          updatedAt: contractDrafts.updatedAt,
        })
        .from(contractDrafts)
        .where(eq(contractDrafts.userId, ctx.user.id))
        .orderBy(desc(contractDrafts.createdAt))
        .limit(limit)
        .offset(offset);

      return rows;
    }),

  getById: protectedProcedure
    .input(z.object({ draftId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [draft] = await ctx.db
        .select()
        .from(contractDrafts)
        .where(and(eq(contractDrafts.id, input.draftId), eq(contractDrafts.userId, ctx.user.id)))
        .limit(1);

      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }

      const clauses = await ctx.db
        .select()
        .from(draftClauses)
        .where(eq(draftClauses.draftId, input.draftId))
        .orderBy(draftClauses.sortOrder);

      let linkedCaseName: string | null = null;
      if (draft.linkedCaseId) {
        const [linkedCase] = await ctx.db
          .select({ name: cases.name })
          .from(cases)
          .where(eq(cases.id, draft.linkedCaseId))
          .limit(1);
        linkedCaseName = linkedCase?.name ?? null;
      }

      return { ...draft, clauses, linkedCaseName };
    }),

  regenerate: protectedProcedure
    .input(z.object({ draftId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [draft] = await ctx.db
        .select()
        .from(contractDrafts)
        .where(and(eq(contractDrafts.id, input.draftId), eq(contractDrafts.userId, ctx.user.id)))
        .limit(1);

      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }

      const cost = GENERATION_CREDITS;
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

      // Delete existing clauses and reset draft
      await ctx.db.delete(draftClauses).where(eq(draftClauses.draftId, input.draftId));
      await ctx.db
        .update(contractDrafts)
        .set({
          status: "draft",
          generatedText: null,
          updatedAt: new Date(),
          creditsConsumed: (draft.creditsConsumed ?? 0) + cost,
        })
        .where(eq(contractDrafts.id, input.draftId));

      try {
        await inngest.send({
          name: "contract/generate",
          data: { draftId: input.draftId, userId: ctx.user.id },
        });
      } catch {
        await refundCredits(ctx.user.id, cost);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to start regeneration. Credits have been refunded.",
        });
      }

      return { creditsUsed: cost };
    }),

  updateClause: protectedProcedure
    .input(
      z.object({
        clauseId: z.string().uuid(),
        userEditedText: z.string().min(1).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Get clause -> draft -> verify ownership
      const [clause] = await ctx.db
        .select({ draftId: draftClauses.draftId })
        .from(draftClauses)
        .where(eq(draftClauses.id, input.clauseId))
        .limit(1);

      if (!clause) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Clause not found" });
      }

      const [draft] = await ctx.db
        .select({ id: contractDrafts.id })
        .from(contractDrafts)
        .where(and(eq(contractDrafts.id, clause.draftId), eq(contractDrafts.userId, ctx.user.id)))
        .limit(1);

      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }

      const [updated] = await ctx.db
        .update(draftClauses)
        .set({ userEditedText: input.userEditedText })
        .where(eq(draftClauses.id, input.clauseId))
        .returning();

      await ctx.db
        .update(contractDrafts)
        .set({ updatedAt: new Date() })
        .where(eq(contractDrafts.id, clause.draftId));

      return updated;
    }),

  rewriteClause: protectedProcedure
    .input(
      z.object({
        clauseId: z.string().uuid(),
        instruction: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [clause] = await ctx.db
        .select()
        .from(draftClauses)
        .where(eq(draftClauses.id, input.clauseId))
        .limit(1);

      if (!clause) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Clause not found" });
      }

      const [draft] = await ctx.db
        .select()
        .from(contractDrafts)
        .where(and(eq(contractDrafts.id, clause.draftId), eq(contractDrafts.userId, ctx.user.id)))
        .limit(1);

      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }

      // Build contract context for coherence
      const allClauses = await ctx.db
        .select()
        .from(draftClauses)
        .where(eq(draftClauses.draftId, clause.draftId))
        .orderBy(draftClauses.sortOrder);

      const contractContext = allClauses
        .map((c) => `[${c.clauseNumber}] ${c.title}: ${c.userEditedText ?? c.generatedText}`)
        .join("\n\n");

      const currentText = clause.userEditedText ?? clause.generatedText ?? "";
      const result = await rewriteClause(currentText, input.instruction, contractContext, draft.jurisdiction);

      return { text: result.text };
    }),

  sendToReview: protectedProcedure
    .input(z.object({ draftId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [draft] = await ctx.db
        .select()
        .from(contractDrafts)
        .where(and(eq(contractDrafts.id, input.draftId), eq(contractDrafts.userId, ctx.user.id)))
        .limit(1);

      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }

      if (draft.status !== "ready") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Draft must be ready before sending to review.",
        });
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

      // Assemble final text from clauses
      const allClauses = await ctx.db
        .select()
        .from(draftClauses)
        .where(eq(draftClauses.draftId, input.draftId))
        .orderBy(draftClauses.sortOrder);

      const assembledText = allClauses
        .map((c) => `${c.clauseNumber}. ${c.title}\n\n${c.userEditedText ?? c.generatedText}`)
        .join("\n\n");

      const plan = ctx.user.plan ?? "trial";
      const deleteDays = AUTO_DELETE_DAYS[plan as keyof typeof AUTO_DELETE_DAYS] ?? 30;
      const deleteAt = new Date(Date.now() + deleteDays * 24 * 60 * 60 * 1000);

      // Create a contracts record for review
      const [contract] = await ctx.db
        .insert(contracts)
        .values({
          userId: ctx.user.id,
          orgId: ctx.user.orgId,
          name: draft.name,
          s3Key: `generated/${input.draftId}.txt`,
          filename: `${draft.name}.txt`,
          fileType: "txt",
          extractedText: assembledText,
          overrideContractType: draft.contractType,
          linkedCaseId: draft.linkedCaseId,
          status: "analyzing",
          creditsConsumed: cost,
          deleteAt,
        })
        .returning();

      try {
        await inngest.send({
          name: "contract/analyze",
          data: { contractId: contract.id },
        });
      } catch {
        await refundCredits(ctx.user.id, cost);
        await ctx.db.delete(contracts).where(eq(contracts.id, contract.id));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to start review. Credits have been refunded.",
        });
      }

      return { contractId: contract.id };
    }),

  delete: protectedProcedure
    .input(z.object({ draftId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [draft] = await ctx.db
        .select({ id: contractDrafts.id })
        .from(contractDrafts)
        .where(and(eq(contractDrafts.id, input.draftId), eq(contractDrafts.userId, ctx.user.id)))
        .limit(1);

      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }

      await ctx.db
        .delete(contractDrafts)
        .where(and(eq(contractDrafts.id, input.draftId), eq(contractDrafts.userId, ctx.user.id)));

      return { success: true };
    }),
});
