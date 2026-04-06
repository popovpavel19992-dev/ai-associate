import { inngest } from "../client";
import { db } from "../../db";
import { calendarConnections } from "../../db/schema/calendar-connections";
import { calendarSyncLog } from "../../db/schema/calendar-sync-log";
import { calendarSyncPreferences } from "../../db/schema/calendar-sync-preferences";
import { getProvider } from "../../lib/calendar-providers/factory";
import { eq } from "drizzle-orm";

export const calendarConnectionCleanup = inngest.createFunction(
  {
    id: "calendar-connection-cleanup",
    retries: 3,
    triggers: [{ event: "calendar/connection.disconnected" }],
  },
  async ({ event, step }) => {
    const { connectionId } = event.data as { connectionId: string };

    // Load connection (it should still exist, syncEnabled was set to false by the disconnect mutation)
    const connection = await step.run("load-connection", async () => {
      const [found] = await db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, connectionId));
      return found ?? null;
    });

    if (!connection) return { cleaned: false, reason: "connection-not-found" };

    // Best-effort: delete sub-calendar from external provider
    await step.run("delete-external-calendar", async () => {
      try {
        const provider = getProvider(connection);
        if (connection.externalCalendarId) {
          await provider.deleteCalendar(connection.externalCalendarId);
        }
      } catch {
        // Best-effort — provider may already be revoked or calendar deleted
      }
    });

    // Best-effort: revoke token
    await step.run("revoke-token", async () => {
      try {
        const provider = getProvider(connection);
        await provider.revokeToken();
      } catch {
        // Best-effort — Outlook has no revoke API, Google might fail
      }
    });

    // Delete sync log entries
    await step.run("delete-sync-logs", async () => {
      await db
        .delete(calendarSyncLog)
        .where(eq(calendarSyncLog.connectionId, connectionId));
    });

    // Delete sync preferences
    await step.run("delete-preferences", async () => {
      await db
        .delete(calendarSyncPreferences)
        .where(eq(calendarSyncPreferences.connectionId, connectionId));
    });

    // Delete the connection row itself
    await step.run("delete-connection", async () => {
      await db
        .delete(calendarConnections)
        .where(eq(calendarConnections.id, connectionId));
    });

    return { cleaned: true };
  },
);
