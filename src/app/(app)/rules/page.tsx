"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { RuleCard, type RuleCardData } from "@/components/court-rules/rule-card";

const CATEGORIES = [
  { key: "procedural", label: "Procedural" },
  { key: "evidence", label: "Evidence" },
  { key: "local", label: "Local" },
  { key: "ethics", label: "Ethics" },
  { key: "appellate", label: "Appellate" },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

export default function RulesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialBookmarks = searchParams?.get("bookmarks") === "true";

  const [text, setText] = React.useState("");
  const debouncedText = useDebounced(text, 300);

  const [jurisdictions, setJurisdictions] = React.useState<string[]>([]);
  const [categories, setCategories] = React.useState<CategoryKey[]>([]);
  const [onlyBookmarks, setOnlyBookmarks] = React.useState(initialBookmarks);

  const utils = trpc.useUtils();

  const jurisdictionsQuery = trpc.courtRules.listJurisdictions.useQuery();

  const searchQuery = trpc.courtRules.search.useQuery({
    text: debouncedText.trim() || undefined,
    jurisdiction: jurisdictions.length > 0 ? jurisdictions : undefined,
    category: categories.length > 0 ? categories : undefined,
    onlyBookmarks,
    limit: 100,
  });

  const bookmarkMut = trpc.courtRules.bookmark.useMutation({
    onSuccess: async () => {
      await utils.courtRules.search.invalidate();
      await utils.courtRules.listBookmarks.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeBookmarkMut = trpc.courtRules.removeBookmark.useMutation({
    onSuccess: async () => {
      await utils.courtRules.search.invalidate();
      await utils.courtRules.listBookmarks.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function toggleJurisdiction(j: string) {
    setJurisdictions((prev) => (prev.includes(j) ? prev.filter((x) => x !== j) : [...prev, j]));
  }
  function toggleCategory(c: CategoryKey) {
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function toggleBookmark(rule: RuleCardData) {
    if (rule.isBookmarked) {
      removeBookmarkMut.mutate({ ruleId: rule.id });
    } else {
      bookmarkMut.mutate({ ruleId: rule.id });
    }
  }

  function setOnlyBookmarksAndUrl(v: boolean) {
    setOnlyBookmarks(v);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (v) params.set("bookmarks", "true");
    else params.delete("bookmarks");
    router.replace(`/rules${params.toString() ? `?${params}` : ""}`, { scroll: false });
  }

  const rules = searchQuery.data?.rules ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Court Rules</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Searchable reference: FRCP, Federal Rules of Evidence, and key state procedural rules
          (CA, TX, FL, NY).
        </p>
      </header>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search by title, body, citation, or rule number..."
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-zinc-500">Jurisdiction:</span>
          {jurisdictionsQuery.data?.map((j) => {
            const active = jurisdictions.includes(j.jurisdiction);
            return (
              <button
                key={j.jurisdiction}
                type="button"
                onClick={() => toggleJurisdiction(j.jurisdiction)}
                className="focus:outline-none"
              >
                <Badge
                  variant={active ? "default" : "outline"}
                  className="cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700"
                >
                  {j.jurisdiction} <span className="ml-1 opacity-60">({j.ruleCount})</span>
                </Badge>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-zinc-500">Category:</span>
          {CATEGORIES.map((c) => {
            const active = categories.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggleCategory(c.key)}
                className="focus:outline-none"
              >
                <Badge
                  variant={active ? "default" : "outline"}
                  className="cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700"
                >
                  {c.label}
                </Badge>
              </button>
            );
          })}
          <Button
            variant={onlyBookmarks ? "default" : "outline"}
            size="sm"
            className="ml-auto"
            onClick={() => setOnlyBookmarksAndUrl(!onlyBookmarks)}
          >
            {onlyBookmarks ? "Showing bookmarks only" : "Bookmarked only"}
          </Button>
        </div>
      </div>

      <div>
        {searchQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading rules…
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No rules found. Try clearing filters or your search term.
          </div>
        ) : (
          <>
            <div className="mb-3 text-xs text-zinc-500">{rules.length} result{rules.length === 1 ? "" : "s"}</div>
            <div className="grid gap-3">
              {rules.map((r) => (
                <RuleCard
                  key={r.id}
                  rule={{
                    id: r.id,
                    jurisdiction: r.jurisdiction,
                    ruleNumber: r.ruleNumber,
                    title: r.title,
                    body: r.body,
                    category: r.category,
                    citationShort: r.citationShort,
                    isBookmarked: r.isBookmarked,
                  }}
                  onToggleBookmark={toggleBookmark}
                  pendingBookmark={bookmarkMut.isPending || removeBookmarkMut.isPending}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
