"use client";

import { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TimerIndicator() {
  const utils = trpc.useUtils();
  const { data } = trpc.timeEntries.getRunningTimer.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const [elapsed, setElapsed] = useState(0);

  const stopTimer = trpc.timeEntries.stopTimer.useMutation({
    onSuccess: () => {
      utils.timeEntries.getRunningTimer.invalidate();
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

  if (!data) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-amber-700/50 bg-amber-950/40 px-2 py-1">
      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
      <span className="max-w-[80px] truncate text-xs text-zinc-300">{data.caseName}</span>
      <span className="font-mono text-xs font-medium text-amber-300">{formatElapsed(elapsed)}</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-5 w-5 p-0 text-amber-300 hover:bg-amber-900/50 hover:text-amber-200"
        onClick={() => stopTimer.mutate({ id: data.entry.id })}
        disabled={stopTimer.isPending}
      >
        <Square className="h-3 w-3" />
      </Button>
    </div>
  );
}
