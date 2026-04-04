"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { REALTIME_POLL_INTERVAL_MS } from "@/lib/constants";
import type { ContractStatus } from "@/lib/types";

interface RealtimeContractState {
  status: ContractStatus;
  isConnected: boolean;
}

/**
 * Subscribes to real-time contract status changes via Supabase Realtime,
 * with a polling fallback when the WebSocket connection drops.
 */
export function useRealtimeContract(contractId: string, initialStatus: ContractStatus): RealtimeContractState {
  const [status, setStatus] = useState<ContractStatus>(initialStatus);
  const [isConnected, setIsConnected] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (!contractId) return;

    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`contract:${contractId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "contracts",
          filter: `id=eq.${contractId}`,
        },
        (payload) => {
          const newStatus = payload.new?.status as ContractStatus | undefined;
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
              const res = await fetch(`/api/contract/${contractId}/status`);
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
  }, [contractId]);

  return { status, isConnected };
}
