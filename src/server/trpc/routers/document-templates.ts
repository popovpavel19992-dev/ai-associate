// src/server/trpc/routers/document-templates.ts
//
// Phase 3.12 — tRPC surface for the firm document templates engine.
// Mounted at appRouter.documentTemplates.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import * as svc from "@/server/services/document-templates/service";
import { customizeDocument } from "@/server/services/document-templates/ai-customize";
import type { DocumentTemplateCategory, VariableDef } from "@/server/db/schema/document-templates";

const CATEGORY_VALUES = [
  "retainer", "engagement", "fee_agreement", "nda", "conflict_waiver",
  "termination", "demand", "settlement", "authorization", "other",
] as const;

const variableDefSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_.\-]+$/, "Invalid key").min(1).max(80),
  label: z.string().min(1).max(200),
  type: z.enum(["text", "textarea", "date", "currency", "number", "select"]),
  required: z.boolean(),
  defaultValue: z.string().max(2000).optional(),
  options: z.array(z.string().min(1).max(200)).optional(),
  helpText: z.string().max(500).optional(),
});

function requireOrg(ctx: { user: { orgId: string | null } }): string {
  if (!ctx.user.orgId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Organization required" });
  }
  return ctx.user.orgId;
}

export const documentTemplatesRouter = router({
  templates: router({
    list: protectedProcedure
      .input(z.object({ category: z.enum(CATEGORY_VALUES).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.listLibraryTemplates(ctx.db, orgId, input?.category as DocumentTemplateCategory | undefined);
      }),

    get: protectedProcedure
      .input(z.object({ templateId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        const tpl = await svc.getTemplate(ctx.db, input.templateId);
        if (tpl.orgId !== null && tpl.orgId !== orgId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Template not in your org" });
        }
        return tpl;
      }),

    create: protectedProcedure
      .input(z.object({
        category: z.enum(CATEGORY_VALUES),
        name: z.string().trim().min(1).max(200),
        description: z.string().max(2000).optional(),
        body: z.string().min(1).max(50000),
        variables: z.array(variableDefSchema).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.createTemplate(ctx.db, {
          orgId,
          category: input.category,
          name: input.name,
          description: input.description ?? null,
          body: input.body,
          variables: input.variables as VariableDef[],
        });
      }),

    update: protectedProcedure
      .input(z.object({
        templateId: z.string().uuid(),
        category: z.enum(CATEGORY_VALUES).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        body: z.string().min(1).max(50000).optional(),
        variables: z.array(variableDefSchema).optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.updateTemplate(ctx.db, {
          templateId: input.templateId,
          orgId,
          patch: {
            category: input.category,
            name: input.name,
            description: input.description,
            body: input.body,
            variables: input.variables as VariableDef[] | undefined,
            isActive: input.isActive,
          },
        });
      }),

    delete: protectedProcedure
      .input(z.object({ templateId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.deleteTemplate(ctx.db, { templateId: input.templateId, orgId });
      }),

    autoFill: protectedProcedure
      .input(z.object({
        templateId: z.string().uuid(),
        caseId: z.string().uuid().nullable().optional(),
        clientId: z.string().uuid().nullable().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.buildAutoFill(ctx.db, {
          orgId,
          templateId: input.templateId,
          caseId: input.caseId ?? null,
          clientId: input.clientId ?? null,
        });
      }),
  }),

  documents: router({
    generate: protectedProcedure
      .input(z.object({
        templateId: z.string().uuid(),
        caseId: z.string().uuid().nullable().optional(),
        clientId: z.string().uuid().nullable().optional(),
        title: z.string().trim().max(300).optional(),
        variableValues: z.record(z.string(), z.string()),
      }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.generateFromTemplate(ctx.db, {
          orgId,
          templateId: input.templateId,
          caseId: input.caseId ?? null,
          clientId: input.clientId ?? null,
          title: input.title,
          variableValues: input.variableValues,
          createdBy: ctx.user.id,
        });
      }),

    update: protectedProcedure
      .input(z.object({
        docId: z.string().uuid(),
        title: z.string().trim().max(300).optional(),
        body: z.string().max(80000).optional(),
        variableValues: z.record(z.string(), z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.updateGeneratedDoc(ctx.db, {
          orgId,
          docId: input.docId,
          patch: {
            title: input.title,
            body: input.body,
            variableValues: input.variableValues,
          },
        });
      }),

    finalize: protectedProcedure
      .input(z.object({ docId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.finalizeGeneratedDoc(ctx.db, { orgId, docId: input.docId });
      }),

    markSent: protectedProcedure
      .input(z.object({ docId: z.string().uuid(), sentAt: z.date().optional() }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.markSent(ctx.db, { orgId, docId: input.docId, sentAt: input.sentAt ?? null });
      }),

    supersede: protectedProcedure
      .input(z.object({ docId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.supersedeGeneratedDoc(ctx.db, { orgId, docId: input.docId });
      }),

    listForCase: protectedProcedure
      .input(z.object({ caseId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.listForCase(ctx.db, { orgId, caseId: input.caseId });
      }),

    listForClient: protectedProcedure
      .input(z.object({ clientId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.listForClient(ctx.db, { orgId, clientId: input.clientId });
      }),

    get: protectedProcedure
      .input(z.object({ docId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        return svc.getDocForOrg(ctx.db, { orgId, docId: input.docId });
      }),

    customize: protectedProcedure
      .input(z.object({
        docId: z.string().uuid(),
        customizationRequest: z.string().trim().min(3).max(4000),
      }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        const doc = await svc.getDocForOrg(ctx.db, { orgId, docId: input.docId });
        if (doc.status !== "draft") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only drafts can be customized" });
        }
        const tpl = doc.templateId
          ? await svc.getTemplate(ctx.db, doc.templateId).catch(() => null)
          : null;
        const suggestion = await customizeDocument({
          templateBody: doc.body,
          variableValues: doc.variablesFilled,
          customizationRequest: input.customizationRequest,
          caseFacts: undefined,
        });
        return { suggestion, templateName: tpl?.name ?? null };
      }),
  }),
});

export type DocumentTemplatesRouter = typeof documentTemplatesRouter;
