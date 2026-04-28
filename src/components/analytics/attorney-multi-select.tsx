"use client";

import { useMemo } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

export interface AttorneyOption {
  userId: string;
  userName: string;
  userEmail: string;
}

export function AttorneyMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: AttorneyOption[];
  selected: string[]; // userIds
  onChange: (next: string[]) => void;
}) {
  const allSelected = selected.length === 0 || selected.length === options.length;
  const label = useMemo(() => {
    if (allSelected) return `All attorneys (${options.length})`;
    if (selected.length === 1) {
      const u = options.find((o) => o.userId === selected[0]);
      return u?.userName ?? "1 attorney";
    }
    return `${selected.length} attorneys`;
  }, [allSelected, options, selected]);

  const toggle = (userId: string) => {
    if (selected.includes(userId)) {
      onChange(selected.filter((id) => id !== userId));
    } else {
      onChange([...selected, userId]);
    }
  };

  const selectAll = () => onChange(options.map((o) => o.userId));
  const clearAll = () => onChange([]);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2">
            <span>{label}</span>
            <ChevronDown className="h-4 w-4 opacity-60" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
          <button
            type="button"
            className="text-indigo-600 hover:underline disabled:opacity-50"
            onClick={selectAll}
            disabled={selected.length === options.length}
          >
            Select all
          </button>
          <button
            type="button"
            className="text-zinc-600 hover:underline disabled:opacity-50 dark:text-zinc-400"
            onClick={clearAll}
            disabled={selected.length === 0}
          >
            Clear
          </button>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-zinc-500">No attorneys</li>
          ) : (
            options.map((o) => {
              const checked = selected.includes(o.userId);
              return (
                <li key={o.userId}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={checked}
                      onChange={() => toggle(o.userId)}
                    />
                    <span className="flex-1 truncate">{o.userName}</span>
                    <span className="truncate text-xs text-zinc-500">{o.userEmail}</span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
