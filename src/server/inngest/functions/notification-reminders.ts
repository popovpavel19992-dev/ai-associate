import { and, between, eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { caseCalendarEvents } from "../../db/schema/case-calendar-events";
import { caseMembers } from "../../db/schema/case-members";
import type { NotificationSendEvent } from "@/lib/notification-types";

const WINDOWS = [
  { minutesBefore: 15, label: "15min" },
  { minutesBefore: 60, label: "60min" },
] as const;

const HALF_WINDOW_MS = 2.5 * 60 * 1000; // ±2.5 min tolerance

export const notificationReminders = inngest.createFunction(
  {
    id: "notification-reminders",
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const now = new Date();

    for (const { minutesBefore, label } of WINDOWS) {
      await step.run(`check-${label}-reminders`, async () => {
        const targetTime = new Date(now.getTime() + minutesBefore * 60 * 1000);
        const windowStart = new Date(targetTime.getTime() - HALF_WINDOW_MS);
        const windowEnd = new Date(targetTime.getTime() + HALF_WINDOW_MS);

        const events = await db
          .select()
          .from(caseCalendarEvents)
          .where(between(caseCalendarEvents.startsAt, windowStart, windowEnd));

        for (const evt of events) {
          // Get case members
          const members = await db
            .select({ userId: caseMembers.userId })
            .from(caseMembers)
            .where(eq(caseMembers.caseId, evt.caseId));

          // Build unique set of recipient userIds (members + creator)
          const recipientSet = new Set<string>(members.map((m) => m.userId));
          recipientSet.add(evt.createdBy);

          const startTime = evt.startsAt.toISOString();

          for (const userId of recipientSet) {
            const dedupKey = `event_reminder:${evt.id}:${label}:${userId}`;

            const payload: NotificationSendEvent = {
              userId,
              type: "event_reminder",
              title: `Reminder: ${evt.title}`,
              body: `"${evt.title}" starts in ${minutesBefore} minutes.`,
              caseId: evt.caseId,
              actionUrl: `/cases/${evt.caseId}`,
              metadata: {
                eventTitle: evt.title,
                startTime,
                minutesBefore,
              },
              dedupKey,
            };

            await inngest.send({
              name: "notification/send",
              data: payload,
            });
          }
        }
      });
    }

    return { checkedAt: now.toISOString() };
  },
);
