// src/server/trpc/routers/case-signatures.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { EsignatureService, type MultiPartySigner, type MultiPartyFormField } from "@/server/services/esignature/service";
import { DropboxSignClient } from "@/server/services/esignature/dropbox-sign-client";
import { getPageCount, getPageSizes } from "@/server/services/esignature/pdf-page-count";
import { getObject, generateDownloadUrl } from "@/server/services/s3";
import { decrypt, encrypt } from "@/server/lib/crypto";
import { organizations } from "@/server/db/schema/organizations";
import { caseSignatureRequests } from "@/server/db/schema/case-signature-requests";
import { caseSignatureRequestSigners } from "@/server/db/schema/case-signature-request-signers";
import { caseSignatureRequestFields } from "@/server/db/schema/case-signature-request-fields";
import { cases } from "@/server/db/schema/cases";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { documents } from "@/server/db/schema/documents";
import { randomUUID } from "crypto";

/**
 * Fallback page size (US Letter, 612 x 792 pt). Only used if the source
 * PDF cannot be parsed for a page's real MediaBox — every normal flow
 * reads the actual size from pdf-lib so legal-size, A4, and mixed-size
 * documents are handled correctly.
 */
const FALLBACK_WIDTH_PT = 612;
const FALLBACK_HEIGHT_PT = 792;

const SIGNER_INPUT_SCHEMA = z
  .object({
    clientContactId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    emailAddress: z.string().email(),
    name: z.string().trim().min(1).max(200),
    order: z.number().int().min(0).optional(),
  })
  .refine((s) => !!(s.clientContactId || s.userId || s.emailAddress), {
    message: "Each signer needs a clientContactId, userId, or emailAddress",
  });

const FORM_FIELD_INPUT_SCHEMA = z.object({
  signerIndex: z.number().int().min(0).max(4),
  fieldType: z.enum(["signature", "date_signed", "text", "initials"]),
  page: z.number().int().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  required: z.boolean().default(true),
});

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
      // Multi-party (2.3.6b) — optional. When supplied, takes precedence
      // over the legacy single-contact + requiresCountersign path.
      signers: z.array(SIGNER_INPUT_SCHEMA).min(1).max(5).optional(),
      signingOrder: z.enum(["parallel", "sequential"]).default("parallel"),
      formFields: z.array(FORM_FIELD_INPUT_SCHEMA).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = buildService(ctx.db);

      // Legacy path — no multi-party payload.
      if (!input.signers || input.signers.length === 0) {
        if (input.formFields && input.formFields.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "formFields requires a signers[] array",
          });
        }
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
      }

      // Multi-party path.
      const signers = input.signers;
      const signingOrder = input.signingOrder;

      // Reject duplicate emails — signer → DB row resolution for form fields
      // is keyed on email (see idByEmail below), so collisions would misroute fields.
      {
        const emails = signers.map((s) => s.emailAddress.toLowerCase());
        if (new Set(emails).size !== emails.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Signers must have unique email addresses",
          });
        }
      }

      // Cross-validation: sequential order coverage must be 0..n-1 and unique.
      if (signingOrder === "sequential" && signers.length > 1) {
        const orders = signers.map((s) => s.order);
        if (orders.some((o) => o === undefined)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Sequential signing requires every signer to have an explicit order",
          });
        }
        const set = new Set(orders as number[]);
        if (set.size !== signers.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Signer orders must be unique" });
        }
        for (let i = 0; i < signers.length; i++) {
          if (!set.has(i)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Signer orders must cover 0..${signers.length - 1}`,
            });
          }
        }
      }

      // Every formFields[i].signerIndex must map to a real signer.
      if (input.formFields) {
        for (const f of input.formFields) {
          if (f.signerIndex >= signers.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `formFields.signerIndex ${f.signerIndex} out of range (signers.length=${signers.length})`,
            });
          }
        }
      }

      // Case scoping: any signer with clientContactId must belong to this case's client.
      const [caseRow] = await ctx.db
        .select({ clientId: cases.clientId })
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .limit(1);
      if (!caseRow?.clientId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Case has no client" });
      }
      for (const s of signers) {
        if (!s.clientContactId) continue;
        const [ct] = await ctx.db
          .select({ id: clientContacts.id, clientId: clientContacts.clientId })
          .from(clientContacts)
          .where(eq(clientContacts.id, s.clientContactId))
          .limit(1);
        if (!ct || ct.clientId !== caseRow.clientId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Signer client contact does not belong to this case",
          });
        }
      }

      // Translate zod → service types. When both clientContactId and userId
      // are present, clientContactId wins (per spec).
      const svcSigners: MultiPartySigner[] = signers.map((s, i) => {
        const clientContactId = s.clientContactId ?? undefined;
        const userId = clientContactId ? undefined : s.userId;
        const role = userId && !clientContactId ? "Lawyer" : "Client";
        return {
          role,
          email: s.emailAddress,
          name: s.name,
          order: signingOrder === "sequential" ? (s.order ?? i) : i,
          clientContactId,
          userId,
        };
      });

      // Convert normalized fractions → PDF points using each page's actual
      // MediaBox size (parsed server-side with pdf-lib). Supports letter,
      // legal, A4, and mixed-size documents. Templates skip this branch
      // because Dropbox Sign templates carry their own field placements.
      let pageSizes: { width: number; height: number }[] | null = null;
      if (input.formFields && input.formFields.length > 0 && input.sourceDocumentId) {
        const [doc] = await ctx.db
          .select({ s3Key: documents.s3Key, caseId: documents.caseId })
          .from(documents)
          .where(eq(documents.id, input.sourceDocumentId))
          .limit(1);
        if (!doc || doc.caseId !== input.caseId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Document not on this case" });
        }
        const pdfBuffer = await fetchS3ToBuffer(doc.s3Key);
        pageSizes = await getPageSizes(pdfBuffer);
        for (const f of input.formFields) {
          if (f.page < 1 || f.page > pageSizes.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `formFields.page ${f.page} out of range (document has ${pageSizes.length} pages)`,
            });
          }
          if (f.x + f.width > 1 + 1e-6 || f.y + f.height > 1 + 1e-6) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Field coordinates exceed page bounds (x+width or y+height > 1)",
            });
          }
        }
      }
      const svcFormFields: MultiPartyFormField[] | undefined = input.formFields?.map((f) => {
        const size = pageSizes?.[f.page - 1];
        const w = size?.width ?? FALLBACK_WIDTH_PT;
        const h = size?.height ?? FALLBACK_HEIGHT_PT;
        return {
          apiId: `f_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          signerIndex: f.signerIndex,
          type: f.fieldType,
          page: f.page,
          x: f.x * w,
          y: f.y * h,
          width: f.width * w,
          height: f.height * h,
          required: f.required,
        };
      });

      const result = await svc.create({
        caseId: input.caseId,
        createdBy: ctx.user.id,
        title: input.title,
        message: input.message,
        requiresCountersign: signers.some((s) => s.userId && !s.clientContactId),
        clientContactId: input.clientContactId,
        lawyerEmail: ctx.user.email,
        lawyerName: ctx.user.name ?? ctx.user.email,
        templateId: input.templateId,
        sourceDocumentId: input.sourceDocumentId,
        testMode: input.testMode,
        signers: svcSigners,
        formFields: svcFormFields,
        signingOrder: signingOrder === "sequential",
      });

      // Persist signingOrder mode on the request row (service leaves column default).
      await ctx.db
        .update(caseSignatureRequests)
        .set({ signingOrder })
        .where(eq(caseSignatureRequests.id, result.requestId));

      // Persist field placements (normalized fractions — the DB schema stores them as fractions).
      if (input.formFields && input.formFields.length > 0) {
        const signerRows = await ctx.db
          .select({ id: caseSignatureRequestSigners.id, email: caseSignatureRequestSigners.email })
          .from(caseSignatureRequestSigners)
          .where(eq(caseSignatureRequestSigners.requestId, result.requestId));
        const idByEmail = new Map(
          signerRows.map((r: { id: string; email: string }) => [r.email.toLowerCase(), r.id]),
        );
        const fieldRows = input.formFields.map((f) => {
          const signerEmail = signers[f.signerIndex].emailAddress.toLowerCase();
          const signerId = idByEmail.get(signerEmail);
          if (!signerId) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Could not resolve signer row for index ${f.signerIndex}`,
            });
          }
          return {
            requestId: result.requestId,
            signerId,
            fieldType: f.fieldType,
            page: f.page,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            required: f.required,
          };
        });
        if (fieldRows.length > 0) {
          await ctx.db.insert(caseSignatureRequestFields).values(fieldRows);
        }
      }

      return result;
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
