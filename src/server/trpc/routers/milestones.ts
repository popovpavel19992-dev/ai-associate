// src/server/trpc/routers/milestones.ts
import { z } from "zod/v4";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { CaseMilestonesService } from "@/server/services/case-milestones/service";

const categorySchema = z.enum([
  "filing",
  "discovery",
  "hearing",
  "settlement",
  "communication",
  "other",
]);

export const milestonesRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new CaseMilestonesService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId, viewerType: "lawyer" });
    }),

  get: protectedProcedure
    .input(z.object({ milestoneId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      return row;
    }),

  createDraft: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      description: z.string().max(5000).nullable().optional(),
      category: categorySchema,
      occurredAt: z.date(),
      documentId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new CaseMilestonesService({ db: ctx.db });
      return svc.createDraft({ ...input, createdBy: ctx.user.id });
    }),

  updateDraft: protectedProcedure
    .input(z.object({
      milestoneId: z.string().uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      category: categorySchema.optional(),
      occurredAt: z.date().optional(),
      documentId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      await svc.updateDraft(input);
      return { ok: true as const };
    }),

  deleteDraft: protectedProcedure
    .input(z.object({ milestoneId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      await svc.deleteDraft(input);
      return { ok: true as const };
    }),

  publish: protectedProcedure
    .input(z.object({ milestoneId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      await svc.publish(input);
      return { ok: true as const };
    }),

  editPublished: protectedProcedure
    .input(z.object({
      milestoneId: z.string().uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      category: categorySchema.optional(),
      occurredAt: z.date().optional(),
      documentId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      await svc.editPublished(input);
      return { ok: true as const };
    }),

  retract: protectedProcedure
    .input(z.object({
      milestoneId: z.string().uuid(),
      reason: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertCaseAccess(ctx, row.caseId);
      await svc.retract({ ...input, retractedBy: ctx.user.id });
      return { ok: true as const };
    }),
});
