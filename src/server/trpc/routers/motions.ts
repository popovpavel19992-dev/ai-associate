// src/server/trpc/routers/motions.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, eq, desc, or, isNull, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { caseMotions } from "@/server/db/schema/case-motions";
import { cases } from "@/server/db/schema/cases";
import { researchMemos, researchMemoSections } from "@/server/db/schema/research-memos";
import { researchCollections } from "@/server/db/schema/research-collections";

type CaseRow = typeof cases.$inferSelect;

async function loadCase(
  ctx: { db: typeof import("@/server/db").db; user: { id: string; orgId: string | null; role: string | null } },
  caseId: string,
): Promise<CaseRow> {
  await assertCaseAccess(ctx, caseId);
  const [row] = await ctx.db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
  return row;
}

export const motionsRouter = router({
  listTemplates: protectedProcedure.query(async ({ ctx }) => {
    // Global templates (orgId NULL) always visible; org-specific visible to members of that org.
    const where = ctx.user.orgId
      ? and(eq(motionTemplates.active, true), or(isNull(motionTemplates.orgId), eq(motionTemplates.orgId, ctx.user.orgId)))
      : and(eq(motionTemplates.active, true), isNull(motionTemplates.orgId));
    return ctx.db.select().from(motionTemplates).where(where);
  }),

  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return ctx.db
        .select()
        .from(caseMotions)
        .where(eq(caseMotions.caseId, input.caseId))
        .orderBy(desc(caseMotions.createdAt));
    }),

  get: protectedProcedure
    .input(z.object({ motionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(caseMotions)
        .where(eq(caseMotions.id, input.motionId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
      await assertCaseAccess(ctx, row.caseId);
      return row;
    }),

  suggestMemos: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      // research_memos has no org_id; scope via caseId (already access-checked).
      const memos = await ctx.db
        .select({ id: researchMemos.id, title: researchMemos.title, createdAt: researchMemos.createdAt })
        .from(researchMemos)
        .where(and(eq(researchMemos.caseId, input.caseId), isNull(researchMemos.deletedAt)))
        .orderBy(desc(researchMemos.createdAt));
      const collections = await ctx.db
        .select({ id: researchCollections.id, name: researchCollections.name })
        .from(researchCollections)
        .where(and(eq(researchCollections.caseId, input.caseId), isNull(researchCollections.deletedAt)));
      return { memos, collections };
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        templateId: z.string().uuid(),
        title: z.string().min(1).max(200),
        memoIds: z.array(z.string().uuid()).default([]),
        collectionIds: z.array(z.string().uuid()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.orgId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Organization required to create motions" });
      }
      const caseRow = await loadCase(ctx, input.caseId);
      const [tpl] = await ctx.db
        .select()
        .from(motionTemplates)
        .where(eq(motionTemplates.id, input.templateId))
        .limit(1);
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      if (tpl.orgId && tpl.orgId !== ctx.user.orgId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Template not available to this org" });
      }

      // The cases schema does not carry plaintiff/defendant/caseNumber/court fields.
      // Populate a best-effort caption from available columns; UI will let user edit later.
      const caption = {
        court: "U.S. District Court",
        district: "",
        plaintiff: caseRow.name,
        defendant: caseRow.opposingParty ?? "",
        caseNumber: "",
        documentTitle: tpl.name,
      };

      const [inserted] = await ctx.db
        .insert(caseMotions)
        .values({
          orgId: ctx.user.orgId,
          caseId: input.caseId,
          templateId: input.templateId,
          title: input.title,
          status: "draft",
          caption,
          sections: {},
          attachedMemoIds: input.memoIds,
          attachedCollectionIds: input.collectionIds,
          createdBy: ctx.user.id,
        })
        .returning();
      return inserted;
    }),
});
