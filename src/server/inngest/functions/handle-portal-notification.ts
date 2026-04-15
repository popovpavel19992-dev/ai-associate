import { and, eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { portalNotifications, portalNotificationSignals } from "../../db/schema/portal-notifications";
import { portalNotificationPreferences } from "../../db/schema/portal-notification-preferences";
import { portalUsers } from "../../db/schema/portal-users";
import { sendPortalNotificationEmail } from "../../services/portal-emails";

interface PortalNotificationEvent {
  portalUserId: string;
  type: string;
  title: string;
  body: string;
  caseId?: string;
  actionUrl?: string;
  dedupKey?: string;
}

export const handlePortalNotification = inngest.createFunction(
  {
    id: "handle-portal-notification",
    retries: 2,
    triggers: [{ event: "portal-notification/send" }],
  },
  async ({ event, step }) => {
    const data = event.data as PortalNotificationEvent;

    // Insert notification
    await step.run("insert-notification", async () => {
      await db
        .insert(portalNotifications)
        .values({
          portalUserId: data.portalUserId,
          type: data.type,
          title: data.title,
          body: data.body,
          caseId: data.caseId ?? null,
          actionUrl: data.actionUrl ?? null,
          dedupKey: data.dedupKey ?? null,
        })
        .onConflictDoNothing();
    });

    // Bump signal for SSE
    await step.run("bump-signal", async () => {
      await db
        .insert(portalNotificationSignals)
        .values({ portalUserId: data.portalUserId, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: portalNotificationSignals.portalUserId,
          set: { updatedAt: new Date() },
        });
    });

    // Check email preference
    const emailEnabled = await step.run("check-email-pref", async () => {
      const [pref] = await db
        .select()
        .from(portalNotificationPreferences)
        .where(
          and(
            eq(portalNotificationPreferences.portalUserId, data.portalUserId),
            eq(portalNotificationPreferences.type, data.type),
          ),
        )
        .limit(1);
      return !pref || pref.emailEnabled;
    });

    if (emailEnabled) {
      await step.run("send-email", async () => {
        const [user] = await db
          .select({ email: portalUsers.email })
          .from(portalUsers)
          .where(eq(portalUsers.id, data.portalUserId))
          .limit(1);
        if (user) {
          await sendPortalNotificationEmail(user.email, data.title, data.body, data.actionUrl);
        }
      });
    }

    return { type: data.type, portalUserId: data.portalUserId, emailSent: emailEnabled };
  },
);
