import { z } from "zod/v4";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { documents } from "../../db/schema/documents";
import { documentAnalyses } from "../../db/schema/document-analyses";
import { cases } from "../../db/schema/cases";
import { deleteObject } from "../../services/s3";

export const documentsRouter = router({
  confirmUpload: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        filename: z.string().min(1),
        s3Key: z.string().min(1),
        checksumSha256: z.string().min(1),
        fileType: z.enum(["pdf", "docx", "image"]),
        fileSize: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify case belongs to user
      const [caseRecord] = await ctx.db
        .select()
        .from(cases)
        .where(
          and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)),
        )
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      // Check for duplicate checksum within the same case
      const [existing] = await ctx.db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.caseId, input.caseId),
            eq(documents.checksumSha256, input.checksumSha256),
          ),
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This document has already been uploaded to this case.",
        });
      }

      const [doc] = await ctx.db
        .insert(documents)
        .values({
          caseId: input.caseId,
          userId: ctx.user.id,
          filename: input.filename,
          s3Key: input.s3Key,
          checksumSha256: input.checksumSha256,
          fileType: input.fileType,
          fileSize: input.fileSize,
          status: "uploading",
        })
        .returning();

      // If case was already analyzed, mark brief as outdated
      if (caseRecord.status === "ready") {
        await ctx.db
          .update(cases)
          .set({ caseBrief: null, status: "draft" })
          .where(eq(cases.id, input.caseId));
      }

      return doc;
    }),

  listByCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify case ownership
      const [caseRecord] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(
          and(eq(cases.id, input.caseId), eq(cases.userId, ctx.user.id)),
        )
        .limit(1);

      if (!caseRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      return ctx.db
        .select()
        .from(documents)
        .where(eq(documents.caseId, input.caseId))
        .orderBy(documents.createdAt);
    }),

  getById: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, input.documentId),
            eq(documents.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!doc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }

      const [analysis] = await ctx.db
        .select()
        .from(documentAnalyses)
        .where(eq(documentAnalyses.documentId, doc.id))
        .limit(1);

      return { ...doc, analysis: analysis ?? null };
    }),

  moveToCase: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        targetCaseId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, input.documentId),
            eq(documents.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!doc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }

      // Verify target case ownership
      const [targetCase] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(
          and(
            eq(cases.id, input.targetCaseId),
            eq(cases.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!targetCase) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target case not found",
        });
      }

      const oldCaseId = doc.caseId;

      // Move document
      await ctx.db
        .update(documents)
        .set({ caseId: input.targetCaseId })
        .where(eq(documents.id, input.documentId));

      // Move associated analysis
      await ctx.db
        .update(documentAnalyses)
        .set({ caseId: input.targetCaseId })
        .where(eq(documentAnalyses.documentId, input.documentId));

      // Invalidate old case brief
      await ctx.db
        .update(cases)
        .set({ caseBrief: null, status: "draft" })
        .where(eq(cases.id, oldCaseId));

      // Invalidate target case brief too
      await ctx.db
        .update(cases)
        .set({ caseBrief: null, status: "draft" })
        .where(eq(cases.id, input.targetCaseId));

      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, input.documentId),
            eq(documents.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!doc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }

      // Delete from S3
      await deleteObject(doc.s3Key);

      // Delete DB record (cascades to analyses)
      await ctx.db.delete(documents).where(eq(documents.id, input.documentId));

      // Invalidate case brief
      await ctx.db
        .update(cases)
        .set({ caseBrief: null, status: "draft" })
        .where(eq(cases.id, doc.caseId));

      return { success: true };
    }),
});
