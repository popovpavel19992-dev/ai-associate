// src/server/trpc/routers/calendar-connections.ts
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { eq, and, max, count, inArray, desc } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { calendarConnections } from "@/server/db/schema/calendar-connections";
import { calendarSyncPreferences } from "@/server/db/schema/calendar-sync-preferences";
import { calendarSyncLog } from "@/server/db/schema/calendar-sync-log";
import { icalFeeds } from "@/server/db/schema/ical-feeds";
import { externalInboundEvents } from "@/server/db/schema/external-inbound-events";
import { inboundEventConflicts } from "@/server/db/schema/inbound-event-conflicts";
import { caseCalendarEvents } from "@/server/db/schema/case-calendar-events";
import { cases } from "@/server/db/schema/cases";
import { CALENDAR_EVENT_KINDS } from "@/lib/calendar-events";
import { inngest } from "@/server/inngest/client";
import type { CalendarConnection } from "@/server/db/schema/calendar-connections";

export const calendarConnectionsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const connections = await ctx.db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.userId, ctx.user.id));

    if (connections.length === 0) return [];

    const connectionIds = connections.map((c) => c.id);

    const aggregates = await ctx.db
      .select({
        connectionId: calendarSyncLog.connectionId,
        lastSyncAt: max(calendarSyncLog.updatedAt),
        eventCount: count(calendarSyncLog.id),
      })
      .from(calendarSyncLog)
      .where(inArray(calendarSyncLog.connectionId, connectionIds))
      .groupBy(calendarSyncLog.connectionId);

    const aggregateMap = new Map(
      aggregates.map((a) => [
        a.connectionId,
        { lastSyncAt: a.lastSyncAt, eventCount: Number(a.eventCount) },
      ]),
    );

    return connections.map((connection) => {
      const agg = aggregateMap.get(connection.id);
      return {
        connection,
        lastSyncAt: agg?.lastSyncAt ?? null,
        eventCount: agg?.eventCount ?? 0,
      } as {
        connection: CalendarConnection;
        lastSyncAt: Date | null;
        eventCount: number;
      };
    });
  }),

  getIcalFeed: protectedProcedure.query(async ({ ctx }) => {
    const [feed] = await ctx.db
      .select()
      .from(icalFeeds)
      .where(eq(icalFeeds.userId, ctx.user.id))
      .limit(1);
    return feed ?? null;
  }),

  updatePreferences: protectedProcedure
    .input(
      z.object({
        connectionId: z.string().uuid(),
        caseId: z.string().uuid(),
        kinds: z.array(z.enum(CALENDAR_EVENT_KINDS)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify connection ownership
      const [connection] = await ctx.db
        .select({ id: calendarConnections.id })
        .from(calendarConnections)
        .where(
          and(
            eq(calendarConnections.id, input.connectionId),
            eq(calendarConnections.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Connection not found",
        });
      }

      if (input.kinds.length === 0) {
        // Delete preference row when no kinds selected
        await ctx.db
          .delete(calendarSyncPreferences)
          .where(
            and(
              eq(calendarSyncPreferences.connectionId, input.connectionId),
              eq(calendarSyncPreferences.caseId, input.caseId),
            ),
          );
        return { success: true };
      }

      const [upserted] = await ctx.db
        .insert(calendarSyncPreferences)
        .values({
          connectionId: input.connectionId,
          caseId: input.caseId,
          kinds: input.kinds,
        })
        .onConflictDoUpdate({
          target: [
            calendarSyncPreferences.connectionId,
            calendarSyncPreferences.caseId,
          ],
          set: { kinds: input.kinds },
        })
        .returning();

      return upserted;
    }),

  regenerateIcalToken: protectedProcedure.mutation(async ({ ctx }) => {
    const newToken = crypto.randomUUID();

    const [updated] = await ctx.db
      .update(icalFeeds)
      .set({ token: newToken })
      .where(eq(icalFeeds.userId, ctx.user.id))
      .returning();

    if (!updated) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "iCal feed not found",
      });
    }

    return updated;
  }),

  retrySyncEvent: protectedProcedure
    .input(z.object({ syncLogId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [logEntry] = await ctx.db
        .select({
          syncLog: calendarSyncLog,
          connection: calendarConnections,
        })
        .from(calendarSyncLog)
        .innerJoin(
          calendarConnections,
          eq(calendarConnections.id, calendarSyncLog.connectionId),
        )
        .where(
          and(
            eq(calendarSyncLog.id, input.syncLogId),
            eq(calendarConnections.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!logEntry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sync log entry not found",
        });
      }

      if (logEntry.syncLog.retryCount >= 5) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Max retry attempts reached",
        });
      }

      await inngest.send({
        name: "calendar/event.changed",
        data: {
          eventId: logEntry.syncLog.eventId,
          action: "update" as const,
          userId: ctx.user.id,
        },
      });

      return { success: true };
    }),

  getSyncStatus: protectedProcedure
    .input(z.object({ eventIds: z.array(z.string().uuid()) }))
    .query(async ({ ctx, input }) => {
      if (input.eventIds.length === 0) return [];

      const rows = await ctx.db
        .select()
        .from(calendarSyncLog)
        .where(inArray(calendarSyncLog.eventId, input.eventIds));

      return rows;
    }),

  triggerInboundSync: protectedProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [connection] = await ctx.db
        .select({ id: calendarConnections.id })
        .from(calendarConnections)
        .where(
          and(
            eq(calendarConnections.id, input.connectionId),
            eq(calendarConnections.userId, ctx.user.id),
          ),
        )
        .limit(1);
      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Connection not found",
        });
      }
      await inngest.send({
        name: "calendar/inbound.pull",
        data: { connectionId: input.connectionId },
      });
      return { success: true };
    }),

  setInboundEnabled: protectedProcedure
    .input(
      z.object({
        connectionId: z.string().uuid(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(calendarConnections)
        .set({ inboundSyncEnabled: input.enabled, updatedAt: new Date() })
        .where(
          and(
            eq(calendarConnections.id, input.connectionId),
            eq(calendarConnections.userId, ctx.user.id),
          ),
        )
        .returning({ id: calendarConnections.id });
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Connection not found",
        });
      }
      return { success: true };
    }),

  listConflicts: protectedProcedure
    .input(
      z
        .object({
          resolution: z.enum(["open", "dismissed", "rescheduled"]).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .default({ limit: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(inboundEventConflicts.userId, ctx.user.id)];
      if (input.resolution) {
        conditions.push(eq(inboundEventConflicts.resolution, input.resolution));
      }
      const rows = await ctx.db
        .select({
          conflict: inboundEventConflicts,
          inbound: externalInboundEvents,
          caseEvent: caseCalendarEvents,
          caseTitle: cases.name,
          caseId: cases.id,
          provider: calendarConnections.provider,
          providerEmail: calendarConnections.providerEmail,
        })
        .from(inboundEventConflicts)
        .innerJoin(
          externalInboundEvents,
          eq(externalInboundEvents.id, inboundEventConflicts.inboundEventId),
        )
        .innerJoin(
          calendarConnections,
          eq(calendarConnections.id, externalInboundEvents.connectionId),
        )
        .innerJoin(
          caseCalendarEvents,
          eq(caseCalendarEvents.id, inboundEventConflicts.caseEventId),
        )
        .innerJoin(cases, eq(cases.id, caseCalendarEvents.caseId))
        .where(and(...conditions))
        .orderBy(desc(inboundEventConflicts.detectedAt))
        .limit(input.limit);

      return rows;
    }),

  resolveConflict: protectedProcedure
    .input(
      z.object({
        conflictId: z.string().uuid(),
        resolution: z.enum(["dismissed", "rescheduled"]),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(inboundEventConflicts)
        .set({
          resolution: input.resolution,
          resolutionNote: input.note ?? null,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(inboundEventConflicts.id, input.conflictId),
            eq(inboundEventConflicts.userId, ctx.user.id),
          ),
        )
        .returning({ id: inboundEventConflicts.id });
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conflict not found",
        });
      }
      return { success: true };
    }),

  disconnect: protectedProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const [connection] = await ctx.db
        .select({ id: calendarConnections.id })
        .from(calendarConnections)
        .where(
          and(
            eq(calendarConnections.id, input.connectionId),
            eq(calendarConnections.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Connection not found",
        });
      }

      // Step 1: DB-first — set syncEnabled=false and await commit
      await ctx.db
        .update(calendarConnections)
        .set({ syncEnabled: false, updatedAt: new Date() })
        .where(eq(calendarConnections.id, input.connectionId));

      // Step 2: Dispatch event after DB commit to prevent race conditions
      await inngest.send({
        name: "calendar/connection.disconnected",
        data: { connectionId: input.connectionId },
      });

      return { success: true };
    }),
});
