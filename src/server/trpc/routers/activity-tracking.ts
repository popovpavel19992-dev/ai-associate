// src/server/trpc/routers/activity-tracking.ts
//
// Phase 3.9 — tRPC surface for the auto-billable activity tracker.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { assertCaseAccess } from "../lib/permissions";
import { ACTIVITY_EVENT_TYPES } from "@/server/db/schema/case-activity-events";
import { suggestedTimeEntries } from "@/server/db/schema/suggested-time-entries";
import { caseActivityEvents } from "@/server/db/schema/case-activity-events";
import { logActivity, closeOutPageView } from "@/server/services/activity-tracking/service";
import {
  refreshSuggestions,
  listPending,
  acceptSuggestion,
  dismissSuggestion,
} from "@/server/services/activity-tracking/suggestions-service";

const eventTypeEnum = z.enum(ACTIVITY_EVENT_TYPES);

export const activityTrackingRouter = router({
  /** Open a new event row. Used on page mount; the client sends logEnd on
   *  unmount with the final duration. */
  logStart: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        eventType: eventTypeEnum,
        metadata: z.record(z.string(), z.unknown()).optional(),
        contextUrl: z.string().max(2048).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      if (!ctx.user.orgId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "User has no org" });
      }
      const { id } = await logActivity(ctx.db, {
        orgId: ctx.user.orgId,
        userId: ctx.user.id,
        caseId: input.caseId,
        eventType: input.eventType,
        metadata: input.metadata,
        contextUrl: input.contextUrl,
      });
      return { eventId: id };
    }),

  /** Close out / heartbeat an open event row with the final duration. */
  logEnd: protectedProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        durationSeconds: z.number().int().min(0).max(14400),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Ownership check — only the originator can update their event.
      const [row] = await ctx.db
        .select({ userId: caseActivityEvents.userId })
        .from(caseActivityEvents)
        .where(eq(caseActivityEvents.id, input.eventId))
        .limit(1);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await closeOutPageView(ctx.db, {
        userId: ctx.user.id,
        eventId: input.eventId,
        durationSeconds: input.durationSeconds,
      });
      return { success: true };
    }),

  /** One-shot mutation event (e.g. mutation-instrumentation). */
  logEvent: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        eventType: eventTypeEnum,
        durationSeconds: z.number().int().min(0).max(14400).default(0),
        metadata: z.record(z.string(), z.unknown()).optional(),
        contextUrl: z.string().max(2048).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      if (!ctx.user.orgId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "User has no org" });
      }
      const { id } = await logActivity(ctx.db, {
        orgId: ctx.user.orgId,
        userId: ctx.user.id,
        caseId: input.caseId,
        eventType: input.eventType,
        durationSeconds: input.durationSeconds,
        metadata: input.metadata,
        contextUrl: input.contextUrl,
      });
      return { eventId: id };
    }),

  /** Trigger the sessionizer for the current user on demand. */
  refreshSuggestions: protectedProcedure
    .input(z.object({ lookbackDays: z.number().int().min(1).max(30).default(7) }).optional())
    .mutation(async ({ ctx, input }) => {
      const r = await refreshSuggestions(ctx.db, ctx.user.id, input?.lookbackDays ?? 7);
      return r;
    }),

  listPendingSuggestions: protectedProcedure.query(async ({ ctx }) => {
    const suggestions = await listPending(ctx.db, ctx.user.id);
    return { suggestions };
  }),

  acceptSuggestion: protectedProcedure
    .input(
      z.object({
        suggestionId: z.string().uuid(),
        description: z.string().min(1).max(2000).optional(),
        billableRate: z.number().int().min(0).max(1_000_000).optional(),
        billable: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Ownership check
      const [row] = await ctx.db
        .select({ userId: suggestedTimeEntries.userId })
        .from(suggestedTimeEntries)
        .where(eq(suggestedTimeEntries.id, input.suggestionId))
        .limit(1);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const r = await acceptSuggestion(ctx.db, input.suggestionId, {
        description: input.description,
        billableRate: input.billableRate,
        billable: input.billable,
      });
      return r;
    }),

  dismissSuggestion: protectedProcedure
    .input(z.object({ suggestionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ userId: suggestedTimeEntries.userId })
        .from(suggestedTimeEntries)
        .where(eq(suggestedTimeEntries.id, input.suggestionId))
        .limit(1);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await dismissSuggestion(ctx.db, input.suggestionId);
      return { success: true };
    }),
});
