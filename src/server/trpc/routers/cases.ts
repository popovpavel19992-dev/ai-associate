import { z } from "zod/v4";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { cases } from "../../db/schema/cases";
import { documents } from "../../db/schema/documents";
import { documentAnalyses } from "../../db/schema/document-analyses";
import { calculateCredits, checkCredits, decrementCredits } from "../../services/credits";
import { generateDocx, generatePlainTextReport } from "../../services/export";
import { inngest } from "../../inngest/client";
import { CASE_TYPES, AUTO_DELETE_DAYS, CASE_TYPE_LABELS } from "@/lib/constants";
import type { AnalysisOutput } from "@/lib/schemas";

export const casesRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        caseType: z.enum(CASE_TYPES).optional(),
        selectedSections: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = ctx.user.plan ?? "trial";
      const deleteDays = AUTO_DELETE_DAYS[plan as keyof typeof AUTO_DELETE_DAYS] ?? 30;
      const deleteAt = new Date(Date.now() + deleteDays * 24 * 60 * 60 * 1000);

      const [created] = await ctx.db
        .insert(cases)
        .values({
          userId: ctx.user.id,
          orgId: ctx.user.orgId,
          name: input.name,
          overrideCaseType: input.caseType ?? null,
          selectedSections: input.selectedSections ?? null,
          deleteAt,
        })
        .returning();

      return created;
    }),

  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const userCases = await ctx.db
        .select({
          id: cases.id,
          name: cases.name,
          status: cases.status,
          detectedCaseType: cases.detectedCaseType,
          overrideCaseType: cases.overrideCaseType,
          createdAt: cases.createdAt,
          updatedAt: cases.updatedAt,
          docCount: sql<number>`(SELECT count(*) FROM documents WHERE case_id = ${cases.id})`,
        })
        .from(cases)
        .where(eq(cases.userId, ctx.user.id))
        .orderBy(desc(cases.createdAt))
        .limit(limit)
        .offset(offset);

      return userCases;
    }),

  getById: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [caseRecord] = await ctx.db
        .select()
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      const docs = await ctx.db
        .select()
        .from(documents)
        .where(eq(documents.caseId, input.caseId))
        .orderBy(documents.createdAt);

      const analyses = await ctx.db
        .select()
        .from(documentAnalyses)
        .where(eq(documentAnalyses.caseId, input.caseId));

      return { ...caseRecord, documents: docs, analyses };
    }),

  analyze: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [caseRecord] = await ctx.db
        .select()
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      const docs = await ctx.db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.caseId, input.caseId));

      if (docs.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No documents uploaded" });
      }

      const cost = calculateCredits(docs.length);
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

      await inngest.send({
        name: "case/analyze",
        data: { caseId: input.caseId },
      });

      return { creditsUsed: cost };
    }),

  updateSections: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        selectedSections: z.array(z.string()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [caseRecord] = await ctx.db
        .select()
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      if (caseRecord.sectionsLocked) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sections are locked after analysis has started",
        });
      }

      const [updated] = await ctx.db
        .update(cases)
        .set({ selectedSections: input.selectedSections, updatedAt: new Date() })
        .where(eq(cases.id, input.caseId))
        .returning();

      return updated;
    }),

  exportDocx: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const exportData = await buildExportData(ctx, input.caseId);
      const buffer = await generateDocx(exportData);
      return { buffer: buffer.toString("base64") };
    }),

  exportText: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const exportData = await buildExportData(ctx, input.caseId);
      const text = generatePlainTextReport(exportData);
      return { text };
    }),

  delete: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [caseRecord] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      await ctx.db.delete(cases).where(eq(cases.id, input.caseId));
      return { success: true };
    }),
});

// Helper for export procedures
async function buildExportData(
  ctx: { db: typeof import("../../db").db; user: { id: string } },
  caseId: string,
) {
  const [caseRecord] = await ctx.db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.userId, ctx.user.id)))
    .limit(1);

  if (!caseRecord) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
  }

  const docs = await ctx.db
    .select()
    .from(documents)
    .where(eq(documents.caseId, caseId))
    .orderBy(documents.createdAt);

  const analyses = await ctx.db
    .select()
    .from(documentAnalyses)
    .where(eq(documentAnalyses.caseId, caseId));

  const caseType =
    caseRecord.overrideCaseType ?? caseRecord.detectedCaseType ?? "general";

  return {
    caseName: caseRecord.name,
    caseType: CASE_TYPE_LABELS[caseType] ?? caseType,
    caseBrief: caseRecord.caseBrief as AnalysisOutput | null,
    selectedSections: caseRecord.selectedSections,
    documents: docs.map((doc) => {
      const analysis = analyses.find((a) => a.documentId === doc.id);
      return {
        filename: doc.filename,
        sections: (analysis?.sections ?? {}) as AnalysisOutput,
        userEdits: analysis?.userEdits as Record<string, unknown> | null,
      };
    }),
  };
}
