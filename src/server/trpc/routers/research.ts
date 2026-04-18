// src/server/trpc/routers/research.ts
//
// Research tRPC router (Phase 2.2.1 Task 9).
// Wires together CourtListenerClient, OpinionCacheService,
// ResearchSessionService, and BookmarkService behind search, getOpinion,
// sessions CRUD, and bookmarks CRUD. Inngest enrichment dispatch is
// deferred to Chunk 7 (see TODO in getOpinion).

import { z } from "zod/v4";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { assertCaseAccess } from "../lib/permissions";
import { getEnv } from "@/lib/env";
import { inngest } from "@/server/inngest/client";
import { CourtListenerClient } from "@/server/services/courtlistener/client";
import { OpinionCacheService } from "@/server/services/research/opinion-cache";
import { ResearchSessionService } from "@/server/services/research/session-service";
import { BookmarkService } from "@/server/services/research/bookmark-service";
import { LegalRagService, type StreamChunk } from "@/server/services/research/legal-rag";
import { UsageGuard, UsageLimitExceededError } from "@/server/services/research/usage-guard";
import { StatuteCacheService } from "@/server/services/research/statute-cache";
import { GovInfoClient } from "@/server/services/govinfo/client";
import { EcfrClient } from "@/server/services/ecfr/client";
import { parseCitations, type ParsedCitation } from "@/server/services/research/citation-parser";
import { researchSessions } from "@/server/db/schema/research-sessions";
import { researchQueries } from "@/server/db/schema/research-queries";
import { cachedOpinions } from "@/server/db/schema/cached-opinions";
import type { db as realDb } from "@/server/db";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------
const FiltersSchema = z.object({
  jurisdictions: z
    .array(z.enum(["federal", "ca", "ny", "tx", "fl", "il", "other"]))
    .optional(),
  courtLevels: z
    .array(
      z.enum([
        "scotus",
        "circuit",
        "district",
        "state_supreme",
        "state_appellate",
        "state_other",
      ]),
    )
    .optional(),
  fromYear: z.number().int().min(1900).max(2100).optional(),
  toYear: z.number().int().min(1900).max(2100).optional(),
  courtName: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCourtListener() {
  return new CourtListenerClient({ apiToken: getEnv().COURTLISTENER_API_TOKEN });
}

function makeStatuteCache(ctx: { db: typeof realDb }): StatuteCacheService {
  return new StatuteCacheService({
    db: ctx.db,
    govinfo: new GovInfoClient({ apiKey: getEnv().GOVINFO_API_KEY }),
    ecfr: new EcfrClient(),
  });
}

const SLUG_RE = /^(\d+)-(usc|cfr)-(.+)$/;
function parseSlug(
  slug: string,
): { source: "usc" | "cfr"; title: number; section: string } | null {
  const m = slug.match(SLUG_RE);
  if (!m) return null;
  return {
    title: Number(m[1]),
    source: m[2] as "usc" | "cfr",
    section: decodeURIComponent(m[3]!),
  };
}

function isStatuteCitation(
  c: ParsedCitation,
): c is Extract<ParsedCitation, { source: "usc" | "cfr" }> {
  return c.source === "usc" || c.source === "cfr";
}

function buildStatuteCitation(
  source: "usc" | "cfr",
  title: number,
  section: string,
): string {
  return source === "usc"
    ? `${title} U.S.C. § ${section}`
    : `${title} C.F.R. § ${section}`;
}

function mapUserPlanToResearchPlan(
  plan: string | null | undefined,
): "starter" | "professional" | "business" {
  switch (plan) {
    case "trial":
      return "starter"; // 50 Q&A per month
    case "solo":
      return "professional"; // 500 per month
    default:
      return "starter"; // fallback
  }
}

// Internal deps passed to Q&A helpers so tests can stub services.
export interface AskDeps {
  db: typeof realDb;
  usageGuard?: UsageGuard;
  rag?: LegalRagService;
}

interface AskCtx {
  db: typeof realDb;
  user: { id: string; plan?: string | null };
}

function makeUsageGuard(ctx: AskCtx, deps?: AskDeps): UsageGuard {
  return deps?.usageGuard ?? new UsageGuard({ db: ctx.db });
}

function makeRag(ctx: AskCtx, deps?: AskDeps): LegalRagService {
  if (deps?.rag) return deps.rag;
  const cl = new CourtListenerClient({ apiToken: getEnv().COURTLISTENER_API_TOKEN });
  const cache = new OpinionCacheService({ db: ctx.db, courtListener: cl });
  return new LegalRagService({ db: ctx.db, opinionCache: cache });
}

export async function* runAskBroad(
  ctx: AskCtx,
  input: { sessionId: string; question: string; topN?: number },
  deps?: AskDeps,
): AsyncGenerator<StreamChunk> {
  const plan = mapUserPlanToResearchPlan(ctx.user.plan);
  const guard = makeUsageGuard(ctx, deps);

  try {
    await guard.checkAndIncrementQa({ userId: ctx.user.id, plan });
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

  const rag = makeRag(ctx, deps);

  try {
    const stream = rag.askBroad({
      sessionId: input.sessionId,
      userId: ctx.user.id,
      question: input.question,
      topN: input.topN,
    });
    for await (const chunk of stream) {
      yield chunk;
      if (chunk.type === "error") {
        await guard.refundQa({ userId: ctx.user.id });
        return;
      }
    }
  } catch (err) {
    await guard.refundQa({ userId: ctx.user.id });
    throw err;
  }
}

export async function* runAskDeep(
  ctx: AskCtx,
  input:
    | { sessionId: string; opinionInternalId: string; question: string }
    | { sessionId: string; statuteInternalId: string; question: string },
  deps?: AskDeps,
): AsyncGenerator<StreamChunk> {
  const plan = mapUserPlanToResearchPlan(ctx.user.plan);
  const guard = makeUsageGuard(ctx, deps);

  try {
    await guard.checkAndIncrementQa({ userId: ctx.user.id, plan });
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

  const rag = makeRag(ctx, deps);

  try {
    const stream = rag.askDeep(
      "opinionInternalId" in input
        ? {
            sessionId: input.sessionId,
            userId: ctx.user.id,
            opinionInternalId: input.opinionInternalId,
            question: input.question,
          }
        : {
            sessionId: input.sessionId,
            userId: ctx.user.id,
            statuteInternalId: input.statuteInternalId,
            question: input.question,
          },
    );
    for await (const chunk of stream) {
      yield chunk;
      if (chunk.type === "error") {
        await guard.refundQa({ userId: ctx.user.id });
        return;
      }
    }
  } catch (err) {
    await guard.refundQa({ userId: ctx.user.id });
    throw err;
  }
}

async function assertSessionOwnership(
  db: typeof import("@/server/db").db,
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

// ---------------------------------------------------------------------------
// sessions sub-router
// ---------------------------------------------------------------------------
const sessionsRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const svc = new ResearchSessionService({ db: ctx.db });
      return svc.listSessions({ userId: ctx.user.id, caseId: input?.caseId });
    }),

  get: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertSessionOwnership(ctx.db, input.sessionId, ctx.user.id);
      const [session] = await ctx.db
        .select()
        .from(researchSessions)
        .where(eq(researchSessions.id, input.sessionId))
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      const queries = await ctx.db
        .select()
        .from(researchQueries)
        .where(eq(researchQueries.sessionId, input.sessionId))
        .orderBy(desc(researchQueries.createdAt));
      return { session, queries };
    }),

  rename: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid(), title: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const svc = new ResearchSessionService({ db: ctx.db });
      return svc.rename({ sessionId: input.sessionId, userId: ctx.user.id, title: input.title });
    }),

  delete: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new ResearchSessionService({ db: ctx.db });
      await svc.softDelete({ sessionId: input.sessionId, userId: ctx.user.id });
      return { ok: true as const };
    }),

  linkToCase: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        caseId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.caseId !== null) {
        await assertCaseAccess(ctx, input.caseId);
      }
      const svc = new ResearchSessionService({ db: ctx.db });
      return svc.linkToCase({
        sessionId: input.sessionId,
        userId: ctx.user.id,
        caseId: input.caseId,
      });
    }),
});

// ---------------------------------------------------------------------------
// bookmarks sub-router
// ---------------------------------------------------------------------------
const bookmarksRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const svc = new BookmarkService({ db: ctx.db });
      return svc.listByUser({ userId: ctx.user.id, caseId: input?.caseId });
    }),

  create: protectedProcedure
    .input(
      z.object({
        opinionId: z.string().uuid(),
        notes: z.string().max(10_000).nullable().optional(),
        caseId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.caseId) {
        await assertCaseAccess(ctx, input.caseId);
      }
      const svc = new BookmarkService({ db: ctx.db });
      return svc.create({
        userId: ctx.user.id,
        opinionId: input.opinionId,
        notes: input.notes ?? null,
        caseId: input.caseId ?? null,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        bookmarkId: z.string().uuid(),
        notes: z.string().max(10_000).nullable().optional(),
        caseId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (typeof input.caseId === "string") {
        await assertCaseAccess(ctx, input.caseId);
      }
      const svc = new BookmarkService({ db: ctx.db });
      return svc.update({
        bookmarkId: input.bookmarkId,
        userId: ctx.user.id,
        notes: input.notes,
        caseId: input.caseId,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ bookmarkId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new BookmarkService({ db: ctx.db });
      await svc.delete({ bookmarkId: input.bookmarkId, userId: ctx.user.id });
      return { ok: true as const };
    }),
});

// ---------------------------------------------------------------------------
// statutes sub-router
// ---------------------------------------------------------------------------
const StatutesGetInputSchema = z.union([
  z.object({ internalId: z.string().uuid() }),
  z.object({ citationSlug: z.string().trim().min(3).max(200) }),
  z.object({
    source: z.enum(["usc", "cfr"]),
    title: z.number().int().positive(),
    section: z.string().min(1).max(200),
  }),
]);

const statutesRouter = router({
  get: protectedProcedure
    .input(StatutesGetInputSchema)
    .query(async ({ ctx, input }) => {
      const cache = makeStatuteCache(ctx);

      if ("internalId" in input) {
        return cache.getOrFetch(input.internalId);
      }

      let resolved: { source: "usc" | "cfr"; title: number; section: string };
      if ("citationSlug" in input) {
        const parsed = parseSlug(input.citationSlug);
        if (!parsed) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid citation slug",
          });
        }
        resolved = parsed;
      } else {
        resolved = {
          source: input.source,
          title: input.title,
          section: input.section,
        };
      }

      const citation = buildStatuteCitation(
        resolved.source,
        resolved.title,
        resolved.section,
      );
      const row = await cache.upsertMetadataOnly({
        source: resolved.source,
        title: resolved.title,
        section: resolved.section,
        citationBluebook: citation,
      });
      const full = await cache.getOrFetch(row.id);

      // Fire-and-forget enrichment (handler registered in Task 11).
      try {
        void inngest.send({
          name: "research/statute.enrich.requested",
          data: { statuteInternalId: full.id },
        });
      } catch {
        // swallow — best-effort
      }

      return full;
    }),

  lookup: protectedProcedure
    .input(z.object({ citation: z.string().trim().min(3).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const parsed = parseCitations(input.citation).find(isStatuteCitation);
      if (!parsed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unparseable citation",
        });
      }
      const cache = makeStatuteCache(ctx);
      const row = await cache.upsertMetadataOnly({
        source: parsed.source,
        title: parsed.title,
        section: parsed.section,
        citationBluebook: parsed.citation,
      });
      return { internalId: row.id };
    }),
});

// ---------------------------------------------------------------------------
// root research router
// ---------------------------------------------------------------------------
export const researchRouter = router({
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(2).max(1000),
        filters: FiltersSchema.optional(),
        page: z.number().int().min(1).max(50).default(1),
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cl = makeCourtListener();
      const cache = new OpinionCacheService({ db: ctx.db, courtListener: cl });
      const sessions = new ResearchSessionService({ db: ctx.db });

      // Verify ownership of an existing session up-front (if provided).
      // Session creation is deferred until after the CourtListener call
      // so that network/rate-limit failures don't leave orphan sessions.
      let sessionId = input.sessionId;
      if (sessionId) {
        await assertSessionOwnership(ctx.db, sessionId, ctx.user.id);
      }

      // Delegate to CourtListener. Errors bubble to the client BEFORE
      // any session write happens (fail-fast, no orphan side-effects).
      const response = await cl.search({
        query: input.query,
        filters: input.filters,
        page: input.page,
      });

      // Only now — after a successful CourtListener response — create a
      // new session if the caller didn't provide one.
      if (!sessionId) {
        const created = await sessions.createSession({
          userId: ctx.user.id,
          firstQuery: input.query,
          filters: input.filters,
        });
        sessionId = created.id;
      }

      // Cache each hit so internal UUIDs can be referenced later.
      const enrichedHits: Array<typeof response.hits[number] & { internalId: string }> = [];
      for (const hit of response.hits) {
        const row = await cache.upsertSearchHit(hit);
        enrichedHits.push({ internalId: row.id, ...hit });
      }

      // Record the query on the session.
      await sessions.appendQuery({
        sessionId,
        queryText: input.query,
        filters: input.filters,
        resultCount: response.hits.length,
      });

      return {
        sessionId,
        hits: enrichedHits,
        totalCount: response.totalCount,
        page: response.page,
        pageSize: response.pageSize,
      };
    }),

  getOpinion: protectedProcedure
    .input(
      z.union([
        z.object({ opinionInternalId: z.string().uuid() }),
        z.object({ courtlistenerId: z.number().int().positive() }),
      ]),
    )
    .query(async ({ ctx, input }) => {
      const cl = makeCourtListener();
      const cache = new OpinionCacheService({ db: ctx.db, courtListener: cl });

      let courtlistenerId: number;
      if ("opinionInternalId" in input) {
        const [row] = await ctx.db
          .select({ courtlistenerId: cachedOpinions.courtlistenerId })
          .from(cachedOpinions)
          .where(eq(cachedOpinions.id, input.opinionInternalId))
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Opinion not found" });
        courtlistenerId = row.courtlistenerId;
      } else {
        courtlistenerId = input.courtlistenerId;
      }

      const row = await cache.getOrFetch(courtlistenerId);
      // Fire-and-forget enrichment; failure here must not break the response.
      try {
        void inngest.send({
          name: "research/opinion.enrich.requested",
          data: { opinionInternalId: row.id },
        });
      } catch {
        // Swallow — enrichment is best-effort.
      }
      return row;
    }),

  askBroad: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        question: z.string().trim().min(1).max(2000),
        topN: z.number().int().min(1).max(20).optional(),
      }),
    )
    .subscription(async function* ({ ctx, input }) {
      yield* runAskBroad(ctx, input);
    }),

  askDeep: protectedProcedure
    .input(
      z.union([
        z.object({
          sessionId: z.string().uuid(),
          opinionInternalId: z.string().uuid(),
          question: z.string().trim().min(1).max(2000),
        }),
        z.object({
          sessionId: z.string().uuid(),
          statuteInternalId: z.string().uuid(),
          question: z.string().trim().min(1).max(2000),
        }),
      ]),
    )
    .subscription(async function* ({ ctx, input }) {
      yield* runAskDeep(ctx, input);
    }),

  getUsage: protectedProcedure.query(async ({ ctx }) => {
    const plan = mapUserPlanToResearchPlan(ctx.user.plan);
    const guard = new UsageGuard({ db: ctx.db });
    return guard.getCurrentUsage({ userId: ctx.user.id, plan });
  }),

  sessions: sessionsRouter,
  bookmarks: bookmarksRouter,
  statutes: statutesRouter,
});
