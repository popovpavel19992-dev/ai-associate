import { inngest } from "../client";
import { db } from "../../db";
import { calendarSyncLog } from "../../db/schema/calendar-sync-log";
import { caseCalendarEvents } from "../../db/schema/case-calendar-events";
import { calendarConnections } from "../../db/schema/calendar-connections";
import { getProvider } from "../../lib/calendar-providers/factory";
import { eq, and, inArray, lt, sql } from "drizzle-orm";

export const calendarSweep = inngest.createFunction(
  {
    id: "calendar-sweep",
    retries: 1,
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    // Load pending/failed entries with retryCount < 5, limit 200
    const entries = await step.run("load-pending", async () => {
      return db
        .select()
        .from(calendarSyncLog)
        .where(
          and(
            inArray(calendarSyncLog.status, ["pending", "failed"]),
            lt(calendarSyncLog.retryCount, 5),
          ),
        )
        .limit(200);
    });

    if (entries.length === 0) return { processed: 0 };

    let processed = 0;

    for (const entry of entries) {
      // Process each entry with per-event sleep for rate limiting
      await step.run(`sync-${entry.id}`, async () => {
        // Load the event
        const [calEvent] = await db
          .select()
          .from(caseCalendarEvents)
          .where(eq(caseCalendarEvents.id, entry.eventId));

        if (!calEvent) {
          // Event deleted, clean up log
          await db.delete(calendarSyncLog).where(eq(calendarSyncLog.id, entry.id));
          return;
        }

        // Load the connection
        const [connection] = await db
          .select()
          .from(calendarConnections)
          .where(eq(calendarConnections.id, entry.connectionId));

        if (!connection || !connection.syncEnabled) {
          // Connection gone or disabled
          await db.delete(calendarSyncLog).where(eq(calendarSyncLog.id, entry.id));
          return;
        }

        try {
          const provider = getProvider(connection);

          if (entry.externalEventId) {
            // Update existing
            await provider.updateEvent(
              connection.externalCalendarId!,
              entry.externalEventId,
              {
                title: calEvent.title,
                description: calEvent.description ?? undefined,
                startsAt: calEvent.startsAt,
                endsAt: calEvent.endsAt ?? undefined,
                location: calEvent.location ?? undefined,
              },
            );
          } else {
            // Create new
            const result = await provider.createEvent(
              connection.externalCalendarId!,
              {
                title: calEvent.title,
                description: calEvent.description ?? undefined,
                startsAt: calEvent.startsAt,
                endsAt: calEvent.endsAt ?? undefined,
                location: calEvent.location ?? undefined,
              },
            );

            await db
              .update(calendarSyncLog)
              .set({ externalEventId: result.externalEventId })
              .where(eq(calendarSyncLog.id, entry.id));
          }

          // Mark as synced
          await db
            .update(calendarSyncLog)
            .set({
              status: "synced",
              lastAttemptAt: new Date(),
              errorMessage: null,
            })
            .where(eq(calendarSyncLog.id, entry.id));

          processed++;
        } catch (error) {
          await db
            .update(calendarSyncLog)
            .set({
              status: "failed",
              lastAttemptAt: new Date(),
              retryCount: sql`${calendarSyncLog.retryCount} + 1`,
              errorMessage: error instanceof Error ? error.message : String(error),
            })
            .where(eq(calendarSyncLog.id, entry.id));
        }
      });

      // Per-event sleep for rate limiting (Microsoft Graph: 4 req/s)
      await step.sleep(`sleep-after-${entry.id}`, "1s");
    }

    return { processed };
  },
);
