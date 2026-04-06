import { eq, and, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { caseCalendarEvents } from "../../db/schema/case-calendar-events";
import { calendarConnections } from "../../db/schema/calendar-connections";
import { calendarSyncPreferences } from "../../db/schema/calendar-sync-preferences";
import { calendarSyncLog } from "../../db/schema/calendar-sync-log";
import { getProvider } from "../../lib/calendar-providers/factory";

export const calendarEventSync = inngest.createFunction(
  {
    id: "calendar-event-sync",
    retries: 3,
    triggers: [{ event: "calendar/event.changed" }],
  },
  async ({ event, step }) => {
    const { eventId, action, userId } = event.data as {
      eventId: string;
      action: "create" | "update" | "delete";
      userId: string;
    };

    // Step 1: Load the event (needed for caseId, kind, and event data)
    const calEvent = await step.run("load-event", async () => {
      if (action === "delete") {
        // For deletes, sync log entries provide externalEventIds; event may already be gone
        return null;
      }
      const [found] = await db
        .select()
        .from(caseCalendarEvents)
        .where(eq(caseCalendarEvents.id, eventId));
      return found ?? null;
    });

    // Step 2: Load active connections for this user
    const connections = await step.run("load-connections", async () => {
      return db
        .select()
        .from(calendarConnections)
        .where(
          and(
            eq(calendarConnections.userId, userId),
            eq(calendarConnections.syncEnabled, true),
          ),
        );
    });

    if (connections.length === 0) return { synced: 0 };

    // Step 3: For deletes, load existing sync log entries to get externalEventIds
    const syncLogEntries =
      action === "delete"
        ? await step.run("load-sync-log-for-delete", async () => {
            return db
              .select()
              .from(calendarSyncLog)
              .where(eq(calendarSyncLog.eventId, eventId));
          })
        : [];

    let syncedCount = 0;

    for (const connection of connections) {
      // Check preferences for this connection + case
      const shouldSync = await step.run(
        `check-prefs-${connection.id}`,
        async () => {
          if (action === "delete") {
            // For deletes, only proceed if we previously synced to this connection
            return syncLogEntries.some(
              (e) => e.connectionId === connection.id && e.externalEventId,
            );
          }
          if (!calEvent) return false;
          const [pref] = await db
            .select()
            .from(calendarSyncPreferences)
            .where(
              and(
                eq(calendarSyncPreferences.connectionId, connection.id),
                eq(calendarSyncPreferences.caseId, calEvent.caseId),
              ),
            );
          if (!pref) return false;
          return (pref.kinds as string[]).includes(calEvent.kind);
        },
      );

      if (!shouldSync) continue;

      // Push to external calendar
      await step.run(`push-${connection.id}`, async () => {
        const provider = getProvider(connection);

        try {
          if (action === "create" && calEvent) {
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
              .insert(calendarSyncLog)
              .values({
                eventId,
                connectionId: connection.id,
                externalEventId: result.externalEventId,
                status: "synced",
                lastAttemptAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [calendarSyncLog.eventId, calendarSyncLog.connectionId],
                set: {
                  externalEventId: result.externalEventId,
                  status: "synced",
                  lastAttemptAt: new Date(),
                  errorMessage: null,
                },
              });
          } else if (action === "update" && calEvent) {
            // Fetch existing log entry for this connection
            const [logEntry] = await db
              .select()
              .from(calendarSyncLog)
              .where(
                and(
                  eq(calendarSyncLog.eventId, eventId),
                  eq(calendarSyncLog.connectionId, connection.id),
                ),
              );

            if (logEntry?.externalEventId) {
              await provider.updateEvent(
                connection.externalCalendarId!,
                logEntry.externalEventId,
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
                .set({
                  status: "synced",
                  lastAttemptAt: new Date(),
                  errorMessage: null,
                })
                .where(eq(calendarSyncLog.id, logEntry.id));
            } else {
              // No prior sync record — fall back to create
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
                .insert(calendarSyncLog)
                .values({
                  eventId,
                  connectionId: connection.id,
                  externalEventId: result.externalEventId,
                  status: "synced",
                  lastAttemptAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: [
                    calendarSyncLog.eventId,
                    calendarSyncLog.connectionId,
                  ],
                  set: {
                    externalEventId: result.externalEventId,
                    status: "synced",
                    lastAttemptAt: new Date(),
                    errorMessage: null,
                  },
                });
            }
          } else if (action === "delete") {
            const logEntry = syncLogEntries.find(
              (e) => e.connectionId === connection.id,
            );
            if (logEntry?.externalEventId) {
              await provider.deleteEvent(
                connection.externalCalendarId!,
                logEntry.externalEventId,
              );
              await db
                .delete(calendarSyncLog)
                .where(eq(calendarSyncLog.id, logEntry.id));
            }
          }

          syncedCount++;
        } catch (error) {
          await db
            .insert(calendarSyncLog)
            .values({
              eventId,
              connectionId: connection.id,
              status: "failed",
              lastAttemptAt: new Date(),
              errorMessage:
                error instanceof Error ? error.message : String(error),
            })
            .onConflictDoUpdate({
              target: [calendarSyncLog.eventId, calendarSyncLog.connectionId],
              set: {
                status: "failed",
                lastAttemptAt: new Date(),
                errorMessage:
                  error instanceof Error ? error.message : String(error),
                retryCount: sql`retry_count + 1`,
              },
            });
          throw error; // Re-throw so Inngest retries
        }
      });
    }

    return { synced: syncedCount };
  },
);
