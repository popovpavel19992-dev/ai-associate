"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Lightbulb } from "lucide-react";

export type DiffType = "added" | "removed" | "modified" | "unchanged";
export type Impact = "positive" | "negative" | "neutral";

export interface ClauseDiffProps {
  title: string | null;
  diffType: DiffType | null;
  impact: Impact | null;
  description: string | null;
  recommendation: string | null;
}

const BORDER_COLOR: Record<Impact, string> = {
  negative: "border-l-red-500",
  neutral: "border-l-yellow-500",
  positive: "border-l-green-500",
};

const DIFF_TYPE_LABEL: Record<DiffType, string> = {
  added: "Added",
  removed: "Removed",
  modified: "Modified",
  unchanged: "Unchanged",
};

const DIFF_TYPE_VARIANT: Record<DiffType, string> = {
  added: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  removed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  modified: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  unchanged: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const IMPACT_VARIANT: Record<Impact, string> = {
  negative: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  neutral: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  positive: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

export function ClauseDiff({ title, diffType, impact, description, recommendation }: ClauseDiffProps) {
  const borderClass = impact ? BORDER_COLOR[impact] : "border-l-zinc-300";

  return (
    <div className={cn("rounded-lg border border-l-4 bg-card p-4", borderClass)}>
      {/* Header */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{title ?? "Untitled Clause"}</span>
        {diffType && (
          <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium", DIFF_TYPE_VARIANT[diffType])}>
            {DIFF_TYPE_LABEL[diffType]}
          </span>
        )}
        {impact && (
          <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium capitalize", IMPACT_VARIANT[impact])}>
            {impact}
          </span>
        )}
      </div>

      {/* Body */}
      {description && (
        <p className="mb-2 text-sm text-muted-foreground">{description}</p>
      )}

      {/* Footer: AI recommendation */}
      {recommendation && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-purple-50 p-3 dark:bg-purple-950/30">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-purple-500" />
          <p className="text-sm text-purple-700 dark:text-purple-300">{recommendation}</p>
        </div>
      )}
    </div>
  );
}
