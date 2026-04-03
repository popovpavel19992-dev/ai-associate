"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { REALTIME_POLL_INTERVAL_MS } from "@/lib/constants";
import type { CaseStatus } from "@/lib/types";

interface RealtimeCaseState {
  status: CaseStatus;
  isConnected: boolean;
}

/**
 * Subscribes to real-time case status changes via Supabase Realtime,
 * with a polling fallback when the WebSocket connection drops.
 */
export function useRealtimeCase(caseId: string, initialStatus: CaseStatus): RealtimeCaseState {
  const [status, setStatus] = useState<CaseStatus>(initialStatus);
  const [isConnected, setIsConnected] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (!caseId) return;

    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`case:${caseId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "cases",
          filter: `id=eq.${caseId}`,
        },
        (payload) => {
          const newStatus = payload.new?.status as CaseStatus | undefined;
          if (newStatus) {
            setStatus(newStatus);
          }
        },
      )
      .subscribe((state) => {
        const connected = state === "SUBSCRIBED";
        setIsConnected(connected);

        // Start polling fallback when disconnected
        if (!connected && !pollRef.current) {
          pollRef.current = setInterval(async () => {
            try {
              const res = await fetch(`/api/case/${caseId}/status`);
              if (res.ok) {
                const data = await res.json();
                setStatus(data.status);
              }
            } catch {
              // Silently ignore polling errors
            }
          }, REALTIME_POLL_INTERVAL_MS);
        }

        // Stop polling when reconnected
        if (connected && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      });

    return () => {
      supabase.removeChannel(channel);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [caseId]);

  return { status, isConnected };
}
