import { and, eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { calendarConnections } from "../../db/schema/calendar-connections";
import { pullForConnection } from "../../services/calendar-sync/inbound";

/**
 * Pulls inbound events from every active calendar connection every 15 min.
 * Pairs with the existing calendar-sweep (outbound retry) to provide full
 * two-way coverage on a poll cadence. True push-webhooks (Google watch /
 * Outlook subscriptions) are a separate sprint.
 */
export const calendarInboundSweep = inngest.createFunction(
  {
    id: "calendar-inbound-sweep",
    retries: 1,
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    const connections = await step.run("load-connections", async () => {
      return db
        .select({ id: calendarConnections.id })
        .from(calendarConnections)
        .where(
          and(
            eq(calendarConnections.syncEnabled, true),
            eq(calendarConnections.inboundSyncEnabled, true),
          ),
        );
    });

    if (connections.length === 0) return { connections: 0 };

    let totalUpserted = 0;
    let totalConflicts = 0;
    let failures = 0;

    for (const c of connections) {
      const result = await step.run(`pull-${c.id}`, async () => {
        try {
          return await pullForConnection(c.id);
        } catch (err) {
          return {
            fetched: 0,
            upserted: 0,
            deleted: 0,
            conflictsDetected: 0,
            fullResync: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      });

      totalUpserted += result.upserted;
      totalConflicts += result.conflictsDetected;
      if (result.error) failures++;

      // Per-connection sleep keeps us under Google (queries/user/100s) and
      // Microsoft Graph (4 req/s) ceilings even with many tenants.
      await step.sleep(`sleep-${c.id}`, "2s");
    }

    return {
      connections: connections.length,
      upserted: totalUpserted,
      conflicts: totalConflicts,
      failures,
    };
  },
);

/**
 * Per-connection inbound trigger. Fired by:
 *   - calendar/connection.created → kick off initial sync immediately
 *     (without waiting up to 15 min for the cron sweep)
 *   - manual user action via tRPC mutation
 */
export const calendarInboundPullOne = inngest.createFunction(
  {
    id: "calendar-inbound-pull-one",
    retries: 2,
    triggers: [{ event: "calendar/inbound.pull" }],
  },
  async ({ event, step }) => {
    const { connectionId } = event.data as { connectionId: string };
    return step.run("pull", () => pullForConnection(connectionId));
  },
);
