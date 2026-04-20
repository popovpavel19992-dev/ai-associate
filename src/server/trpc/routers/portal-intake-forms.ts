// src/server/trpc/routers/portal-intake-forms.ts
//
// Portal-side tRPC sub-router for intakeForms (Phase 2.3.3 Task 8).
// Allows portal users (clients) to list, view, answer, and submit intake
// forms for cases they have access to.

import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { IntakeFormsService } from "@/server/services/intake-forms/service";
import { cases } from "@/server/db/schema/cases";

async function assertPortalCaseAccess(
  ctx: { db: typeof import("@/server/db").db; portalUser: { clientId: string } },
  caseId: string,
): Promise<void> {
  const [caseRow] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.clientId, ctx.portalUser.clientId)))
    .limit(1);
  if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
}

export const portalIntakeFormsRouter = router({
  list: portalProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPortalCaseAccess(ctx, input.caseId);
      const svc = new IntakeFormsService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId, viewerType: "portal" });
    }),

  get: portalProcedure
    .input(z.object({ formId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form, answers } = await svc.getForm({ formId: input.formId });
      await assertPortalCaseAccess(ctx, form.caseId);
      if (form.status === "draft" || form.status === "cancelled") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return { form, answers };
    }),

  saveAnswer: portalProcedure
    .input(z.object({
      formId: z.string().uuid(),
      fieldId: z.string().min(1).max(100),
      value: z.unknown(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form } = await svc.getForm({ formId: input.formId });
      await assertPortalCaseAccess(ctx, form.caseId);
      return svc.saveAnswer(input);
    }),

  submit: portalProcedure
    .input(z.object({ formId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new IntakeFormsService({ db: ctx.db });
      const { form } = await svc.getForm({ formId: input.formId });
      await assertPortalCaseAccess(ctx, form.caseId);
      await svc.submitForm({ formId: input.formId });
      return { ok: true as const };
    }),
});
