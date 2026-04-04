import { z } from "zod/v4";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { cases } from "../../db/schema/cases";
import { documents } from "../../db/schema/documents";
import { documentAnalyses } from "../../db/schema/document-analyses";
import { contracts } from "../../db/schema/contracts";
import { caseStages, stageTaskTemplates, caseEvents } from "../../db/schema/case-stages";
import { calculateCredits, checkCredits, decrementCredits, refundCredits } from "../../services/credits";
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

      // Auto-set Intake stage
      const resolvedType = input.caseType ?? "general";
      const [intakeStage] = await ctx.db
        .select()
        .from(caseStages)
        .where(and(eq(caseStages.caseType, resolvedType), eq(caseStages.slug, "intake")))
        .limit(1);

      if (intakeStage) {
        await ctx.db
          .update(cases)
          .set({ stageId: intakeStage.id, stageChangedAt: new Date() })
          .where(eq(cases.id, created.id));

        await ctx.db.insert(caseEvents).values({
          caseId: created.id,
          type: "stage_changed",
          title: "Case created",
          metadata: { toStageId: intakeStage.id, toStageName: "Intake" },
          actorId: ctx.user.id,
        });

        created.stageId = intakeStage.id;
        created.stageChangedAt = new Date();
      }

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

      const linkedContracts = await ctx.db
        .select({
          id: contracts.id,
          name: contracts.name,
          status: contracts.status,
          filename: contracts.filename,
          riskScore: contracts.riskScore,
          detectedContractType: contracts.detectedContractType,
          createdAt: contracts.createdAt,
        })
        .from(contracts)
        .where(and(eq(contracts.linkedCaseId, input.caseId), eq(contracts.userId, ctx.user.id)))
        .orderBy(contracts.createdAt);

      const resolvedType = caseRecord.overrideCaseType ?? caseRecord.detectedCaseType ?? "general";

      // Get all stages for this case type (for pipeline bar)
      const stages = await ctx.db
        .select()
        .from(caseStages)
        .where(eq(caseStages.caseType, resolvedType))
        .orderBy(caseStages.sortOrder);

      // Get current stage details
      const currentStage = caseRecord.stageId
        ? stages.find((s) => s.id === caseRecord.stageId) ?? null
        : null;

      // Get recent events (for overview tab)
      const recentEvents = await ctx.db
        .select()
        .from(caseEvents)
        .where(eq(caseEvents.caseId, input.caseId))
        .orderBy(desc(caseEvents.occurredAt))
        .limit(5);

      // Get task templates for current stage
      const stageTaskTemplatesList = currentStage
        ? await ctx.db
            .select()
            .from(stageTaskTemplates)
            .where(eq(stageTaskTemplates.stageId, currentStage.id))
            .orderBy(stageTaskTemplates.sortOrder)
        : [];

      return {
        ...caseRecord,
        documents: docs,
        analyses,
        linkedContracts,
        stage: currentStage,
        stages,
        recentEvents,
        stageTaskTemplates: stageTaskTemplatesList,
      };
    }),

  getStages: protectedProcedure
    .input(z.object({ caseType: z.enum(CASE_TYPES) }))
    .query(async ({ ctx, input }) => {
      const stages = await ctx.db
        .select()
        .from(caseStages)
        .where(eq(caseStages.caseType, input.caseType))
        .orderBy(caseStages.sortOrder);

      const stageIds = stages.map((s) => s.id);

      const tasks =
        stageIds.length > 0
          ? await ctx.db
              .select()
              .from(stageTaskTemplates)
              .where(inArray(stageTaskTemplates.stageId, stageIds))
              .orderBy(stageTaskTemplates.sortOrder)
          : [];

      return stages.map((stage) => ({
        ...stage,
        tasks: tasks.filter((t) => t.stageId === stage.id),
      }));
    }),

  changeStage: protectedProcedure
    .input(z.object({ caseId: z.string().uuid(), stageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [caseRecord] = await ctx.db
        .select()
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      // No-op if already at this stage
      if (caseRecord.stageId === input.stageId) {
        return caseRecord;
      }

      const resolvedType = caseRecord.overrideCaseType ?? caseRecord.detectedCaseType ?? "general";

      // Verify stage belongs to correct case type
      const [newStage] = await ctx.db
        .select()
        .from(caseStages)
        .where(and(eq(caseStages.id, input.stageId), eq(caseStages.caseType, resolvedType)))
        .limit(1);

      if (!newStage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Stage does not belong to this case type",
        });
      }

      // Get current stage name for event metadata
      let fromStageName: string | null = null;
      if (caseRecord.stageId) {
        const [fromStage] = await ctx.db
          .select({ name: caseStages.name })
          .from(caseStages)
          .where(eq(caseStages.id, caseRecord.stageId))
          .limit(1);
        fromStageName = fromStage?.name ?? null;
      }

      // Atomic: update case + insert event
      const result = await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(cases)
          .set({
            stageId: input.stageId,
            stageChangedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(cases.id, input.caseId))
          .returning();

        await tx.insert(caseEvents).values({
          caseId: input.caseId,
          type: "stage_changed",
          title: `Stage changed to ${newStage.name}`,
          metadata: {
            fromStageId: caseRecord.stageId,
            toStageId: input.stageId,
            fromStageName,
            toStageName: newStage.name,
          },
          actorId: ctx.user.id,
        });

        return updated;
      });

      return result;
    }),

  getEvents: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [caseRecord] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      const [countResult] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(caseEvents)
        .where(eq(caseEvents.caseId, input.caseId));

      const events = await ctx.db
        .select()
        .from(caseEvents)
        .where(eq(caseEvents.caseId, input.caseId))
        .orderBy(desc(caseEvents.occurredAt))
        .limit(input.limit)
        .offset(input.offset);

      return { events, total: Number(countResult?.count ?? 0) };
    }),

  addEvent: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        title: z.string().min(1).max(500),
        description: z.string().max(2000).optional(),
        occurredAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [caseRecord] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      const [event] = await ctx.db
        .insert(caseEvents)
        .values({
          caseId: input.caseId,
          type: "manual",
          title: input.title,
          description: input.description ?? null,
          actorId: ctx.user.id,
          occurredAt: input.occurredAt ?? new Date(),
        })
        .returning();

      return event;
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

      try {
        await inngest.send({
          name: "case/analyze",
          data: { caseId: input.caseId },
        });
      } catch (err) {
        // Refund credits if Inngest dispatch fails
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
        .where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)))
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

      await ctx.db.delete(cases).where(and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)));
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
