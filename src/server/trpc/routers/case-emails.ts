// src/server/trpc/routers/case-emails.ts
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { EmailOutreachService } from "@/server/services/email-outreach/service";
import { renderEmail } from "@/server/services/email-outreach/render";
import { documents } from "@/server/db/schema/documents";
import { sendEmail } from "@/server/services/email";
import { getObject, copyObject } from "@/server/services/s3";
import { caseEmailReplies } from "@/server/db/schema/case-email-replies";
import { caseEmailReplyAttachments } from "@/server/db/schema/case-email-reply-attachments";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { TRPCError } from "@trpc/server";

async function fetchS3ToBuffer(s3Key: string): Promise<Buffer> {
  const { body } = await getObject(s3Key);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((u) => Buffer.from(u)));
}

async function resendSendAdapter(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: any[];
  replyTo?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
}): Promise<{ id?: string }> {
  // sendEmail does not currently return the Resend id; keep undefined for now.
  await sendEmail({
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
    replyTo: opts.replyTo,
    trackOpens: opts.trackOpens,
    trackClicks: opts.trackClicks,
  });
  return { id: undefined };
}

export const caseEmailsRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new EmailOutreachService({ db: ctx.db });
      const rows = await svc.listForCase({ caseId: input.caseId });
      return { emails: rows };
    }),

  get: protectedProcedure
    .input(z.object({ emailId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new EmailOutreachService({ db: ctx.db });
      const row = await svc.getEmail({ emailId: input.emailId });
      await assertCaseAccess(ctx, row.caseId);
      return row;
    }),

  resolveContext: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new EmailOutreachService({ db: ctx.db });
      const recipient = await svc.resolveRecipient({ caseId: input.caseId });
      const variables = await svc.resolveVariables({ caseId: input.caseId, senderId: ctx.user.id });
      const docs = await ctx.db
        .select({ id: documents.id, filename: documents.filename, fileType: documents.fileType, fileSize: documents.fileSize })
        .from(documents)
        .where(eq(documents.caseId, input.caseId));
      return { recipient, variables, attachableDocuments: docs };
    }),

  previewRender: protectedProcedure
    .input(z.object({
      subject: z.string().max(500),
      bodyMarkdown: z.string().max(50_000),
      variables: z.record(z.string(), z.string()).optional(),
    }))
    .query(({ input }) => {
      return renderEmail({ subject: input.subject, bodyMarkdown: input.bodyMarkdown, variables: input.variables ?? {} });
    }),

  send: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      templateId: z.string().uuid().nullable().optional(),
      subject: z.string().trim().min(1).max(500),
      bodyMarkdown: z.string().min(1).max(50_000),
      documentIds: z.array(z.string().uuid()).max(20),
      trackingEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new EmailOutreachService({
        db: ctx.db,
        resendSend: resendSendAdapter,
        fetchObject: fetchS3ToBuffer,
      });
      return svc.send({
        caseId: input.caseId,
        templateId: input.templateId ?? null,
        subject: input.subject,
        bodyMarkdown: input.bodyMarkdown,
        documentIds: input.documentIds,
        senderId: ctx.user.id,
        trackingEnabled: input.trackingEnabled ?? false,
      });
    }),

  promoteReplyAttachment: protectedProcedure
    .input(z.object({ replyAttachmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [att] = await ctx.db
        .select({ replyId: caseEmailReplyAttachments.replyId })
        .from(caseEmailReplyAttachments)
        .where(eq(caseEmailReplyAttachments.id, input.replyAttachmentId))
        .limit(1);
      if (!att) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
      const [reply] = await ctx.db
        .select({ caseId: caseEmailReplies.caseId })
        .from(caseEmailReplies)
        .where(eq(caseEmailReplies.id, att.replyId))
        .limit(1);
      if (!reply) throw new TRPCError({ code: "NOT_FOUND", message: "Reply not found" });
      await assertCaseAccess(ctx, reply.caseId);
      const svc = new EmailOutreachService({ db: ctx.db });
      return svc.promoteReplyAttachment({
        replyAttachmentId: input.replyAttachmentId,
        uploadedBy: ctx.user.id,
        s3CopyObject: copyObject,
      });
    }),

  markRepliesRead: protectedProcedure
    .input(z.object({ outreachId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [o] = await ctx.db
        .select({ caseId: caseEmailOutreach.caseId })
        .from(caseEmailOutreach)
        .where(eq(caseEmailOutreach.id, input.outreachId))
        .limit(1);
      if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "Email not found" });
      await assertCaseAccess(ctx, o.caseId);
      const svc = new EmailOutreachService({ db: ctx.db });
      await svc.markRepliesRead({ outreachId: input.outreachId });
      return { ok: true as const };
    }),
});
