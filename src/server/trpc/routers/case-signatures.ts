// src/server/trpc/routers/case-signatures.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { EsignatureService } from "@/server/services/esignature/service";
import { DropboxSignClient } from "@/server/services/esignature/dropbox-sign-client";
import { getPageCount } from "@/server/services/esignature/pdf-page-count";
import { getObject, generateDownloadUrl } from "@/server/services/s3";
import { decrypt, encrypt } from "@/server/lib/crypto";
import { organizations } from "@/server/db/schema/organizations";
import { caseSignatureRequests } from "@/server/db/schema/case-signature-requests";
import { documents } from "@/server/db/schema/documents";

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

function buildService(db: any) {
  return new EsignatureService({
    db,
    decryptKey: (enc: string) => decrypt(enc),
    getPageCount,
    fetchS3: fetchS3ToBuffer,
    buildClient: (apiKey: string) => new DropboxSignClient({ apiKey }),
  });
}

function requireOrgId(ctx: any): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

async function orgApiKey(ctx: any): Promise<string> {
  const orgId = requireOrgId(ctx);
  const [org] = await ctx.db
    .select({ key: organizations.hellosignApiKeyEncrypted })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org?.key) throw new TRPCError({ code: "BAD_REQUEST", message: "Dropbox Sign not configured" });
  return decrypt(org.key);
}

export const caseSignaturesRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = buildService(ctx.db);
      const requests = await svc.listForCase({ caseId: input.caseId });
      return { requests };
    }),

  get: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = buildService(ctx.db);
      const req = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, req.caseId);
      return req;
    }),

  create: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      title: z.string().trim().min(1).max(500),
      message: z.string().max(10_000).optional(),
      requiresCountersign: z.boolean().default(true),
      clientContactId: z.string().uuid(),
      templateId: z.string().optional(),
      sourceDocumentId: z.string().uuid().optional(),
      testMode: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = buildService(ctx.db);
      return svc.create({
        caseId: input.caseId,
        createdBy: ctx.user.id,
        title: input.title,
        message: input.message,
        requiresCountersign: input.requiresCountersign,
        clientContactId: input.clientContactId,
        lawyerEmail: ctx.user.email,
        lawyerName: ctx.user.name ?? ctx.user.email,
        templateId: input.templateId,
        sourceDocumentId: input.sourceDocumentId,
        testMode: input.testMode,
      });
    }),

  cancel: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = buildService(ctx.db);
      const req = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, req.caseId);
      const apiKey = await orgApiKey(ctx);
      await svc.cancel({ requestId: input.requestId, apiKey });
      return { ok: true as const };
    }),

  remind: protectedProcedure
    .input(z.object({ requestId: z.string().uuid(), signerEmail: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const svc = buildService(ctx.db);
      const req = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, req.caseId);
      const apiKey = await orgApiKey(ctx);
      await svc.remind({ requestId: input.requestId, signerEmail: input.signerEmail, apiKey });
      return { ok: true as const };
    }),

  listTemplates: protectedProcedure.query(async ({ ctx }) => {
    const apiKey = await orgApiKey(ctx);
    const svc = buildService(ctx.db);
    return svc.listTemplates({ apiKey });
  }),

  testConnection: protectedProcedure
    .input(z.object({ apiKey: z.string().min(10).max(500) }))
    .mutation(async ({ input }) => {
      const svc = buildService(null as any);
      return svc.testConnection({ apiKey: input.apiKey });
    }),

  saveApiKey: protectedProcedure
    .input(z.object({ apiKey: z.string().min(10).max(500), senderName: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const encrypted = encrypt(input.apiKey);
      await ctx.db
        .update(organizations)
        .set({ hellosignApiKeyEncrypted: encrypted, hellosignSenderName: input.senderName ?? null })
        .where(eq(organizations.id, orgId));
      return { ok: true as const };
    }),

  disconnectApiKey: protectedProcedure.mutation(async ({ ctx }) => {
    const orgId = requireOrgId(ctx);
    await ctx.db
      .update(organizations)
      .set({ hellosignApiKeyEncrypted: null, hellosignSenderName: null })
      .where(eq(organizations.id, orgId));
    return { ok: true as const };
  }),

  downloadSigned: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = buildService(ctx.db);
      const req = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, req.caseId);
      if (!req.signedDocumentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not completed" });
      // Fetch the actual s3Key for the signed document
      const [doc] = await ctx.db
        .select({ s3Key: documents.s3Key })
        .from(documents)
        .where(eq(documents.id, req.signedDocumentId))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Signed document missing" });
      const url = await generateDownloadUrl(doc.s3Key);
      return { url };
    }),

  downloadCertificate: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = buildService(ctx.db);
      const req = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, req.caseId);
      if (!req.certificateS3Key) throw new TRPCError({ code: "BAD_REQUEST", message: "No certificate" });
      const url = await generateDownloadUrl(req.certificateS3Key);
      return { url };
    }),
});
