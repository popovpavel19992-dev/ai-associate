"use client";

import { cn } from "@/lib/utils";

interface UsageBarProps {
  used: number;
  limit: number | null;
  className?: string;
}

export function UsageBar({ used, limit, className }: UsageBarProps) {
  if (limit === null) {
    return (
      <div className={cn("text-xs text-muted-foreground", className)}>
        <span className="font-medium">{used}</span> credits used (unlimited)
      </div>
    );
  }

  const pct = Math.min((used / limit) * 100, 100);
  const color =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-green-500";

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Credits</span>
        <span>
          {used}/{limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
