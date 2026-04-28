// src/server/trpc/routers/public-intake.ts
//
// Lawyer-side tRPC procedures for public intake templates and submissions.
// The unauthenticated submission endpoint lives at
// /api/public-intake/submit (see src/app/api/public-intake/submit/route.ts).

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { PublicIntakeTemplatesService } from "@/server/services/public-intake/templates-service";
import { PublicIntakeSubmissionsService } from "@/server/services/public-intake/submissions-service";
import type { PublicIntakeStatus } from "@/server/db/schema/public-intake-submissions";

const fieldDefSchema = z.object({
  id: z.string().min(1),
  key: z.string().regex(/^[a-z0-9_]+$/i, "Key must be alphanumeric/underscore").min(1).max(64),
  label: z.string().min(1).max(200),
  type: z.enum(["text", "textarea", "email", "phone", "date", "select", "multiselect", "yes_no", "number"]),
  required: z.boolean(),
  options: z.array(z.string().min(1)).optional(),
  helpText: z.string().max(500).optional(),
  validation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().max(200).optional(),
  }).optional(),
});

function requireOrg(ctx: { user: { orgId: string | null } }): string {
  if (!ctx.user.orgId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "An organization is required for public intake" });
  }
  return ctx.user.orgId;
}

function requireAdmin(ctx: { user: { role: string | null } }) {
  if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only owners or admins can manage intake templates" });
  }
}

export const publicIntakeRouter = router({
  // Returns the current org's slug (used by the editor for public-URL preview).
  myOrgSlug: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.orgId) return { slug: null as string | null };
    const { organizations } = await import("@/server/db/schema/organizations");
    const { eq } = await import("drizzle-orm");
    const [row] = await ctx.db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, ctx.user.orgId))
      .limit(1);
    return { slug: row?.slug ?? null };
  }),

  templates: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const orgId = requireOrg(ctx);
      const svc = new PublicIntakeTemplatesService({ db: ctx.db });
      return svc.listForOrg(orgId);
    }),

    get: protectedProcedure
      .input(z.object({ templateId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        const svc = new PublicIntakeTemplatesService({ db: ctx.db });
        return svc.getTemplate(input.templateId, orgId);
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().trim().min(1).max(200),
        slug: z.string().trim().max(64).optional(),
        description: z.string().max(2000).optional(),
        fields: z.array(fieldDefSchema).default([]),
        caseType: z.string().max(80).optional(),
        thankYouMessage: z.string().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        requireAdmin(ctx);
        const svc = new PublicIntakeTemplatesService({ db: ctx.db });
        return svc.createTemplate({
          orgId,
          createdBy: ctx.user.id,
          name: input.name,
          slug: input.slug,
          description: input.description,
          fields: input.fields,
          caseType: input.caseType,
          thankYouMessage: input.thankYouMessage,
        });
      }),

    update: protectedProcedure
      .input(z.object({
        templateId: z.string().uuid(),
        name: z.string().trim().min(1).max(200).optional(),
        slug: z.string().trim().min(1).max(64).optional(),
        description: z.string().max(2000).nullable().optional(),
        fields: z.array(fieldDefSchema).optional(),
        caseType: z.string().max(80).nullable().optional(),
        thankYouMessage: z.string().max(2000).nullable().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        requireAdmin(ctx);
        const svc = new PublicIntakeTemplatesService({ db: ctx.db });
        return svc.updateTemplate({ ...input, orgId });
      }),

    delete: protectedProcedure
      .input(z.object({ templateId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        requireAdmin(ctx);
        const svc = new PublicIntakeTemplatesService({ db: ctx.db });
        return svc.deleteTemplate({ templateId: input.templateId, orgId });
      }),
  }),

  submissions: router({
    list: protectedProcedure
      .input(z.object({
        templateId: z.string().uuid().optional(),
        status: z.enum(["new", "reviewing", "accepted", "declined", "spam"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        const svc = new PublicIntakeSubmissionsService({ db: ctx.db });
        return svc.listForOrg({ orgId, ...input });
      }),

    get: protectedProcedure
      .input(z.object({ submissionId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        const svc = new PublicIntakeSubmissionsService({ db: ctx.db });
        return svc.getSubmission(input.submissionId, orgId);
      }),

    markReviewing: protectedProcedure
      .input(z.object({ submissionId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        const svc = new PublicIntakeSubmissionsService({ db: ctx.db });
        return svc.markReviewing({ submissionId: input.submissionId, orgId, userId: ctx.user.id });
      }),

    markSpam: protectedProcedure
      .input(z.object({ submissionId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        const svc = new PublicIntakeSubmissionsService({ db: ctx.db });
        return svc.markSpam({ submissionId: input.submissionId, orgId, userId: ctx.user.id });
      }),

    decline: protectedProcedure
      .input(z.object({ submissionId: z.string().uuid(), reason: z.string().max(2000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        const svc = new PublicIntakeSubmissionsService({ db: ctx.db });
        return svc.decline({ submissionId: input.submissionId, orgId, userId: ctx.user.id, reason: input.reason });
      }),

    accept: protectedProcedure
      .input(z.object({ submissionId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const orgId = requireOrg(ctx);
        const svc = new PublicIntakeSubmissionsService({ db: ctx.db });
        return svc.accept({ submissionId: input.submissionId, orgId, userId: ctx.user.id });
      }),

    pendingCount: protectedProcedure.query(async ({ ctx }) => {
      const orgId = ctx.user.orgId;
      if (!orgId) return { count: 0 };
      const svc = new PublicIntakeSubmissionsService({ db: ctx.db });
      const count = await svc.pendingNewCount(orgId);
      return { count };
    }),
  }),
});

export type _PublicIntakeStatusType = PublicIntakeStatus;
