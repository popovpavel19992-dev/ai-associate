import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/server/db";
import { calendarConnections } from "@/server/db/schema/calendar-connections";
import { externalInboundEvents } from "@/server/db/schema/external-inbound-events";
import { inboundEventConflicts } from "@/server/db/schema/inbound-event-conflicts";
import { caseCalendarEvents } from "@/server/db/schema/case-calendar-events";
import { calendarSyncPreferences } from "@/server/db/schema/calendar-sync-preferences";
import { getProvider } from "@/server/lib/calendar-providers/factory";
import type { InboundEvent } from "@/server/lib/calendar-providers/types";

export interface PullResult {
  fetched: number;
  upserted: number;
  deleted: number;
  conflictsDetected: number;
  fullResync: boolean;
  error?: string;
}

/**
 * Pull events from a connection's external calendar, upsert into
 * external_inbound_events, then run conflict detection against any
 * case_calendar_events the user has scoped via calendar_sync_preferences.
 *
 * Idempotent: callable from sweep cron and from one-shot user actions.
 */
export async function pullForConnection(
  connectionId: string,
): Promise<PullResult> {
  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId));

  if (!connection) {
    return {
      fetched: 0,
      upserted: 0,
      deleted: 0,
      conflictsDetected: 0,
      fullResync: false,
      error: "connection-not-found",
    };
  }
  if (!connection.inboundSyncEnabled) {
    return {
      fetched: 0,
      upserted: 0,
      deleted: 0,
      conflictsDetected: 0,
      fullResync: false,
      error: "inbound-disabled",
    };
  }

  const provider = getProvider(connection);

  let result;
  try {
    result = await provider.listEvents(connection.syncToken ?? connection.deltaLink ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(calendarConnections)
      .set({ inboundSyncError: message, lastInboundSyncAt: new Date() })
      .where(eq(calendarConnections.id, connectionId));
    return {
      fetched: 0,
      upserted: 0,
      deleted: 0,
      conflictsDetected: 0,
      fullResync: false,
      error: message,
    };
  }

  if (result.fullResyncRequired) {
    // Cursor invalidated. Clear it; next sweep will rebuild from scratch.
    await db
      .update(calendarConnections)
      .set({
        syncToken: null,
        deltaLink: null,
        inboundSyncError: "cursor-expired-full-resync-queued",
        lastInboundSyncAt: new Date(),
      })
      .where(eq(calendarConnections.id, connectionId));
    return {
      fetched: 0,
      upserted: 0,
      deleted: 0,
      conflictsDetected: 0,
      fullResync: true,
    };
  }

  let upserted = 0;
  let deleted = 0;
  const upsertedIds: string[] = [];

  for (const ev of result.events) {
    if (ev.isDeleted) {
      const removed = await db
        .update(externalInboundEvents)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(externalInboundEvents.connectionId, connectionId),
            eq(externalInboundEvents.externalEventId, ev.externalEventId),
            isNull(externalInboundEvents.deletedAt),
          ),
        )
        .returning({ id: externalInboundEvents.id });
      deleted += removed.length;
      continue;
    }

    const [row] = await db
      .insert(externalInboundEvents)
      .values({
        connectionId,
        externalEventId: ev.externalEventId,
        externalEtag: ev.externalEtag ?? null,
        title: ev.title,
        description: ev.description,
        location: ev.location,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        isAllDay: ev.isAllDay ? "true" : "false",
        status: ev.status,
        raw: ev.raw as object,
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: [
          externalInboundEvents.connectionId,
          externalInboundEvents.externalEventId,
        ],
        set: {
          externalEtag: ev.externalEtag ?? null,
          title: ev.title,
          description: ev.description,
          location: ev.location,
          startsAt: ev.startsAt,
          endsAt: ev.endsAt,
          isAllDay: ev.isAllDay ? "true" : "false",
          status: ev.status,
          raw: ev.raw as object,
          fetchedAt: new Date(),
          deletedAt: null,
        },
      })
      .returning({ id: externalInboundEvents.id });

    upserted++;
    if (row?.id) upsertedIds.push(row.id);
  }

  // Persist new cursor
  await db
    .update(calendarConnections)
    .set({
      syncToken: connection.provider === "google" ? result.nextCursor : null,
      deltaLink: connection.provider === "outlook" ? result.nextCursor : null,
      lastInboundSyncAt: new Date(),
      inboundSyncError: null,
    })
    .where(eq(calendarConnections.id, connectionId));

  // Conflict detection only against newly upserted rows.
  let conflictsDetected = 0;
  if (upsertedIds.length > 0) {
    conflictsDetected = await detectConflictsForInbound(
      connection.userId,
      upsertedIds,
    );
  }

  return {
    fetched: result.events.length,
    upserted,
    deleted,
    conflictsDetected,
    fullResync: false,
  };
}

/**
 * For a set of newly fetched inbound events, find overlapping case events
 * (via the user's calendar_sync_preferences scope) and upsert into
 * inbound_event_conflicts.
 *
 * Overlap rule: ranges [a.start, a.end) and [b.start, b.end) overlap iff
 *   a.start < b.end AND b.start < a.end
 * For all-day or open-ended events, end defaults to start + 30min.
 */
async function detectConflictsForInbound(
  userId: string,
  inboundIds: string[],
): Promise<number> {
  if (inboundIds.length === 0) return 0;

  // Load the inbound events themselves
  const inbound = await db
    .select()
    .from(externalInboundEvents)
    .where(
      // simple where IN via or(eq) chain — Drizzle's inArray would be cleaner
      // but the small list keeps the query plan trivial
      or(...inboundIds.map((id) => eq(externalInboundEvents.id, id))),
    );

  if (inbound.length === 0) return 0;

  // Cases the user has scoped for this user's connections
  const scoped = await db
    .select({ caseId: calendarSyncPreferences.caseId })
    .from(calendarSyncPreferences)
    .innerJoin(
      calendarConnections,
      eq(calendarSyncPreferences.connectionId, calendarConnections.id),
    )
    .where(eq(calendarConnections.userId, userId));

  const caseIds = Array.from(new Set(scoped.map((s) => s.caseId)));
  if (caseIds.length === 0) return 0;

  // Compute the broad time window of the inbound batch — narrows the case
  // event scan. Default 30-min window for open-ended events.
  const windows = inbound.map((e) => {
    const start = e.startsAt;
    const end = e.endsAt ?? new Date(start.getTime() + 30 * 60 * 1000);
    return { id: e.id, start, end };
  });
  const minStart = new Date(
    Math.min(...windows.map((w) => w.start.getTime())),
  );
  const maxEnd = new Date(Math.max(...windows.map((w) => w.end.getTime())));

  const caseEvents = await db
    .select()
    .from(caseCalendarEvents)
    .where(
      and(
        or(...caseIds.map((id) => eq(caseCalendarEvents.caseId, id))),
        lte(caseCalendarEvents.startsAt, maxEnd),
        // case event ends after window minStart — but endsAt may be null
        or(
          gte(caseCalendarEvents.endsAt, minStart),
          isNull(caseCalendarEvents.endsAt),
        ),
      ),
    );

  let detected = 0;

  for (const w of windows) {
    for (const ce of caseEvents) {
      const ceStart = ce.startsAt;
      const ceEnd =
        ce.endsAt ?? new Date(ceStart.getTime() + 30 * 60 * 1000);

      const overlapStart = w.start > ceStart ? w.start : ceStart;
      const overlapEnd = w.end < ceEnd ? w.end : ceEnd;
      if (overlapStart >= overlapEnd) continue;

      const inserted = await db
        .insert(inboundEventConflicts)
        .values({
          userId,
          inboundEventId: w.id,
          caseEventId: ce.id,
          overlapStartsAt: overlapStart,
          overlapEndsAt: overlapEnd,
          resolution: "open",
        })
        .onConflictDoNothing({
          target: [
            inboundEventConflicts.inboundEventId,
            inboundEventConflicts.caseEventId,
          ],
        })
        .returning({ id: inboundEventConflicts.id });

      detected += inserted.length;
    }
  }

  return detected;
}
