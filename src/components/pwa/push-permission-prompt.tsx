"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const DISMISSED_KEY = "clearterms.pwa.push-dismissed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof atob !== "undefined" ? atob(base64) : "";
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Banner that asks for notification permission and registers a push
 * subscription with the server. Only renders when the browser supports push,
 * permission is currently 'default', and the user hasn't dismissed it.
 */
export function PushPermissionPrompt() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const subscribeMut = trpc.pushSubscriptions.subscribe.useMutation();
  const vapidQuery = trpc.pushSubscriptions.getVapidPublicKey.useQuery(undefined, {
    staleTime: Infinity,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }
    setSupported(true);
    setPermission(Notification.permission);
    try {
      if (localStorage.getItem(DISMISSED_KEY) === "1") setDismissed(true);
    } catch {
      // ignore
    }
  }, []);

  if (!supported) return null;
  if (permission !== "default") return null;
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
  };

  const handleEnable = async () => {
    setBusy(true);
    try {
      const publicKey =
        vapidQuery.data?.publicKey || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        toast.error("Push notifications aren't configured on this server yet.");
        dismiss();
        return;
      }

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        if (perm === "denied") dismiss();
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const json = sub.toJSON();
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      const endpoint = json.endpoint ?? sub.endpoint;
      if (!p256dh || !auth || !endpoint) {
        toast.error("Failed to read push subscription keys.");
        return;
      }

      await subscribeMut.mutateAsync({
        endpoint,
        p256dh,
        auth,
        userAgent: navigator.userAgent.slice(0, 512),
      });

      toast.success("Notifications enabled on this device.");
      dismiss();
    } catch (err) {
      console.error("[push] subscribe failed", err);
      toast.error("Couldn't enable notifications. Try again later.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative rounded-lg border bg-card p-4 shadow-sm">
      <button
        type="button"
        aria-label="Dismiss notifications prompt"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-accent"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <Bell className="mt-1 h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1 space-y-2">
          <div>
            <p className="font-medium">Turn on push notifications</p>
            <p className="text-sm text-muted-foreground">
              Get alerted on this device when new case messages, deadlines, and
              filing updates arrive.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleEnable} disabled={busy}>
              {busy ? "Enabling…" : "Enable notifications"}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
