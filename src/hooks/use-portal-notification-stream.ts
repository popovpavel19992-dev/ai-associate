"use client";

import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

export function usePortalNotificationStream() {
  const utils = trpc.useUtils();
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;

      try {
        const es = new EventSource("/api/portal/notifications/stream");
        eventSourceRef.current = es;

        es.addEventListener("notification", () => {
          utils.portalNotifications.list.invalidate();
          utils.portalNotifications.getUnreadCount.invalidate();
        });

        es.onerror = () => {
          if (es.readyState === EventSource.CLOSED) {
            startFallbackPolling();
          }
        };

        es.onopen = () => {
          if (fallbackRef.current) {
            clearInterval(fallbackRef.current);
            fallbackRef.current = null;
          }
        };
      } catch {
        startFallbackPolling();
      }
    }

    function startFallbackPolling() {
      if (fallbackRef.current) return;
      fallbackRef.current = setInterval(() => {
        utils.portalNotifications.getUnreadCount.invalidate();
      }, 30_000);
    }

    connect();

    return () => {
      mounted = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (fallbackRef.current) {
        clearInterval(fallbackRef.current);
        fallbackRef.current = null;
      }
    };
  }, [utils]);
}
