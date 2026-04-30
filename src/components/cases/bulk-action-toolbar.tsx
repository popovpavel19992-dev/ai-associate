"use client";

// src/components/cases/bulk-action-toolbar.tsx
// Phase 3.15 — Sticky toolbar shown on the cases list while ≥1 case is selected.

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export interface BulkActionToolbarProps {
  count: number;
  onClear: () => void;
  onArchive: () => void;
  onReassign: () => void;
  onExport: () => void;
  busyAction: "archive" | "reassign" | "export" | null;
}

export function BulkActionToolbar({
  count,
  onClear,
  onArchive,
  onReassign,
  onExport,
  busyAction,
}: BulkActionToolbarProps) {
  const disabled = busyAction !== null;
  return (
    <div
      role="toolbar"
      aria-label="Bulk case actions"
      className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-3 rounded-md border border-zinc-700 bg-zinc-900/95 px-4 py-2 shadow backdrop-blur"
    >
      <span className="text-sm font-medium text-zinc-100">{count} selected</span>
      <button
        type="button"
        className="text-xs text-zinc-400 underline-offset-2 hover:underline"
        onClick={onClear}
      >
        Clear
      </button>
      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onArchive}
          disabled={disabled}
        >
          {busyAction === "archive" && (
            <Loader2 className="mr-1 size-3 animate-spin" />
          )}
          Archive
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onReassign}
          disabled={disabled}
        >
          {busyAction === "reassign" && (
            <Loader2 className="mr-1 size-3 animate-spin" />
          )}
          Reassign Lead…
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onExport}
          disabled={disabled}
        >
          {busyAction === "export" && (
            <Loader2 className="mr-1 size-3 animate-spin" />
          )}
          Export CSV
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear} disabled={disabled}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
