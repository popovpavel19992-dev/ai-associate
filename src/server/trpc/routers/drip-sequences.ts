// src/server/trpc/routers/drip-sequences.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess, assertClientRead } from "@/server/trpc/lib/permissions";
import * as dripService from "@/server/services/drip-sequences/service";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { emailDripEnrollments } from "@/server/db/schema/email-drip-enrollments";

function requireOrgId(ctx: any): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const STEP_INPUT = z.object({
  templateId: z.string().uuid(),
  delayDays: z.number().int().min(0).max(365),
});

const STEPS_INPUT = z.array(STEP_INPUT).min(1).max(10);

async function assertSequenceInOrg(ctx: any, sequenceId: string, orgId: string) {
  const { sequence } = await dripService.getSequenceWithSteps(ctx.db, orgId, sequenceId);
  return sequence;
}

async function assertContactInOrg(ctx: any, clientContactId: string) {
  const [contact] = await ctx.db
    .select({ id: clientContacts.id, clientId: clientContacts.clientId })
    .from(clientContacts)
    .where(eq(clientContacts.id, clientContactId))
    .limit(1);
  if (!contact) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
  }
  // assertClientRead enforces org/solo scoping.
  await assertClientRead(ctx, contact.clientId);
  return contact;
}

export const dripSequencesRouter = router({
  // ---------- Sequence CRUD ----------
  listSequences: protectedProcedure.query(async ({ ctx }) => {
    const orgId = requireOrgId(ctx);
    return dripService.listSequencesWithStepCount(ctx.db, orgId);
  }),

  getSequence: protectedProcedure
    .input(z.object({ sequenceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      return dripService.getSequenceWithSteps(ctx.db, orgId, input.sequenceId);
    }),

  createSequence: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(1000).optional(),
        steps: STEPS_INPUT,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      return dripService.createSequence(ctx.db, {
        orgId,
        createdBy: ctx.user.id,
        name: input.name,
        description: input.description,
        steps: input.steps,
      });
    }),

  updateSequence: protectedProcedure
    .input(
      z.object({
        sequenceId: z.string().uuid(),
        patch: z.object({
          name: z.string().trim().min(1).max(200).optional(),
          description: z.string().trim().max(1000).optional(),
          isActive: z.boolean().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertSequenceInOrg(ctx, input.sequenceId, orgId);
      await dripService.updateSequence(ctx.db, input.sequenceId, input.patch);
      return { ok: true as const };
    }),

  replaceSteps: protectedProcedure
    .input(
      z.object({
        sequenceId: z.string().uuid(),
        steps: STEPS_INPUT,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertSequenceInOrg(ctx, input.sequenceId, orgId);
      await dripService.replaceSteps(ctx.db, input.sequenceId, input.steps);
      return { ok: true as const };
    }),

  deleteSequence: protectedProcedure
    .input(z.object({ sequenceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertSequenceInOrg(ctx, input.sequenceId, orgId);
      await dripService.deleteSequence(ctx.db, input.sequenceId);
      return { ok: true as const };
    }),

  // ---------- Enrollments ----------
  enrollContact: protectedProcedure
    .input(
      z.object({
        sequenceId: z.string().uuid(),
        clientContactId: z.string().uuid(),
        caseId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertSequenceInOrg(ctx, input.sequenceId, orgId);
      await assertContactInOrg(ctx, input.clientContactId);
      if (input.caseId) {
        await assertCaseAccess(ctx, input.caseId);
      }
      return dripService.enrollContact(ctx.db, {
        sequenceId: input.sequenceId,
        orgId,
        clientContactId: input.clientContactId,
        caseId: input.caseId,
        enrolledBy: ctx.user.id,
      });
    }),

  cancelEnrollment: protectedProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const enrollment = await dripService.getEnrollment(ctx.db, input.enrollmentId);
      if (!enrollment || enrollment.orgId !== orgId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found" });
      }
      await dripService.cancelEnrollment(ctx.db, input.enrollmentId, "manual");
      return { ok: true as const };
    }),

  listEnrollmentsForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertCaseAccess(ctx, input.caseId);
      return dripService.listEnrollmentsForCase(ctx.db, orgId, input.caseId);
    }),

  listEnrollmentsForContact: protectedProcedure
    .input(z.object({ clientContactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      await assertContactInOrg(ctx, input.clientContactId);
      return dripService.listEnrollmentsForContact(ctx.db, orgId, input.clientContactId);
    }),
});

// Re-export the enrollment table reference solely so consumers that need to
// query directly (e.g., sweeper jobs in later waves) don't have to import
// from schema explicitly.
export { emailDripEnrollments };
