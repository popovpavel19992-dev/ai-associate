// src/components/research/collection-tag-filter-rail.tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

interface CollectionTagFilterRailProps {
  items: Array<{ id: string; tags: string[] }>;
  selected: Set<string>;
  onToggle: (tag: string) => void;
  onClear: () => void;
}

export function CollectionTagFilterRail({ items, selected, onToggle, onClear }: CollectionTagFilterRailProps) {
  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const item of items) {
      for (const t of item.tags) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  return (
    <div className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase text-muted-foreground">Tags</h3>
        {selected.size > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear} className="h-auto p-0 text-xs">
            Clear
          </Button>
        )}
      </div>
      {counts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tags yet</p>
      ) : (
        <ul className="space-y-1">
          {counts.map(([tag, n]) => {
            const on = selected.has(tag);
            return (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => onToggle(tag)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs ${
                    on ? "bg-primary text-primary-foreground" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  }`}
                  aria-pressed={on}
                >
                  <span className="truncate">{tag}</span>
                  <span className="ml-2 text-xs opacity-70">{n}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
