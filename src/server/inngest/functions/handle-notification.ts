import { and, eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { notifications, notificationSignals } from "../../db/schema/notifications";
import { notificationPreferences } from "../../db/schema/notification-preferences";
import { notificationMutes } from "../../db/schema/notification-mutes";
import { pushSubscriptions } from "../../db/schema/push-subscriptions";
import { users } from "../../db/schema/users";
import { sendPushNotification } from "../../services/push";
import {
  sendEmail,
  sendCaseReadyEmail,
  sendDocumentFailedEmail,
  sendCreditsLowEmail,
  sendCreditsExhaustedEmail,
  sendStageChangedEmail,
  sendTaskAssignedEmail,
  sendTaskOverdueEmail,
  sendInvoiceSentEmail,
  sendInvoicePaidEmail,
  sendInvoiceOverdueEmail,
  sendEventReminderEmail,
  sendTeamMemberInvitedEmail,
  sendTeamMemberJoinedEmail,
  sendAddedToCaseEmail,
  sendTaskCompletedEmail,
  sendCalendarSyncFailedEmail,
} from "../../services/email";
import type { NotificationSendEvent, NotificationType } from "@/lib/notification-types";

async function dispatchEmail(
  userEmail: string,
  type: NotificationType,
  event: NotificationSendEvent,
) {
  const m = event.metadata as Record<string, unknown> | undefined;

  switch (type) {
    case "case_ready":
      await sendCaseReadyEmail(userEmail, (m?.caseName as string) ?? "", event.caseId ?? "");
      break;
    case "document_failed":
      await sendDocumentFailedEmail(
        userEmail,
        (m?.caseName as string) ?? "",
        (m?.documentName as string) ?? "",
        event.caseId ?? "",
      );
      break;
    case "credits_low":
      await sendCreditsLowEmail(
        userEmail,
        (m?.creditsUsed as number) ?? 0,
        (m?.creditsLimit as number) ?? 0,
      );
      break;
    case "credits_exhausted":
      await sendCreditsExhaustedEmail(userEmail);
      break;
    case "stage_changed":
      await sendStageChangedEmail(
        userEmail,
        (m?.caseName as string) ?? "",
        (m?.fromStage as string) ?? "",
        (m?.toStage as string) ?? "",
        event.caseId ?? "",
      );
      break;
    case "task_assigned":
      await sendTaskAssignedEmail(
        userEmail,
        (m?.taskTitle as string) ?? "",
        (m?.caseName as string) ?? "",
        event.caseId ?? "",
      );
      break;
    case "task_overdue":
      await sendTaskOverdueEmail(
        userEmail,
        (m?.taskTitle as string) ?? "",
        (m?.caseName as string) ?? "",
        event.caseId ?? "",
      );
      break;
    case "invoice_sent":
      await sendInvoiceSentEmail(
        userEmail,
        (m?.invoiceNumber as string) ?? "",
        (m?.clientName as string) ?? "",
        (m?.amount as string) ?? "",
      );
      break;
    case "invoice_paid":
      await sendInvoicePaidEmail(
        userEmail,
        (m?.invoiceNumber as string) ?? "",
        (m?.clientName as string) ?? "",
        (m?.amount as string) ?? "",
      );
      break;
    case "invoice_overdue":
      await sendInvoiceOverdueEmail(
        userEmail,
        (m?.invoiceNumber as string) ?? "",
        (m?.clientName as string) ?? "",
        (m?.amount as string) ?? "",
        (m?.dueDate as string) ?? "",
      );
      break;
    case "event_reminder":
      await sendEventReminderEmail(
        userEmail,
        (m?.eventTitle as string) ?? "",
        (m?.startTime as string) ?? "",
        (m?.minutesBefore as number) ?? 0,
      );
      break;
    case "team_member_invited":
      await sendTeamMemberInvitedEmail(
        userEmail,
        (m?.inviterName as string) ?? "",
        (m?.orgName as string) ?? "",
      );
      break;
    case "team_member_joined":
      await sendTeamMemberJoinedEmail(userEmail, (m?.memberName as string) ?? "");
      break;
    case "added_to_case":
      await sendAddedToCaseEmail(
        userEmail,
        (m?.caseName as string) ?? "",
        (m?.addedBy as string) ?? "",
        event.caseId ?? "",
      );
      break;
    case "task_completed":
      await sendTaskCompletedEmail(
        userEmail,
        (m?.taskTitle as string) ?? "",
        (m?.caseName as string) ?? "",
        (m?.completedBy as string) ?? "",
        event.caseId ?? "",
      );
      break;
    case "calendar_sync_failed":
      await sendCalendarSyncFailedEmail(userEmail, (m?.providerName as string) ?? "");
      break;
    case "research_memo_ready": {
      const memoId = (m?.memoId as string) ?? "";
      const title = (m?.title as string) ?? "";
      await sendEmail({
        to: userEmail,
        subject: `Memo ready: ${title}`,
        html: `<p>Your IRAC memo "${title}" is ready.</p><p><a href="/research/memos/${memoId}">Open memo</a></p>`,
      });
      break;
    }
    case "research_memo_failed": {
      const memoId = (m?.memoId as string) ?? "";
      const title = (m?.title as string) ?? "";
      const errorMessage = (m?.errorMessage as string) ?? "Unknown error";
      await sendEmail({
        to: userEmail,
        subject: `Memo generation failed: ${title}`,
        html: `<p>We couldn't generate your IRAC memo "${title}". Credits have been refunded.</p><p>Reason: ${errorMessage.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p><p><a href="/research/memos/${memoId}">View details</a></p>`,
      });
      break;
    }
    case "research_collection_shared": {
      const collectionId = (m?.collectionId as string) ?? "";
      const name = (m?.name as string) ?? "";
      const sharerName = (m?.sharerName as string) ?? "";
      const safeName = name.replace(/[<>&]/g, "");
      const safeSharerName = sharerName.replace(/[<>&]/g, "");
      await sendEmail({
        to: userEmail,
        subject: `${sharerName} shared a collection: ${name}`,
        html: `<p>${safeSharerName} shared the collection "${safeName}" with you.</p><p><a href="/research/collections/${collectionId}">Open collection</a></p>`,
      });
      break;
    }
    default:
      console.warn("[handle-notification] No email template for type:", type);
  }
}

export const handleNotification = inngest.createFunction(
  {
    id: "handle-notification",
    retries: 2,
    triggers: [{ event: "notification/send" }],
  },
  async ({ event, step }) => {
    const data = event.data as NotificationSendEvent;

    // Email-only path: team_member_invited with no userId
    if (data.type === "team_member_invited" && !data.userId && data.recipientEmail) {
      await step.run("send-invite-email", async () => {
        await dispatchEmail(data.recipientEmail!, data.type, data);
      });
      return { type: data.type, channels: ["email"] };
    }

    if (!data.userId) {
      console.warn("[handle-notification] No userId and not an email-only event, skipping");
      return { skipped: true };
    }

    const userId = data.userId;

    // Load user preferences for this notification type
    const prefs = await step.run("load-preferences", async () => {
      return db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.notificationType, data.type),
          ),
        );
    });

    // Build channel enablement map (default: all enabled if no row exists)
    const channelEnabled = (channel: string): boolean => {
      const pref = prefs.find((p) => p.channel === channel);
      return pref === undefined ? true : pref.enabled;
    };

    // Check case mute (only relevant if caseId present)
    const isMuted = await step.run("check-case-mute", async () => {
      if (!data.caseId) return false;
      const [mute] = await db
        .select()
        .from(notificationMutes)
        .where(
          and(
            eq(notificationMutes.userId, userId),
            eq(notificationMutes.caseId, data.caseId),
          ),
        )
        .limit(1);
      return !!mute;
    });

    if (isMuted) {
      return { type: data.type, skipped: true, reason: "case_muted" };
    }

    const channels: string[] = [];

    // In-app: insert notification + upsert signal
    if (channelEnabled("in_app")) {
      await step.run("send-in-app", async () => {
        await db.insert(notifications).values({
          userId,
          orgId: data.orgId ?? null,
          type: data.type,
          title: data.title,
          body: data.body,
          caseId: data.caseId ?? null,
          actionUrl: data.actionUrl ?? null,
          dedupKey: data.dedupKey ?? null,
        }).onConflictDoNothing();

        // Upsert signal row to wake SSE listeners
        await db
          .insert(notificationSignals)
          .values({ userId, lastSignalAt: new Date() })
          .onConflictDoUpdate({
            target: notificationSignals.userId,
            set: { lastSignalAt: new Date() },
          });
      });
      channels.push("in_app");
    }

    // Email: look up user email and send
    if (channelEnabled("email")) {
      const userEmail = await step.run("lookup-user-email", async () => {
        const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        return u?.email ?? null;
      });

      if (userEmail) {
        await step.run("send-email", async () => {
          await dispatchEmail(userEmail, data.type, data);
        });
        channels.push("email");
      }
    }

    // Push: send to all subscriptions, cleanup gone ones
    if (channelEnabled("push")) {
      const subs = await step.run("load-push-subscriptions", async () => {
        return db
          .select()
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, userId));
      });

      if (subs.length > 0) {
        await step.run("send-push", async () => {
          const goneIds: string[] = [];
          await Promise.all(
            subs.map(async (sub) => {
              const result = await sendPushNotification(
                { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
                {
                  title: data.title,
                  body: data.body,
                  url: data.actionUrl ?? undefined,
                },
              );
              if (result.gone) {
                goneIds.push(sub.id);
              }
            }),
          );

          // Cleanup expired subscriptions
          if (goneIds.length > 0) {
            await Promise.all(
              goneIds.map((id) =>
                db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id)),
              ),
            );
          }
        });
        channels.push("push");
      }
    }

    return { type: data.type, userId, channels };
  },
);
