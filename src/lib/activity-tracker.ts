// src/lib/activity-tracker.ts
//
// Phase 3.9 — page-level activity tracker. Mounts a single open event
// when the component mounts, sends a heartbeat every minute while the
// page is visible, and closes the event with the final duration on
// unmount.

"use client";

import { useEffect, useRef } from "react";
import { trpc } from "./trpc";
import type { ActivityEventType } from "@/server/db/schema/case-activity-events";

/** How often to push a duration update while the page is visible. */
export const HEARTBEAT_INTERVAL_MS = 60_000;

export function useActivityTracker(
  caseId: string | null,
  eventType: ActivityEventType,
  metadata?: Record<string, unknown>,
) {
  const logStart = trpc.activityTracking.logStart.useMutation();
  const logEnd = trpc.activityTracking.logEnd.useMutation();

  const eventIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const accumulatedSecRef = useRef<number>(0);
  const lastVisibleAtRef = useRef<number>(Date.now());
  const visibleRef = useRef<boolean>(true);

  // Stable JSON stringification of metadata for the dep array.
  const metadataKey = metadata ? JSON.stringify(metadata) : "";

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;

    const contextUrl =
      typeof window !== "undefined" ? window.location.pathname : undefined;

    startedAtRef.current = Date.now();
    accumulatedSecRef.current = 0;
    lastVisibleAtRef.current = Date.now();
    visibleRef.current =
      typeof document !== "undefined" ? !document.hidden : true;

    logStart
      .mutateAsync({
        caseId,
        eventType,
        metadata: metadata ?? undefined,
        contextUrl,
      })
      .then((res) => {
        if (cancelled) return;
        eventIdRef.current = res.eventId;
      })
      .catch(() => {
        // Tracker is best-effort; never throw to the page.
      });

    const tick = () => {
      if (visibleRef.current) {
        const now = Date.now();
        accumulatedSecRef.current += Math.round(
          (now - lastVisibleAtRef.current) / 1000,
        );
        lastVisibleAtRef.current = now;
      }
      const eventId = eventIdRef.current;
      if (eventId) {
        logEnd
          .mutateAsync({
            eventId,
            durationSeconds: Math.min(accumulatedSecRef.current, 14400),
          })
          .catch(() => {});
      }
    };

    const heartbeat = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        // close the visible window
        if (visibleRef.current) {
          accumulatedSecRef.current += Math.round(
            (Date.now() - lastVisibleAtRef.current) / 1000,
          );
          visibleRef.current = false;
        }
      } else {
        // open a new visible window
        lastVisibleAtRef.current = Date.now();
        visibleRef.current = true;
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      // Final flush
      if (visibleRef.current) {
        accumulatedSecRef.current += Math.round(
          (Date.now() - lastVisibleAtRef.current) / 1000,
        );
      }
      const eventId = eventIdRef.current;
      if (eventId) {
        logEnd
          .mutateAsync({
            eventId,
            durationSeconds: Math.min(accumulatedSecRef.current, 14400),
          })
          .catch(() => {});
      }
      eventIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, eventType, metadataKey]);
}
