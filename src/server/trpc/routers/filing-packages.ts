import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { caseFilingPackageExhibits } from "@/server/db/schema/case-filing-package-exhibits";
import { caseMotions } from "@/server/db/schema/case-motions";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { cases } from "@/server/db/schema/cases";
import { db } from "@/server/db";

type LoadCtx = {
  db: typeof db;
  user: { id: string; orgId: string | null };
};

async function loadPackage(ctx: LoadCtx, packageId: string) {
  if (!ctx.user.orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Requires organization context",
    });
  }
  const rows = await ctx.db
    .select()
    .from(caseFilingPackages)
    .where(
      and(
        eq(caseFilingPackages.id, packageId),
        eq(caseFilingPackages.orgId, ctx.user.orgId),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
  }
  return rows[0];
}

export const filingPackagesRouter = router({
  listForMotion: protectedProcedure
    .input(z.object({ motionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.orgId) return [];
      return ctx.db
        .select()
        .from(caseFilingPackages)
        .where(
          and(
            eq(caseFilingPackages.motionId, input.motionId),
            eq(caseFilingPackages.orgId, ctx.user.orgId),
          ),
        )
        .orderBy(desc(caseFilingPackages.createdAt));
    }),

  get: protectedProcedure
    .input(z.object({ packageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      const exhibits = await ctx.db
        .select()
        .from(caseFilingPackageExhibits)
        .where(eq(caseFilingPackageExhibits.packageId, pkg.id))
        .orderBy(asc(caseFilingPackageExhibits.displayOrder));
      return { ...pkg, exhibits };
    }),

  create: protectedProcedure
    .input(z.object({ motionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.orgId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const motionRows = await ctx.db
        .select()
        .from(caseMotions)
        .where(
          and(
            eq(caseMotions.id, input.motionId),
            eq(caseMotions.orgId, ctx.user.orgId),
          ),
        )
        .limit(1);
      const motion = motionRows[0];
      if (!motion) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
      }
      if (motion.status !== "filed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Motion must be filed before building a package",
        });
      }

      const tplRows = await ctx.db
        .select()
        .from(motionTemplates)
        .where(eq(motionTemplates.id, motion.templateId))
        .limit(1);
      const tpl = tplRows[0]!;

      const caseRows = await ctx.db
        .select()
        .from(cases)
        .where(eq(cases.id, motion.caseId))
        .limit(1);
      if (!caseRows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      const coverSheetData = motion.caption;
      const title = `${motion.title} — Filing Package`;

      const inserted = await ctx.db
        .insert(caseFilingPackages)
        .values({
          orgId: ctx.user.orgId,
          caseId: motion.caseId,
          motionId: motion.id,
          title,
          status: "draft",
          proposedOrderText: `Upon consideration of Defendant's ${tpl.name} and the papers submitted therewith, IT IS HEREBY ORDERED that the Motion is GRANTED.`,
          coverSheetData,
          createdBy: ctx.user.id,
        })
        .returning();
      return inserted[0];
    }),
});
