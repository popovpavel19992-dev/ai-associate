"use client";

import Link from "next/link";
import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AddToCollectionMenu } from "@/components/research/add-to-collection-menu";

export interface ResultCardHit {
  internalId: string;
  caseName: string;
  court: string;
  jurisdiction: string;
  courtLevel: string;
  decisionDate: string;
  citationBluebook: string;
  snippet: string;
}

interface ResultCardProps {
  hit: ResultCardHit;
  bookmarked?: boolean;
  onBookmarkToggle?: (internalId: string) => void;
}

function formatYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return String(d.getFullYear());
}

export function ResultCard({
  hit,
  bookmarked = false,
  onBookmarkToggle,
}: ResultCardProps) {
  const handleBookmark = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onBookmarkToggle?.(hit.internalId);
  };

  return (
    <Link
      href={`/research/opinions/${hit.internalId}`}
      className={cn(
        "group block rounded-xl bg-card p-4 text-sm text-card-foreground",
        "ring-1 ring-foreground/10 transition hover:ring-foreground/20",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading text-base font-medium leading-snug">
          {hit.caseName}
        </h3>
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <AddToCollectionMenu itemType="opinion" itemId={hit.internalId} size="sm" />
          <button
            type="button"
            aria-label={bookmarked ? "Remove bookmark" : "Add bookmark"}
            aria-pressed={bookmarked}
            onClick={handleBookmark}
            className={cn(
              "rounded-md p-1 text-muted-foreground transition",
              "hover:bg-muted hover:text-foreground",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              bookmarked && "text-yellow-500 hover:text-yellow-600",
            )}
          >
            <Star
              className="h-4 w-4"
              fill={bookmarked ? "currentColor" : "none"}
              strokeWidth={2}
            />
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-mono uppercase">
          {hit.court}
        </Badge>
        <span aria-hidden="true">·</span>
        <span>{formatYear(hit.decisionDate)}</span>
      </div>

      <p className="mt-2 font-mono text-xs text-muted-foreground">
        {hit.citationBluebook}
      </p>

      <p className="mt-2 line-clamp-2 text-sm text-foreground/80">
        {hit.snippet}
      </p>
    </Link>
  );
}

export default ResultCard;
