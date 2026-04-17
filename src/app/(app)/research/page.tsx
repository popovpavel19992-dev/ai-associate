"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/trpc/root";

import { SearchBar } from "@/components/research/search-bar";
import { FilterDrawer } from "@/components/research/filter-drawer";
import { FilterChips } from "@/components/research/filter-chips";
import { ResultsList } from "@/components/research/results-list";
import type { ResearchFilters } from "@/components/research/filter-types";

type SearchResponse = inferRouterOutputs<AppRouter>["research"]["search"];

function countActiveFilters(f: ResearchFilters): number {
  return (
    (f.jurisdictions?.length ?? 0) +
    (f.courtLevels?.length ?? 0) +
    (f.fromYear ? 1 : 0) +
    (f.toYear ? 1 : 0) +
    (f.courtName ? 1 : 0)
  );
}

export default function ResearchPage() {
  const [query, setQuery] = React.useState("");
  const [filters, setFilters] = React.useState<ResearchFilters>({});
  const [page, setPage] = React.useState(1);
  const [sessionId, setSessionId] = React.useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [response, setResponse] = React.useState<SearchResponse | null>(null);
  const [bookmarkedIds, setBookmarkedIds] = React.useState<Set<string>>(new Set());

  const searchMut = trpc.research.search.useMutation({
    onSuccess: (result) => {
      setResponse(result);
      setSessionId(result.sessionId);
    },
  });

  const bookmarkMut = trpc.research.bookmarks.create.useMutation({
    onSuccess: (_, vars) => {
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        next.add(vars.opinionId);
        return next;
      });
      toast.success("Bookmarked");
    },
    onError: (err) => toast.error(err.message),
  });

  const runSearch = (nextPage: number) => {
    if (query.trim().length < 2) return;
    setPage(nextPage);
    searchMut.mutate({
      query: query.trim(),
      filters: Object.keys(filters).length ? filters : undefined,
      page: nextPage,
      sessionId,
    });
  };

  const removeFilter = (key: keyof ResearchFilters, value?: string) => {
    setFilters((prev) => {
      const next: ResearchFilters = { ...prev };
      if (key === "jurisdictions" && value) {
        next.jurisdictions = prev.jurisdictions?.filter((j) => j !== value);
        if (!next.jurisdictions?.length) delete next.jurisdictions;
      } else if (key === "courtLevels" && value) {
        next.courtLevels = prev.courtLevels?.filter((c) => c !== value);
        if (!next.courtLevels?.length) delete next.courtLevels;
      } else if (key === "fromYear") {
        delete next.fromYear;
        delete next.toYear;
      } else if (key === "courtName") {
        delete next.courtName;
      }
      return next;
    });
  };

  const handleBookmarkToggle = (internalId: string) => {
    if (bookmarkedIds.has(internalId)) return;
    bookmarkMut.mutate({ opinionId: internalId });
  };

  const activeFilterCount = countActiveFilters(filters);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Legal Research
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Search U.S. federal and state case law, then ask AI for grounded analysis.
      </p>

      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-muted-foreground dark:border-zinc-800 dark:bg-zinc-900/50">
        ClearTerms Research provides case-law analysis, not legal advice.
      </div>

      <div className="mt-6 flex items-center gap-2">
        <SearchBar
          value={query}
          onChange={setQuery}
          onSubmit={() => runSearch(1)}
          loading={searchMut.isPending}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => setDrawerOpen(true)}
        >
          <SlidersHorizontal className="mr-2 size-4" aria-hidden />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {activeFilterCount > 0 && (
        <div className="mt-3">
          <FilterChips filters={filters} onRemove={removeFilter} />
        </div>
      )}

      {searchMut.isError && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Error: {searchMut.error.message}
        </div>
      )}

      <div className="mt-6">
        {response ? (
          <ResultsList
            hits={response.hits}
            totalCount={response.totalCount}
            page={page}
            pageSize={response.pageSize}
            loading={searchMut.isPending}
            bookmarkedIds={bookmarkedIds}
            onBookmarkToggle={handleBookmarkToggle}
            onPageChange={runSearch}
            onAskAi={() => toast.info("Chat panel coming in next release")}
          />
        ) : (
          <div className="flex min-h-[160px] items-center justify-center rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Enter a query to start searching.
            </p>
          </div>
        )}
      </div>

      <FilterDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        filters={filters}
        onApply={(applied) => setFilters(applied)}
        onClear={() => setFilters({})}
      />
    </div>
  );
}
