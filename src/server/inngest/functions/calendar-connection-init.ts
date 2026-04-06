import { inngest } from "../client";
import { db } from "../../db";
import { calendarConnections } from "../../db/schema/calendar-connections";
import { calendarSyncPreferences } from "../../db/schema/calendar-sync-preferences";
import { caseCalendarEvents } from "../../db/schema/case-calendar-events";
import { calendarSyncLog } from "../../db/schema/calendar-sync-log";
import { getProvider } from "../../lib/calendar-providers/factory";
import type { CalendarConnection } from "../../db/schema/calendar-connections";
import { eq, and, inArray } from "drizzle-orm";

export const calendarConnectionInit = inngest.createFunction(
  {
    id: "calendar-connection-init",
    retries: 3,
    triggers: [{ event: "calendar/connection.created" }],
  },
  async ({ event, step }) => {
    const { connectionId, userId } = event.data as {
      connectionId: string;
      userId: string;
    };

    // Load connection
    const connection = await step.run("load-connection", async () => {
      const [found] = await db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, connectionId));
      if (!found) throw new Error(`Connection ${connectionId} not found`);
      return found;
    });

    // Load preferences (opt-in model)
    const prefs = await step.run("load-preferences", async () => {
      return db
        .select()
        .from(calendarSyncPreferences)
        .where(eq(calendarSyncPreferences.connectionId, connectionId));
    });

    // NOTE: On first connect, preferences will be empty (user hasn't configured yet).
    // This means backfill pushes zero events — expected behavior.
    // Events will sync as the user enables cases/kinds in the UI.
    if (prefs.length === 0) {
      return { backfilled: 0, reason: "no-preferences-yet" };
    }

    // Load events matching preferences
    const caseIds = prefs.map((p) => p.caseId);
    const events = await step.run("load-events", async () => {
      return db
        .select()
        .from(caseCalendarEvents)
        .where(inArray(caseCalendarEvents.caseId, caseIds));
    });

    // Filter by kinds per case
    const prefMap = new Map(prefs.map((p) => [p.caseId, p.kinds as string[]]));
    const filtered = events.filter((e) => {
      const allowedKinds = prefMap.get(e.caseId);
      return allowedKinds?.includes(e.kind);
    });

    if (filtered.length === 0) return { backfilled: 0 };

    // Check existing sync log entries for idempotency
    const existingLogs = await step.run("check-existing", async () => {
      return db
        .select({ eventId: calendarSyncLog.eventId })
        .from(calendarSyncLog)
        .where(eq(calendarSyncLog.connectionId, connectionId));
    });

    const existingEventIds = new Set(existingLogs.map((l) => l.eventId));
    const toSync = filtered.filter((e) => !existingEventIds.has(e.id));

    if (toSync.length === 0) return { backfilled: 0, reason: "already-synced" };

    let backfilled = 0;
    const provider = getProvider(connection as unknown as CalendarConnection);

    for (const calEvent of toSync) {
      await step.run(`push-${calEvent.id}`, async () => {
        try {
          const result = await provider.createEvent(
            connection.externalCalendarId!,
            {
              title: calEvent.title,
              description: calEvent.description ?? undefined,
              startsAt: new Date(calEvent.startsAt),
              endsAt: calEvent.endsAt != null ? new Date(calEvent.endsAt) : undefined,
              location: calEvent.location ?? undefined,
            },
          );

          await db.insert(calendarSyncLog).values({
            eventId: calEvent.id,
            connectionId,
            externalEventId: result.externalEventId,
            status: "synced",
            lastAttemptAt: new Date(),
          });

          backfilled++;
        } catch (error) {
          // Log as pending for sweep to pick up
          await db.insert(calendarSyncLog).values({
            eventId: calEvent.id,
            connectionId,
            status: "pending",
            lastAttemptAt: new Date(),
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      });

      // Rate limiting sleep
      await step.sleep(`sleep-after-${calEvent.id}`, "1s");
    }

    return { backfilled };
  },
);
