// src/server/trpc/routers/email-templates.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { EmailOutreachService } from "@/server/services/email-outreach/service";

function requireOrgId(ctx: any): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

export const emailTemplatesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const orgId = requireOrgId(ctx);
    const svc = new EmailOutreachService({ db: ctx.db });
    const rows = await svc.listTemplates({ orgId });
    return { templates: rows };
  }),

  get: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const svc = new EmailOutreachService({ db: ctx.db });
      const row = await svc.getTemplate({ templateId: input.templateId });
      if (row.orgId !== orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      return row;
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(200),
      subject: z.string().trim().min(1).max(500),
      bodyMarkdown: z.string().max(50_000),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const svc = new EmailOutreachService({ db: ctx.db });
      return svc.createTemplate({ ...input, orgId, createdBy: ctx.user.id });
    }),

  update: protectedProcedure
    .input(z.object({
      templateId: z.string().uuid(),
      name: z.string().trim().min(1).max(200).optional(),
      subject: z.string().trim().min(1).max(500).optional(),
      bodyMarkdown: z.string().max(50_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const svc = new EmailOutreachService({ db: ctx.db });
      const existing = await svc.getTemplate({ templateId: input.templateId });
      if (existing.orgId !== orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      await svc.updateTemplate(input);
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const svc = new EmailOutreachService({ db: ctx.db });
      const existing = await svc.getTemplate({ templateId: input.templateId });
      if (existing.orgId !== orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      await svc.deleteTemplate({ templateId: input.templateId });
      return { ok: true as const };
    }),
});
