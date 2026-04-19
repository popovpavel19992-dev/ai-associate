// src/server/trpc/routers/research-memo.ts
//
// tRPC sub-router for research.memo.* procedures (Phase 2.2.3 Task 9).
// Procedures: generate, get, list, updateSection, regenerateSection, delete, retryGenerate.

import { z } from "zod/v4";
import { and, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { getEnv } from "@/lib/env";
import { inngest as defaultInngest } from "@/server/inngest/client";
import { CourtListenerClient } from "@/server/services/courtlistener/client";
import { OpinionCacheService } from "@/server/services/research/opinion-cache";
import { StatuteCacheService } from "@/server/services/research/statute-cache";
import { GovInfoClient } from "@/server/services/govinfo/client";
import { EcfrClient } from "@/server/services/ecfr/client";
import { MemoGenerationService } from "@/server/services/research/memo-generation";
import { UsageGuard, UsageLimitExceededError } from "@/server/services/research/usage-guard";
import { researchMemos, researchMemoSections } from "@/server/db/schema/research-memos";
import { researchSessions } from "@/server/db/schema/research-sessions";
import { opinionBookmarks } from "@/server/db/schema/opinion-bookmarks";
import { researchChatMessages } from "@/server/db/schema/research-chat-messages";
import type { db as realDb } from "@/server/db";

// ---------------------------------------------------------------------------
// Shared enums / zod types
// ---------------------------------------------------------------------------
const SectionTypeSchema = z.enum(["issue", "rule", "application", "conclusion"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert that the requesting user owns the session.
 * Throws NOT_FOUND if session is missing; FORBIDDEN if owned by someone else.
 */
async function assertSessionOwnership(
  db: typeof realDb,
  sessionId: string,
  userId: string,
): Promise<void> {
  const [row] = await db
    .select({ userId: researchSessions.userId })
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  if (row.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not your session" });
  }
}

/**
 * Assert that the requesting user owns the memo (and that it has not been soft-deleted).
 * Throws NOT_FOUND if memo is missing or deleted; FORBIDDEN if owned by someone else.
 */
async function assertMemoOwnership(
  db: typeof realDb,
  memoId: string,
  userId: string,
): Promise<void> {
  const [row] = await db
    .select({ userId: researchMemos.userId, deletedAt: researchMemos.deletedAt })
    .from(researchMemos)
    .where(eq(researchMemos.id, memoId))
    .limit(1);
  if (!row || row.deletedAt !== null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Memo not found" });
  }
  if (row.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not your memo" });
  }
}

/**
 * Collect distinct opinion IDs relevant to the session for use as memo context.
 *
 * NOTE (known limitation): opinionBookmarks has no sessionId column — bookmarks
 * are global per user. This check therefore asserts the user has AT LEAST ONE
 * bookmark anywhere, not specifically within this session. This is a pragmatic
 * MVP proxy; a future migration could add a sessionId FK to opinionBookmarks.
 */
async function collectSessionOpinionIds(
  db: typeof realDb,
  _sessionId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ opinionId: opinionBookmarks.opinionId })
    .from(opinionBookmarks)
    .where(eq(opinionBookmarks.userId, userId));
  return [...new Set(rows.map((r) => r.opinionId))];
}

/**
 * Collect distinct statute IDs from all chat messages in the session.
 * `statuteContextIds` is a per-message JSON array, so this correctly scopes to the session.
 */
async function collectSessionStatuteIds(
  db: typeof realDb,
  sessionId: string,
): Promise<string[]> {
  const rows = await db
    .select({ ids: researchChatMessages.statuteContextIds })
    .from(researchChatMessages)
    .where(eq(researchChatMessages.sessionId, sessionId));
  const all = rows.flatMap((r) => (Array.isArray(r.ids) ? (r.ids as string[]) : []));
  return [...new Set(all)];
}

function mapUserPlanToResearchPlan(
  plan: string | null | undefined,
): "starter" | "professional" | "business" {
  switch (plan) {
    case "trial":
      return "starter";
    case "solo":
      return "professional";
    default:
      return "starter";
  }
}

function makeStatuteCacheService(db: typeof realDb): StatuteCacheService {
  const env = getEnv();
  return new StatuteCacheService({
    db,
    govinfo: new GovInfoClient({ apiKey: env.GOVINFO_API_KEY }),
    ecfr: new EcfrClient(),
  });
}

function makeMemoGenerationService(db: typeof realDb): MemoGenerationService {
  const env = getEnv();
  const cl = new CourtListenerClient({ apiToken: env.COURTLISTENER_API_TOKEN });
  const opinionCache = new OpinionCacheService({ db, courtListener: cl });
  const statuteCache = makeStatuteCacheService(db);
  return new MemoGenerationService({ db, opinionCache, statuteCache });
}

// ---------------------------------------------------------------------------
// researchMemoRouter
// ---------------------------------------------------------------------------
export const researchMemoRouter = router({
  /**
   * generate — creates a memo row (status=generating) and dispatches an Inngest event.
   * The Inngest handler (research-memo-generate.ts) does the actual LLM work.
   */
  generate: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        memoQuestion: z.string().trim().min(1).max(2000).optional(),
        jurisdiction: z
          .enum(["federal", "ca", "ny", "tx", "fl", "il", "other"])
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Assert session ownership.
      await assertSessionOwnership(ctx.db, input.sessionId, ctx.user.id);

      // 2. Validate session has at least one context item.
      const opinionIds = await collectSessionOpinionIds(ctx.db, input.sessionId, ctx.user.id);
      const statuteIds = await collectSessionStatuteIds(ctx.db, input.sessionId);

      if (opinionIds.length === 0 && statuteIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Cannot generate a memo without any bookmarked opinions or statute references. " +
            "Add at least one opinion or statute to your research session first.",
        });
      }

      // 3. Check + increment memo usage quota.
      const plan = mapUserPlanToResearchPlan(ctx.user.plan);
      const guard = new UsageGuard({ db: ctx.db });
      try {
        await guard.checkAndIncrementMemo({ userId: ctx.user.id, plan });
      } catch (err) {
        if (err instanceof UsageLimitExceededError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: err.message,
            cause: err,
          });
        }
        throw err;
      }

      // 4. Build title and question.
      const memoQuestion =
        input.memoQuestion ?? "Analyze the relevant legal issues based on the provided materials.";

      // Derive title from first ~80 chars of question.
      const title =
        memoQuestion.length > 80 ? memoQuestion.slice(0, 77) + "…" : memoQuestion;

      // 5. Insert memo row with status='generating'.
      const [inserted] = await ctx.db
        .insert(researchMemos)
        .values({
          userId: ctx.user.id,
          sessionId: input.sessionId,
          title,
          memoQuestion,
          jurisdiction: input.jurisdiction ?? null,
          status: "generating",
          contextOpinionIds: opinionIds,
          contextStatuteIds: statuteIds,
          creditsCharged: 3,
        })
        .returning();

      const memoId = (inserted as { id: string }).id;

      // 6. Dispatch Inngest event. On failure: mark failed + refund.
      try {
        await defaultInngest.send({
          name: "research/memo.generate.requested",
          data: { memoId },
        });
      } catch (err) {
        // Compensate: mark memo failed so the UI doesn't show a stuck spinner.
        await ctx.db
          .update(researchMemos)
          .set({
            status: "failed",
            errorMessage: err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          })
          .where(eq(researchMemos.id, memoId));
        await guard.refundMemo({ userId: ctx.user.id });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to dispatch memo generation job. Please retry.",
          cause: err,
        });
      }

      return { memoId };
    }),

  /**
   * get — fetch a single memo with all its sections.
   */
  get: protectedProcedure
    .input(z.object({ memoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertMemoOwnership(ctx.db, input.memoId, ctx.user.id);

      const [memo] = await ctx.db
        .select()
        .from(researchMemos)
        .where(eq(researchMemos.id, input.memoId))
        .limit(1);

      if (!memo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Memo not found" });
      }

      const sections = await ctx.db
        .select()
        .from(researchMemoSections)
        .where(eq(researchMemoSections.memoId, input.memoId))
        .orderBy(researchMemoSections.ord);

      return { memo, sections };
    }),

  /**
   * list — paginated list of the user's non-deleted memos, with optional filters.
   */
  list: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid().optional(),
        sessionId: z.string().uuid().optional(),
        status: z.enum(["generating", "ready", "failed"]).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 20;
      const offset = (page - 1) * pageSize;

      // Build where conditions.
      const conditions = [
        eq(researchMemos.userId, ctx.user.id),
        isNull(researchMemos.deletedAt),
      ];
      if (input?.sessionId) {
        conditions.push(eq(researchMemos.sessionId, input.sessionId));
      }
      if (input?.status) {
        conditions.push(eq(researchMemos.status, input.status));
      }
      if (input?.caseId) {
        conditions.push(eq(researchMemos.caseId, input.caseId));
      }

      const memos = await ctx.db
        .select()
        .from(researchMemos)
        .where(and(...conditions))
        .orderBy(desc(researchMemos.updatedAt))
        .limit(pageSize)
        .offset(offset);

      return { memos, page, pageSize };
    }),

  /**
   * updateSection — human-edit a section's content without AI invocation.
   */
  updateSection: protectedProcedure
    .input(
      z.object({
        memoId: z.string().uuid(),
        sectionType: SectionTypeSchema,
        content: z.string().min(1).max(50_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMemoOwnership(ctx.db, input.memoId, ctx.user.id);

      const now = new Date();

      // Update the section content + mark as user-edited.
      await ctx.db
        .update(researchMemoSections)
        .set({ content: input.content, userEditedAt: now, updatedAt: now })
        .where(
          and(
            eq(researchMemoSections.memoId, input.memoId),
            eq(researchMemoSections.sectionType, input.sectionType),
          ),
        );

      // Touch memo's updatedAt so list ordering reflects the edit.
      await ctx.db
        .update(researchMemos)
        .set({ updatedAt: now })
        .where(eq(researchMemos.id, input.memoId));

      return { ok: true as const };
    }),

  /**
   * regenerateSection — streaming subscription that re-runs AI for a single section.
   * Uses the memo's stored contextOpinionIds / contextStatuteIds (snapshot at generate time).
   */
  regenerateSection: protectedProcedure
    .input(
      z.object({
        memoId: z.string().uuid(),
        sectionType: SectionTypeSchema,
        steeringMessage: z.string().max(2000).optional(),
      }),
    )
    .subscription(async function* ({ ctx, input }) {
      await assertMemoOwnership(ctx.db, input.memoId, ctx.user.id);

      // Fetch memo for context snapshot.
      const [memo] = await ctx.db
        .select()
        .from(researchMemos)
        .where(eq(researchMemos.id, input.memoId))
        .limit(1);

      if (!memo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Memo not found" });
      }

      // Build context block from the memo's stored snapshots (NOT current cache).
      const env = getEnv();
      const cl = new CourtListenerClient({ apiToken: env.COURTLISTENER_API_TOKEN });
      const opinionCache = new OpinionCacheService({ db: ctx.db, courtListener: cl });
      const statuteCache = makeStatuteCacheService(ctx.db);

      const opinions = memo.contextOpinionIds.length
        ? await opinionCache.getByInternalIds(memo.contextOpinionIds)
        : [];
      const statutes = memo.contextStatuteIds.length
        ? await statuteCache.getByInternalIds(memo.contextStatuteIds)
        : [];

      const contextBlock = renderContextBlockForUI(opinions, statutes);
      const contextCitations = [
        ...opinions.map((o: { citationBluebook: string }) => o.citationBluebook),
        ...statutes.map((s: { citationBluebook: string }) => s.citationBluebook),
      ];

      const memoSvc = makeMemoGenerationService(ctx.db);

      let result;
      try {
        result = await memoSvc.generateOne({
          section: input.sectionType,
          memoQuestion: memo.memoQuestion,
          contextBlock,
          contextCitations,
          steeringMessage: input.steeringMessage,
        });
      } catch (err) {
        yield { type: "error" as const, message: err instanceof Error ? err.message : String(err) };
        return;
      }

      // Emit token chunk with the generated content.
      yield { type: "token" as const, content: result.content };

      // Persist the new section content.
      const now = new Date();
      await ctx.db
        .update(researchMemoSections)
        .set({
          content: result.content,
          citations: result.citations,
          aiGeneratedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(researchMemoSections.memoId, input.memoId),
            eq(researchMemoSections.sectionType, input.sectionType),
          ),
        );

      await ctx.db
        .update(researchMemos)
        .set({ updatedAt: now })
        .where(eq(researchMemos.id, input.memoId));

      yield { type: "done" as const };
    }),

  /**
   * delete — soft-delete a memo (set deletedAt).
   */
  delete: protectedProcedure
    .input(z.object({ memoId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMemoOwnership(ctx.db, input.memoId, ctx.user.id);

      await ctx.db
        .update(researchMemos)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(researchMemos.id, input.memoId));

      return { ok: true as const };
    }),

  /**
   * retryGenerate — reset a failed memo to generating and re-fire the Inngest event.
   */
  retryGenerate: protectedProcedure
    .input(z.object({ memoId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMemoOwnership(ctx.db, input.memoId, ctx.user.id);

      await ctx.db
        .update(researchMemos)
        .set({ status: "generating", errorMessage: null, updatedAt: new Date() })
        .where(eq(researchMemos.id, input.memoId));

      try {
        await defaultInngest.send({
          name: "research/memo.generate.requested",
          data: { memoId: input.memoId },
        });
      } catch (err) {
        // Mark failed again so we don't leave it in limbo.
        await ctx.db
          .update(researchMemos)
          .set({
            status: "failed",
            errorMessage: err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          })
          .where(eq(researchMemos.id, input.memoId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to dispatch memo generation retry.",
          cause: err,
        });
      }

      return { ok: true as const };
    }),
});

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Render a context block string from resolved opinions and statutes.
 * Mirrors the private renderContextBlock in memo-generation.ts.
 */
function renderContextBlockForUI(
  opinions: { citationBluebook: string; fullText: string | null; caseName: string }[],
  statutes: { citationBluebook: string; bodyText?: string | null }[],
): string {
  const parts: string[] = [];
  opinions.forEach((o, i) => {
    const text = (o.fullText ?? "").slice(0, 6000);
    parts.push(`[Opinion ${i + 1}] ${o.caseName} (${o.citationBluebook})\n${text}`);
  });
  statutes.forEach((s, i) => {
    const text = (s.bodyText ?? "").slice(0, 4000);
    parts.push(`[Statute ${i + 1}] ${s.citationBluebook}\n${text}`);
  });
  return parts.join("\n\n---\n\n");
}
