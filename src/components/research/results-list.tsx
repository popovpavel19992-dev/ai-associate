"use client";

import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ResultCard, type ResultCardHit } from "./result-card";

interface ResultsListProps {
  hits: ResultCardHit[];
  totalCount: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  bookmarkedIds?: Set<string>;
  onBookmarkToggle?: (internalId: string) => void;
  onPageChange?: (page: number) => void;
  onAskAi?: () => void;
}

export function ResultsList({
  hits,
  totalCount,
  page,
  pageSize,
  loading = false,
  bookmarkedIds,
  onBookmarkToggle,
  onPageChange,
  onAskAi,
}: ResultsListProps) {
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const showPagination =
    typeof onPageChange === "function" && totalCount > pageSize;

  return (
    <div className="space-y-3">
      {hits.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {start}–{end} of {totalCount}
          </p>
          {onAskAi && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAskAi}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Ask AI about results
            </Button>
          )}
        </div>
      )}

      {loading && (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
      )}

      {!loading && hits.length === 0 && (
        <div className="flex min-h-[160px] items-center justify-center rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No results. Try adjusting your query or filters.
          </p>
        </div>
      )}

      {!loading && hits.length > 0 && (
        <ul className="space-y-3">
          {hits.map((hit) => (
            <li key={hit.internalId}>
              <ResultCard
                hit={hit}
                bookmarked={bookmarkedIds?.has(hit.internalId) ?? false}
                onBookmarkToggle={onBookmarkToggle}
              />
            </li>
          ))}
        </ul>
      )}

      {showPagination && !loading && hits.length > 0 && (
        <div
          className={cn(
            "flex items-center justify-between pt-2",
            "text-sm text-muted-foreground",
          )}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => onPageChange?.(page - 1)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Prev
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page * pageSize >= totalCount}
            onClick={() => onPageChange?.(page + 1)}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default ResultsList;
