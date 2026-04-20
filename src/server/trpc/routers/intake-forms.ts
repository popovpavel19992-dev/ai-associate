// src/server/trpc/routers/intake-forms.ts
//
// tRPC sub-router for intakeForms.* procedures (Phase 2.3.3 Task 7).
// Lawyer-side procedures for creating, editing, sending, and cancelling intake forms.

import { z } from "zod/v4";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { IntakeFormsService } from "@/server/services/intake-forms/service";
import { formSchemaSchema } from "@/server/services/intake-forms/schema-validation";

export const intakeFormsRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new IntakeFormsService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId, viewerType: "lawyer" });
    }),

  get: protectedProcedure
    .input(z.object({ formId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form, answers } = await svc.getForm({ formId: input.formId });
      await assertCaseAccess(ctx, form.caseId);
      return { form, answers };
    }),

  createDraft: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      description: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new IntakeFormsService({ db: ctx.db });
      return svc.createDraft({ ...input, createdBy: ctx.user.id });
    }),

  updateDraft: protectedProcedure
    .input(z.object({
      formId: z.string().uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      schema: formSchemaSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form } = await svc.getForm({ formId: input.formId });
      await assertCaseAccess(ctx, form.caseId);
      await svc.updateDraft(input);
      return { ok: true as const };
    }),

  send: protectedProcedure
    .input(z.object({ formId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form } = await svc.getForm({ formId: input.formId });
      await assertCaseAccess(ctx, form.caseId);
      await svc.sendForm({ formId: input.formId });
      return { ok: true as const };
    }),

  cancel: protectedProcedure
    .input(z.object({ formId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form } = await svc.getForm({ formId: input.formId });
      await assertCaseAccess(ctx, form.caseId);
      await svc.cancelForm({ formId: input.formId, cancelledBy: ctx.user.id });
      return { ok: true as const };
    }),

  submittedCount: protectedProcedure.query(async ({ ctx }) => {
    const svc = new IntakeFormsService({ db: ctx.db });
    return svc.submittedCount({ userId: ctx.user.id, orgId: ctx.user.orgId ?? null });
  }),
});
