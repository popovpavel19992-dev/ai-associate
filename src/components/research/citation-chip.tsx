"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface CitationChipProps {
  citation: string;
  unverified?: boolean;
  onClick?: () => void;
}

export function CitationChip({
  citation,
  unverified = false,
  onClick,
}: CitationChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        unverified
          ? "This citation wasn't found in the searched opinions"
          : citation
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs transition-colors",
        unverified
          ? "border-yellow-400 bg-yellow-50 text-yellow-900 hover:bg-yellow-100 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200"
          : "border-zinc-300 bg-transparent text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
      )}
    >
      {unverified ? <AlertTriangle className="h-3 w-3" aria-hidden="true" /> : null}
      <span className="truncate">{citation}</span>
    </button>
  );
}
