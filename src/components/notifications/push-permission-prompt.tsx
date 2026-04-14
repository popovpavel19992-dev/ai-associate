"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushPermissionPrompt() {
  const [permissionState, setPermissionState] = useState<PermissionState>("default");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subscribe = trpc.pushSubscriptions.subscribe.useMutation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermissionState("unsupported");
      return;
    }
    setPermissionState(Notification.permission as PermissionState);
  }, []);

  const handleEnable = async () => {
    setIsRegistering(true);
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission as PermissionState);

      if (permission !== "granted") {
        setIsRegistering(false);
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) throw new Error("VAPID public key not configured");

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const json = subscription.toJSON();
      const keys = json.keys as { p256dh: string; auth: string } | undefined;

      if (!json.endpoint || !keys?.p256dh || !keys?.auth) {
        throw new Error("Invalid push subscription");
      }

      await subscribe.mutateAsync({
        endpoint: json.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable push notifications");
    } finally {
      setIsRegistering(false);
    }
  };

  if (permissionState === "unsupported") return null;
  if (permissionState === "granted") return null;

  return (
    <div className="flex items-start gap-4 rounded-lg border border-zinc-200 bg-muted/30 p-4 dark:border-zinc-800">
      <div className="mt-0.5 rounded-full bg-zinc-100 p-2 dark:bg-zinc-800">
        {permissionState === "denied" ? (
          <BellOff className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Bell className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium">Push Notifications</p>
        {permissionState === "denied" ? (
          <p className="text-xs text-muted-foreground">
            Push notifications are blocked. Enable them in your browser settings to receive alerts.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Enable push notifications to get alerts even when the app is in the background.
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {permissionState !== "denied" && (
        <Button
          size="sm"
          onClick={handleEnable}
          disabled={isRegistering}
        >
          {isRegistering && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Enable
        </Button>
      )}
    </div>
  );
}
