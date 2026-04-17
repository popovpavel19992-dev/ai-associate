"use client";

import * as React from "react";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";

import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

interface UsageIndicatorProps {
  className?: string;
}

function indicatorColor(percent: number): string {
  if (percent >= 100) return "bg-red-500";
  if (percent >= 80) return "bg-yellow-500";
  return "bg-zinc-500";
}

export function UsageIndicator({ className }: UsageIndicatorProps) {
  const { data, isLoading } = trpc.research.getUsage.useQuery();

  if (isLoading || !data) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        Loading usage…
      </span>
    );
  }

  const { used, limit } = data;

  // Business tier (limit >= 1000): show only the counter.
  if (limit >= 1000) {
    return (
      <span
        className={cn(
          "text-xs font-medium tabular-nums text-muted-foreground",
          className,
        )}
      >
        Used {used} queries this month
      </span>
    );
  }

  const percent =
    limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const barColor = indicatorColor(percent);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <ProgressPrimitive.Root
        value={percent}
        data-slot="progress"
        className="flex w-40 items-center"
      >
        <ProgressPrimitive.Track
          className="relative flex h-1.5 w-full items-center overflow-x-hidden rounded-full bg-muted"
          data-slot="progress-track"
        >
          <ProgressPrimitive.Indicator
            data-slot="progress-indicator"
            className={cn("h-full transition-all", barColor)}
          />
        </ProgressPrimitive.Track>
      </ProgressPrimitive.Root>
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        <span className="font-medium text-foreground">
          {used} / {limit}
        </span>{" "}
        Q&amp;A used this month
      </span>
    </div>
  );
}
