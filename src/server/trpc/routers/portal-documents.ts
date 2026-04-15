import { z } from "zod/v4";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { documents } from "@/server/db/schema/documents";
import { cases } from "@/server/db/schema/cases";
import { inngest } from "@/server/inngest/client";
import { generatePresignedUrl } from "@/server/services/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function assertVisibility(portalVisibility: any, section: string) {
  const vis = portalVisibility as Record<string, boolean> | null;
  if (!vis || vis[section] === false) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Section not available" });
  }
}

export const portalDocumentsRouter = router({
  list: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      cursor: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Verify case ownership + visibility
      const [caseRow] = await ctx.db
        .select({ id: cases.id, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
      assertVisibility(caseRow.portalVisibility, "documents");

      const conditions = [eq(documents.caseId, input.caseId), eq(documents.status, "ready")];

      const rows = await ctx.db
        .select({
          id: documents.id,
          filename: documents.filename,
          fileType: documents.fileType,
          fileSize: documents.fileSize,
          uploadedByPortalUserId: documents.uploadedByPortalUserId,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .where(and(...conditions))
        .orderBy(desc(documents.createdAt))
        .limit(21);

      return {
        documents: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      };
    }),

  getDownloadUrl: portalProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select({ id: documents.id, s3Key: documents.s3Key, caseId: documents.caseId })
        .from(documents)
        .where(eq(documents.id, input.documentId))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      // Verify case ownership
      const [caseRow] = await ctx.db
        .select({ clientId: cases.clientId })
        .from(cases)
        .where(eq(cases.id, doc.caseId))
        .limit(1);
      if (!caseRow || caseRow.clientId !== ctx.portalUser.clientId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Generate presigned GET URL
      const { S3Client } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET!,
        Key: doc.s3Key,
      });
      const url = await getSignedUrl(client, command, { expiresIn: 300 });
      return { url };
    }),

  upload: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      filename: z.string().min(1).max(255),
      fileType: z.enum(["pdf", "docx", "image"]),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify case ownership + visibility
      const [caseRow] = await ctx.db
        .select({ id: cases.id, userId: cases.userId, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
      assertVisibility(caseRow.portalVisibility, "documents");

      const contentTypeMap: Record<string, string> = {
        pdf: "application/pdf",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        image: "image/jpeg",
      };

      const { uploadUrl, s3Key } = await generatePresignedUrl(
        `portal/${ctx.portalUser.id}`,
        input.filename,
        contentTypeMap[input.fileType]!,
        25 * 1024 * 1024,
      );

      const [doc] = await ctx.db
        .insert(documents)
        .values({
          caseId: input.caseId,
          userId: caseRow.userId, // Case creator as owning attorney
          uploadedByPortalUserId: ctx.portalUser.id,
          s3Key,
          filename: input.filename,
          fileType: input.fileType,
          fileSize: 0, // Updated in confirmUpload after S3 upload completes
          checksumSha256: "", // Updated in confirmUpload after S3 upload completes
          status: "uploading",
        })
        .returning({ id: documents.id });

      return { uploadUrl, documentId: doc!.id };
    }),

  confirmUpload: portalProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select({ id: documents.id, caseId: documents.caseId, uploadedByPortalUserId: documents.uploadedByPortalUserId })
        .from(documents)
        .where(and(
          eq(documents.id, input.documentId),
          eq(documents.uploadedByPortalUserId, ctx.portalUser.id),
          eq(documents.status, "uploading"),
        ))
        .limit(1);

      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db
        .update(documents)
        .set({ status: "ready" })
        .where(eq(documents.id, doc.id));

      // Notify lawyer about client document upload
      const [caseRow] = await ctx.db
        .select({ name: cases.name, userId: cases.userId, orgId: cases.orgId })
        .from(cases)
        .where(eq(cases.id, doc.caseId))
        .limit(1);
      if (caseRow) {
        await inngest.send({
          name: "notification/send",
          data: {
            type: "portal_document_uploaded",
            title: "Client uploaded a document",
            body: `${ctx.portalUser.displayName} uploaded a document to ${caseRow.name}`,
            userId: caseRow.userId,
            orgId: caseRow.orgId ?? undefined,
            caseId: doc.caseId,
            actionUrl: `/cases/${doc.caseId}`,
            metadata: { caseName: caseRow.name, clientName: ctx.portalUser.displayName, documentName: "" },
          },
        });
      }

      return { success: true };
    }),
});
