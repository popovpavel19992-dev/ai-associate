// src/server/services/push.ts
import webpush from "web-push";
import { and, eq } from "drizzle-orm";
import { pushSubscriptions } from "@/server/db/schema/push-subscriptions";
import type { Database } from "@/server/db";

let initialized = false;

function ensureInit(): boolean {
  if (initialized) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:notifications@clearterms.ai";
  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID keys not set, push notifications disabled");
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  initialized = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tag?: string;
}

/**
 * Send to a single subscription. Returns gone=true on 404/410 so the caller
 * can mark the subscription inactive.
 */
export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<{ success: boolean; gone?: boolean }> {
  if (!ensureInit()) return { success: false };

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon ?? "/icons/icon-192.png",
        url: payload.url,
        tag: payload.tag,
      }),
    );
    return { success: true };
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 410 || statusCode === 404) {
      return { success: false, gone: true };
    }
    console.error("[push] Failed to send:", error);
    return { success: false };
  }
}

/**
 * Fan out a payload to every active subscription belonging to a user.
 * Marks 410/404 endpoints inactive. Returns counters for telemetry.
 */
export async function sendNotificationToUser(
  db: Database,
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; deactivated: number }> {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.isActive, true),
      ),
    );

  if (subs.length === 0) return { sent: 0, failed: 0, deactivated: 0 };

  let sent = 0;
  let failed = 0;
  const goneIds: string[] = [];
  const successIds: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      const result = await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload,
      );
      if (result.success) {
        sent++;
        successIds.push(sub.id);
      } else if (result.gone) {
        goneIds.push(sub.id);
      } else {
        failed++;
      }
    }),
  );

  if (goneIds.length > 0) {
    await Promise.all(
      goneIds.map((id) =>
        db
          .update(pushSubscriptions)
          .set({ isActive: false })
          .where(eq(pushSubscriptions.id, id)),
      ),
    );
  }
  if (successIds.length > 0) {
    const now = new Date();
    await Promise.all(
      successIds.map((id) =>
        db
          .update(pushSubscriptions)
          .set({ lastUsedAt: now })
          .where(eq(pushSubscriptions.id, id)),
      ),
    );
  }

  return { sent, failed, deactivated: goneIds.length };
}

/** Public-facing helper to surface VAPID public key to client subscribe flow. */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}
