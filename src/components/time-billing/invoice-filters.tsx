"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const STATUS_OPTIONS = [
  { label: "All", value: undefined },
  { label: "Draft", value: "draft" },
  { label: "Sent", value: "sent" },
  { label: "Overdue", value: "overdue" },
  { label: "Paid", value: "paid" },
] as const;

interface InvoiceFiltersProps {
  status: string | undefined;
  onStatusChange: (s: string | undefined) => void;
  search?: string;
  onSearchChange?: (s: string) => void;
}

export function InvoiceFilters({
  status,
  onStatusChange,
  search = "",
  onSearchChange,
}: InvoiceFiltersProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            onClick={() => onStatusChange(opt.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              status === opt.value
                ? "bg-zinc-700 text-zinc-50"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {onSearchChange && (
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search invoices…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-8 text-sm bg-zinc-900 border-zinc-800 text-zinc-300 placeholder:text-zinc-600"
          />
        </div>
      )}
    </div>
  );
}
