"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StatuteHeaderProps {
  statute: {
    id: string;
    source: "usc" | "cfr";
    title: string;
    section: string;
    citationBluebook: string;
    heading: string | null;
    effectiveDate: string | null;
  };
}

function formatEffectiveDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
  return `Effective: ${formatted}`;
}

export function StatuteHeader({ statute }: StatuteHeaderProps) {
  const copyCitation = async () => {
    try {
      await navigator.clipboard.writeText(statute.citationBluebook);
      toast.success("Citation copied");
    } catch {
      toast.error("Could not copy citation");
    }
  };

  const effective = formatEffectiveDate(statute.effectiveDate);
  const sourceLabel = statute.source === "usc" ? "USC" : "CFR";

  return (
    <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">{statute.citationBluebook}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={copyCitation}
            aria-label="Copy Bluebook citation"
          >
            <Copy className="mr-1 h-4 w-4" />
            Copy citation
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
            >
              Attach to case...
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Select a case</DropdownMenuLabel>
              <DropdownMenuItem disabled>
                (Case linking coming soon)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span
          className="inline-flex items-center rounded border border-zinc-300 px-1.5 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          aria-label={`Source: ${sourceLabel}`}
        >
          {sourceLabel}
        </span>
        {statute.heading ? (
          <>
            <span aria-hidden="true">&middot;</span>
            <span>{statute.heading}</span>
          </>
        ) : null}
        {effective ? (
          <>
            <span aria-hidden="true">&middot;</span>
            <span>{effective}</span>
          </>
        ) : null}
      </div>
    </header>
  );
}
