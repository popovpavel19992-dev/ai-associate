import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseFilings } from "@/server/db/schema/case-filings";
import { caseMotions } from "@/server/db/schema/case-motions";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { caseMembers } from "@/server/db/schema/case-members";
import { users } from "@/server/db/schema/users";
import { cases } from "@/server/db/schema/cases";
import { inngest } from "@/server/inngest/client";
import { notifyFilingSubmitted } from "@/server/services/filings/notification-hooks";

const METHOD = z.enum(["cm_ecf", "mail", "hand_delivery", "email", "fax"]);

const createInput = z
  .object({
    motionId: z.string().uuid().optional(),
    packageId: z.string().uuid().optional(),
    confirmationNumber: z.string().min(1).max(100),
    court: z.string().min(1).max(100),
    judgeName: z.string().max(100).optional(),
    submissionMethod: METHOD,
    feePaidCents: z.number().int().min(0),
    submittedAt: z.string().datetime(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => v.motionId || v.packageId, {
    message: "Filing must reference either a motion or a package",
  });

export const filingsRouter = router({
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    if (!ctx.user.orgId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
    }

    let caseId: string | null = null;
    if (input.packageId) {
      const [pkg] = await ctx.db
        .select()
        .from(caseFilingPackages)
        .where(eq(caseFilingPackages.id, input.packageId))
        .limit(1);
      if (!pkg) throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
      if (pkg.status !== "finalized") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Filing package must be finalized before submission" });
      }
      caseId = pkg.caseId;
    }
    if (input.motionId) {
      const [motion] = await ctx.db
        .select()
        .from(caseMotions)
        .where(eq(caseMotions.id, input.motionId))
        .limit(1);
      if (!motion) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
      if (motion.status !== "filed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Motion must be marked as filed before submission" });
      }
      if (caseId && caseId !== motion.caseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Motion and package refer to different cases" });
      }
      caseId = motion.caseId;
    }
    if (!caseId) throw new TRPCError({ code: "BAD_REQUEST", message: "Filing must reference a motion or package" });

    await assertCaseAccess(ctx, caseId);

    const duplicates = await ctx.db
      .select({ id: caseFilings.id })
      .from(caseFilings)
      .where(
        and(
          eq(caseFilings.orgId, ctx.user.orgId),
          eq(caseFilings.confirmationNumber, input.confirmationNumber),
          eq(caseFilings.court, input.court),
          eq(caseFilings.status, "submitted"),
        ),
      )
      .limit(1);

    const [inserted] = await ctx.db
      .insert(caseFilings)
      .values({
        orgId: ctx.user.orgId,
        caseId,
        motionId: input.motionId ?? null,
        packageId: input.packageId ?? null,
        confirmationNumber: input.confirmationNumber,
        court: input.court,
        judgeName: input.judgeName ?? null,
        submissionMethod: input.submissionMethod,
        feePaidCents: input.feePaidCents,
        submittedAt: new Date(input.submittedAt),
        submittedBy: ctx.user.id,
        status: "submitted",
        notes: input.notes ?? null,
      })
      .returning();

    // Fan out notifications (best-effort; don't block response on failure).
    try {
      const memberRows = await ctx.db
        .select({ userId: caseMembers.userId })
        .from(caseMembers)
        .where(eq(caseMembers.caseId, caseId));
      const memberIds = memberRows.map((m) => m.userId);
      const [caseRow] = await ctx.db.select({ name: cases.name }).from(cases).where(eq(cases.id, caseId)).limit(1);
      const [submitter] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
      await notifyFilingSubmitted(
        inngest,
        {
          filingId: inserted.id,
          caseId,
          orgId: ctx.user.orgId,
          caseName: caseRow?.name ?? "",
          submitterId: ctx.user.id,
          submitterName: submitter?.name ?? "A team member",
          court: inserted.court,
          confirmationNumber: inserted.confirmationNumber,
        },
        memberIds,
      );
    } catch (e) {
      console.error("Notification dispatch failed for filing", inserted.id, e);
    }

    return {
      filing: inserted,
      warning: duplicates.length > 0 ? "A similar submitted filing exists at this court — double-check confirmation #." : null,
    };
  }),
});

