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
        splitMemo: z.boolean().optional(),
        drafterContextJson: z
          .object({
            chunks: z.array(
              z.object({
                documentId: z.string().uuid(),
                documentTitle: z.string(),
                chunkIndex: z.number().int(),
                content: z.string(),
                similarity: z.number(),
              }),
            ),
            citedEntities: z.array(
              z.object({
                kind: z.enum([
                  "document",
                  "deadline",
                  "filing",
                  "motion",
                  "message",
                ]),
                id: z.string().uuid(),
                excerpt: z.string().optional(),
              }),
            ),
            fromRecommendationId: z.string().uuid(),
            generatedAt: z.string(),
          })
          .optional(),
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
      // 2.4.3b: split-memo can only be requested on templates that opt in.
      if (input.splitMemo && !tpl.supportsMemoSplit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This template does not support a separate Memorandum of Law.",
        });
      }

      const caption = {
        court: caseRow.court ?? "U.S. District Court",
        district: caseRow.district ?? "",
        plaintiff: caseRow.plaintiffName ?? caseRow.name,
        defendant: caseRow.defendantName ?? caseRow.opposingParty ?? "",
        caseNumber: caseRow.caseNumber ?? "",
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
          splitMemo: input.splitMemo ?? false,
          drafterContextJson: input.drafterContextJson ?? null,
          draftedFromRecommendationId:
            input.drafterContextJson?.fromRecommendationId ?? null,
          createdBy: ctx.user.id,
        })
        .returning();
      return inserted;
    }),

  generateSection: protectedProcedure
    .input(
      z.object({
        motionId: z.string().uuid(),
        sectionKey: z.enum(["facts", "argument", "conclusion"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [motion] = await ctx.db
        .select()
        .from(caseMotions)
        .where(eq(caseMotions.id, input.motionId))
        .limit(1);
      if (!motion) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
      await assertCaseAccess(ctx, motion.caseId);
      if (motion.status === "filed")
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot regenerate filed motion" });
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Anthropic API key not configured" });
      }

      const [tpl] = await ctx.db
        .select()
        .from(motionTemplates)
        .where(eq(motionTemplates.id, motion.templateId))
        .limit(1);
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });

      const caseRow = await loadCase(ctx, motion.caseId);

      // research_memos has no `content` column; assemble content from memo sections.
      let attachedMemos: { id: string; title: string; content: string }[] = [];
      if (motion.attachedMemoIds.length > 0) {
        const memoRows = await ctx.db
          .select({ id: researchMemos.id, title: researchMemos.title })
          .from(researchMemos)
          .where(inArray(researchMemos.id, motion.attachedMemoIds));
        const sectionRows = await ctx.db
          .select({
            memoId: researchMemoSections.memoId,
            ord: researchMemoSections.ord,
            content: researchMemoSections.content,
          })
          .from(researchMemoSections)
          .where(inArray(researchMemoSections.memoId, motion.attachedMemoIds));
        const byMemo = new Map<string, { ord: number; content: string }[]>();
        for (const s of sectionRows) {
          const arr = byMemo.get(s.memoId) ?? [];
          arr.push({ ord: s.ord, content: s.content });
          byMemo.set(s.memoId, arr);
        }
        attachedMemos = memoRows.map((m: { id: string; title: string }) => {
          const parts = (byMemo.get(m.id) ?? []).sort((a, b) => a.ord - b.ord).map((s) => s.content);
          return { id: m.id, title: m.title, content: parts.join("\n\n") };
        });
      }

      const { draftMotionSection, NoMemosAttachedError } = await import("@/server/services/motions/draft");
      const drafterCtx = motion.drafterContextJson as
        | {
            chunks?: Array<{
              documentTitle: string;
              chunkIndex: number;
              content: string;
              similarity: number;
            }>;
          }
        | null;
      try {
        const out = await draftMotionSection({
          motionType: tpl.motionType as "motion_to_dismiss" | "motion_for_summary_judgment" | "motion_to_compel",
          sectionKey: input.sectionKey,
          caseFacts: caseRow.description ?? "",
          attachedMemos,
          extraExcerpts: drafterCtx?.chunks ?? undefined,
        });

        const nextSections = {
          ...(motion.sections as Record<string, unknown>),
          [input.sectionKey]: { text: out.text, aiGenerated: true, citations: out.citations },
        };
        await ctx.db
          .update(caseMotions)
          .set({ sections: nextSections, updatedAt: new Date() })
          .where(eq(caseMotions.id, motion.id));
        return { text: out.text, citations: out.citations };
      } catch (e) {
        if (e instanceof NoMemosAttachedError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      }
    }),

  updateSection: protectedProcedure
    .input(
      z.object({
        motionId: z.string().uuid(),
        sectionKey: z.enum(["facts", "argument", "conclusion"]),
        text: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [motion] = await ctx.db
        .select()
        .from(caseMotions)
        .where(eq(caseMotions.id, input.motionId))
        .limit(1);
      if (!motion) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
      await assertCaseAccess(ctx, motion.caseId);
      if (motion.status === "filed")
        throw new TRPCError({ code: "FORBIDDEN", message: "Filed motions are immutable" });

      const existing = (motion.sections as Record<
        string,
        { text: string; aiGenerated: boolean; citations: unknown[] } | undefined
      >)[input.sectionKey];
      const nextSections = {
        ...(motion.sections as Record<string, unknown>),
        [input.sectionKey]: {
          text: input.text,
          aiGenerated: existing?.aiGenerated ?? false,
          citations: existing?.citations ?? [],
        },
      };
      await ctx.db
        .update(caseMotions)
        .set({ sections: nextSections, updatedAt: new Date() })
        .where(eq(caseMotions.id, motion.id));
      return { ok: true as const };
    }),

  updateAttachments: protectedProcedure
    .input(
      z.object({
        motionId: z.string().uuid(),
        memoIds: z.array(z.string().uuid()),
        collectionIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [motion] = await ctx.db
        .select({ caseId: caseMotions.caseId, status: caseMotions.status })
        .from(caseMotions)
        .where(eq(caseMotions.id, input.motionId))
        .limit(1);
      if (!motion) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
      await assertCaseAccess(ctx, motion.caseId);
      if (motion.status === "filed")
        throw new TRPCError({ code: "FORBIDDEN", message: "Filed motions are immutable" });
      await ctx.db
        .update(caseMotions)
        .set({
          attachedMemoIds: input.memoIds,
          attachedCollectionIds: input.collectionIds,
          updatedAt: new Date(),
        })
        .where(eq(caseMotions.id, input.motionId));
      return { ok: true as const };
    }),

  markFiled: protectedProcedure
    .input(
      z.object({
        motionId: z.string().uuid(),
        filedAt: z.string().datetime(),
        createTrigger: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [motion] = await ctx.db
        .select()
        .from(caseMotions)
        .where(eq(caseMotions.id, input.motionId))
        .limit(1);
      if (!motion) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
      await assertCaseAccess(ctx, motion.caseId);
      if (motion.status === "filed")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already filed" });

      // Pre-file validation: block filing until all 3 AI sections are drafted.
      // Why: once filed, sections are immutable (see updateSection / generateSection
      // FORBIDDEN guards). Filing a motion with empty Argument would leave the lawyer
      // unable to draft it — caught during 2.4.3 UAT on 2026-04-24.
      const sections = (motion.sections ?? {}) as Record<string, { text?: string } | undefined>;
      const missing = (["facts", "argument", "conclusion"] as const).filter(
        (k) => !sections[k]?.text?.trim(),
      );
      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot file: section${missing.length > 1 ? "s" : ""} not drafted — ${missing.join(", ")}. Draft all sections before filing.`,
        });
      }

      let triggerEventId: string | null = null;
      if (input.createTrigger) {
        // Load template to get motionType for deadline rule filtering (2.4.2b)
        const [template] = await ctx.db
          .select()
          .from(motionTemplates)
          .where(eq(motionTemplates.id, motion.templateId))
          .limit(1);

        // Reuse 2.4.1's DeadlinesService — it inserts the trigger event AND
        // applies matching deadline rules in one call.
        const { DeadlinesService } = await import("@/server/services/deadlines/service");
        const svc = new DeadlinesService({ db: ctx.db });
        const result = await svc.createTriggerEvent({
          caseId: motion.caseId,
          triggerEvent: "motion_filed",
          eventDate: new Date(input.filedAt).toISOString().slice(0, 10),
          jurisdiction: "FRCP",
          notes: `Auto-created from motion: ${motion.title}`,
          createdBy: ctx.user.id,
          motionType: template?.motionType,
        });
        triggerEventId = result.triggerEventId;
      }

      await ctx.db
        .update(caseMotions)
        .set({
          status: "filed",
          filedAt: new Date(input.filedAt),
          triggerEventId,
          updatedAt: new Date(),
        })
        .where(eq(caseMotions.id, motion.id));

      return { ok: true as const, triggerEventId };
    }),

  delete: protectedProcedure
    .input(z.object({ motionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ status: caseMotions.status, caseId: caseMotions.caseId })
        .from(caseMotions)
        .where(eq(caseMotions.id, input.motionId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
      await assertCaseAccess(ctx, row.caseId);
      if (row.status === "filed")
        throw new TRPCError({ code: "FORBIDDEN", message: "Filed motions cannot be deleted" });
      await ctx.db.delete(caseMotions).where(eq(caseMotions.id, input.motionId));
      return { ok: true as const };
    }),
});
