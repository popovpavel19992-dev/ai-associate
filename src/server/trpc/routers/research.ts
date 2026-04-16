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
import { CourtListenerClient } from "@/server/services/courtlistener/client";
import { OpinionCacheService } from "@/server/services/research/opinion-cache";
import { ResearchSessionService } from "@/server/services/research/session-service";
import { BookmarkService } from "@/server/services/research/bookmark-service";
import { researchSessions } from "@/server/db/schema/research-sessions";
import { researchQueries } from "@/server/db/schema/research-queries";
import { cachedOpinions } from "@/server/db/schema/cached-opinions";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------
const FiltersSchema = z.object({
  jurisdictions: z.array(z.enum(["federal", "ca", "ny", "tx", "fl", "il"])).optional(),
  courtLevels: z
    .array(z.enum(["scotus", "circuit", "district", "state_supreme", "state_appellate"]))
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
// root research router
// ---------------------------------------------------------------------------
export const researchRouter = router({
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(1000),
        filters: FiltersSchema.optional(),
        page: z.number().int().min(1).max(50).default(1),
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cl = makeCourtListener();
      const cache = new OpinionCacheService({ db: ctx.db, courtListener: cl });
      const sessions = new ResearchSessionService({ db: ctx.db });

      // Resolve sessionId: verify ownership of existing or create a new one.
      let sessionId = input.sessionId;
      if (sessionId) {
        await assertSessionOwnership(ctx.db, sessionId, ctx.user.id);
      } else {
        const created = await sessions.createSession({
          userId: ctx.user.id,
          firstQuery: input.query,
          filters: input.filters,
        });
        sessionId = created.id;
      }

      // Delegate to CourtListener. Errors bubble to the client.
      const response = await cl.search({
        query: input.query,
        filters: input.filters,
        page: input.page,
      });

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
      // TODO(2.2.1 Chunk 7): dispatch Inngest "research.enrichOpinion" event (non-blocking)
      return row;
    }),

  sessions: sessionsRouter,
  bookmarks: bookmarksRouter,
});
