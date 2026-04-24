import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { caseFilingPackageExhibits } from "@/server/db/schema/case-filing-package-exhibits";
import { caseMotions } from "@/server/db/schema/case-motions";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { cases } from "@/server/db/schema/cases";
import { documents } from "@/server/db/schema/documents";
import { db } from "@/server/db";

function labelFor(order: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return order < letters.length ? letters[order]! : `AA${order - letters.length}`;
}

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

  addExhibits: protectedProcedure
    .input(
      z.object({
        packageId: z.string().uuid(),
        caseDocumentIds: z.array(z.string().uuid()).default([]),
        adHocUploads: z
          .array(
            z.object({
              s3Key: z.string().min(1),
              originalFilename: z.string().min(1),
              mimeType: z.string().min(1),
            }),
          )
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Package is finalized; delete and recreate to edit.",
        });
      }

      const currentMax = await ctx.db
        .select({ n: caseFilingPackageExhibits.displayOrder })
        .from(caseFilingPackageExhibits)
        .where(eq(caseFilingPackageExhibits.packageId, pkg.id))
        .orderBy(desc(caseFilingPackageExhibits.displayOrder))
        .limit(1);
      let nextOrder = (currentMax[0]?.n ?? -1) + 1;

      const rows: (typeof caseFilingPackageExhibits.$inferInsert)[] = [];

      if (input.caseDocumentIds.length) {
        const docs = await ctx.db
          .select()
          .from(documents)
          .where(
            and(
              inArray(documents.id, input.caseDocumentIds),
              eq(documents.caseId, pkg.caseId),
            ),
          );
        for (const d of docs) {
          rows.push({
            packageId: pkg.id,
            label: labelFor(nextOrder),
            displayOrder: nextOrder,
            sourceType: "case_document",
            documentId: d.id,
            originalFilename: d.filename,
            mimeType:
              d.fileType === "pdf"
                ? "application/pdf"
                : d.fileType === "docx"
                  ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  : "image/png",
          });
          nextOrder++;
        }
      }

      for (const up of input.adHocUploads) {
        if (
          up.mimeType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Exhibit "${up.originalFilename}" is a DOCX file. Convert to PDF before adding as an exhibit.`,
          });
        }
        rows.push({
          packageId: pkg.id,
          label: labelFor(nextOrder),
          displayOrder: nextOrder,
          sourceType: "ad_hoc_upload",
          adHocS3Key: up.s3Key,
          originalFilename: up.originalFilename,
          mimeType: up.mimeType,
        });
        nextOrder++;
      }

      if (rows.length) {
        await ctx.db.insert(caseFilingPackageExhibits).values(rows);
      }
      return { added: rows.length };
    }),

  reorderExhibits: protectedProcedure
    .input(
      z.object({
        packageId: z.string().uuid(),
        exhibitIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      for (let i = 0; i < input.exhibitIds.length; i++) {
        await ctx.db
          .update(caseFilingPackageExhibits)
          .set({ displayOrder: i })
          .where(
            and(
              eq(caseFilingPackageExhibits.id, input.exhibitIds[i]!),
              eq(caseFilingPackageExhibits.packageId, pkg.id),
            ),
          );
      }
      return { ok: true };
    }),

  updateExhibitLabel: protectedProcedure
    .input(
      z.object({
        exhibitId: z.string().uuid(),
        packageId: z.string().uuid(),
        label: z.string().min(1).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .update(caseFilingPackageExhibits)
        .set({ label: input.label })
        .where(
          and(
            eq(caseFilingPackageExhibits.id, input.exhibitId),
            eq(caseFilingPackageExhibits.packageId, pkg.id),
          ),
        );
      return { ok: true };
    }),

  removeExhibit: protectedProcedure
    .input(
      z.object({
        exhibitId: z.string().uuid(),
        packageId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .delete(caseFilingPackageExhibits)
        .where(
          and(
            eq(caseFilingPackageExhibits.id, input.exhibitId),
            eq(caseFilingPackageExhibits.packageId, pkg.id),
          ),
        );
      return { ok: true };
    }),

  updateProposedOrder: protectedProcedure
    .input(z.object({ packageId: z.string().uuid(), text: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .update(caseFilingPackages)
        .set({ proposedOrderText: input.text, updatedAt: new Date() })
        .where(eq(caseFilingPackages.id, pkg.id));
      return { ok: true };
    }),

  finalize: protectedProcedure
    .input(z.object({ packageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Already finalized",
        });
      }

      const { buildPackagePdf } = await import(
        "@/server/services/packages/build"
      );
      const { putObject } = await import("@/server/services/s3");

      let buffer: Buffer;
      try {
        const result = await buildPackagePdf({ packageId: pkg.id });
        buffer = result.buffer;
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (e as Error).message,
        });
      }

      const slug = "filing-package";
      const today = new Date().toISOString().slice(0, 10);
      const s3Key = `filing-packages/exports/${ctx.user.orgId}/${pkg.caseId}/${pkg.id}/${slug}-${today}.pdf`;
      await putObject(s3Key, buffer, "application/pdf");

      await ctx.db
        .update(caseFilingPackages)
        .set({
          status: "finalized",
          exportedPdfPath: s3Key,
          exportedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(caseFilingPackages.id, pkg.id));

      return { ok: true, s3Key };
    }),

  getDownloadUrl: protectedProcedure
    .input(z.object({ packageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status !== "finalized" || !pkg.exportedPdfPath) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Package not finalized",
        });
      }
      const { generateDownloadUrl } = await import("@/server/services/s3");
      return { url: await generateDownloadUrl(pkg.exportedPdfPath) };
    }),

  delete: protectedProcedure
    .input(z.object({ packageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      const { deleteObject } = await import("@/server/services/s3");
      const adHocKeys = await ctx.db
        .select({ k: caseFilingPackageExhibits.adHocS3Key })
        .from(caseFilingPackageExhibits)
        .where(eq(caseFilingPackageExhibits.packageId, pkg.id));
      for (const row of adHocKeys) {
        if (row.k) await deleteObject(row.k).catch(() => undefined);
      }
      if (pkg.exportedPdfPath) {
        await deleteObject(pkg.exportedPdfPath).catch(() => undefined);
      }
      await ctx.db
        .delete(caseFilingPackages)
        .where(eq(caseFilingPackages.id, pkg.id));
      return { ok: true };
    }),
});
