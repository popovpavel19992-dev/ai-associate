"use client";

import { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ActivityBadge } from "./activity-badge";
import { Button } from "@/components/ui/button";

interface TimerBannerProps {
  caseId: string;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function TimerBanner({ caseId }: TimerBannerProps) {
  const utils = trpc.useUtils();
  const { data } = trpc.timeEntries.getRunningTimer.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const [elapsed, setElapsed] = useState(0);

  const stopTimer = trpc.timeEntries.stopTimer.useMutation({
    onSuccess: () => {
      utils.timeEntries.getRunningTimer.invalidate();
      utils.timeEntries.list.invalidate({ caseId });
      toast.success("Timer stopped");
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (!data?.entry?.timerStartedAt) {
      setElapsed(0);
      return;
    }
    const update = () => {
      const diff = Math.floor(
        (Date.now() - new Date(data.entry.timerStartedAt!).getTime()) / 1000,
      );
      setElapsed(Math.max(0, diff));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [data?.entry?.timerStartedAt]);

  // Only show when timer belongs to this case
  if (!data || data.entry.caseId !== caseId) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-3">
      <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
      <ActivityBadge type={data.entry.activityType} />
      {data.entry.description && (
        <span className="flex-1 truncate text-sm text-zinc-300">{data.entry.description}</span>
      )}
      <span className="font-mono text-sm font-medium text-amber-300">{formatElapsed(elapsed)}</span>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-700 text-amber-300 hover:bg-amber-900/50"
        onClick={() => stopTimer.mutate({ id: data.entry.id })}
        disabled={stopTimer.isPending}
      >
        <Square className="mr-1.5 h-3 w-3" />
        Stop
      </Button>
    </div>
  );
}
