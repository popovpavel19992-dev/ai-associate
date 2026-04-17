"use client";

import { useState } from "react";
import { Copy, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";

interface OpinionHeaderProps {
  opinion: {
    id: string;
    caseName: string;
    citationBluebook: string;
    court: string;
    decisionDate: string;
    jurisdiction: string;
    courtLevel: string;
    metadata?: {
      judges?: string[];
      syllabusUrl?: string;
      citedByCount?: number;
    } | null;
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function OpinionHeader({ opinion }: OpinionHeaderProps) {
  const [bookmarked, setBookmarked] = useState(false);
  const bookmarkMutation = trpc.research.bookmarks.create.useMutation({
    onSuccess: () => {
      setBookmarked(true);
      toast.success("Bookmarked");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const copyCitation = async () => {
    try {
      await navigator.clipboard.writeText(opinion.citationBluebook);
      toast.success("Citation copied");
    } catch {
      toast.error("Could not copy citation");
    }
  };

  const judges = opinion.metadata?.judges;

  return (
    <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">{opinion.caseName}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (bookmarked || bookmarkMutation.isPending) return;
              bookmarkMutation.mutate({ opinionId: opinion.id });
            }}
            aria-pressed={bookmarked}
            aria-label="Bookmark opinion"
          >
            <Star
              className={
                bookmarked
                  ? "mr-1 h-4 w-4 fill-yellow-400 text-yellow-400"
                  : "mr-1 h-4 w-4"
              }
            />
            {bookmarked ? "Bookmarked" : "Bookmark"}
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
        <button
          type="button"
          onClick={copyCitation}
          className="inline-flex items-center gap-1 rounded hover:text-foreground"
          aria-label="Copy Bluebook citation"
        >
          <span className="font-medium">{opinion.citationBluebook}</span>
          <Copy className="h-3.5 w-3.5" />
        </button>
        <span aria-hidden="true">&middot;</span>
        <span>{opinion.court}</span>
        <span aria-hidden="true">&middot;</span>
        <span>{formatDate(opinion.decisionDate)}</span>
        {judges && judges.length > 0 ? (
          <>
            <span aria-hidden="true">&middot;</span>
            <span>{judges.join(", ")}</span>
          </>
        ) : null}
      </div>
    </header>
  );
}
