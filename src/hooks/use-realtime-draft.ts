"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { REALTIME_POLL_INTERVAL_MS } from "@/lib/constants";
import type { DraftStatus } from "@/lib/types";

interface RealtimeDraftState {
  status: DraftStatus;
  isConnected: boolean;
}

/**
 * Subscribes to real-time draft status changes via Supabase Realtime,
 * with a polling fallback when the WebSocket connection drops.
 */
export function useRealtimeDraft(draftId: string, initialStatus: DraftStatus): RealtimeDraftState {
  const [status, setStatus] = useState<DraftStatus>(initialStatus);
  const [isConnected, setIsConnected] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (!draftId) return;

    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`draft:${draftId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "contract_drafts",
          filter: `id=eq.${draftId}`,
        },
        (payload) => {
          const newStatus = payload.new?.status as DraftStatus | undefined;
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
              const res = await fetch(`/api/draft/${draftId}/status`);
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
  }, [draftId]);

  return { status, isConnected };
}
