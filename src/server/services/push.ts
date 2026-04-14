import webpush from "web-push";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID keys not set, push notifications disabled");
    return;
  }
  webpush.setVapidDetails("mailto:notifications@clearterms.ai", publicKey, privateKey);
  initialized = true;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
}

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<{ success: boolean; gone?: boolean }> {
  ensureInit();
  if (!initialized) return { success: false };

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon ?? "/icon-192.png",
        data: { url: payload.url },
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
