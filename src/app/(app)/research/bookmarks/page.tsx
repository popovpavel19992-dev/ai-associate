"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  BookmarksGrid,
  type BookmarkRow,
} from "@/components/research/bookmarks-grid";
import { AttachToCaseModal } from "@/components/research/attach-to-case-modal";

type Filter = "all" | "unlinked" | string; // string = caseId

interface Attaching {
  bookmarkId: string;
  currentCaseId: string | null;
}

export default function BookmarksPage() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [attaching, setAttaching] = React.useState<Attaching | null>(null);

  // Fetch ALL bookmarks and filter client-side so we can distinguish
  // "All" vs "Unlinked" vs a specific case. See TODO in bookmarks-grid.
  const bookmarksQuery = trpc.research.bookmarks.list.useQuery({});
  const casesQuery = trpc.cases.list.useQuery();

  const caseNameById = React.useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const c of casesQuery.data ?? []) {
      map[c.id] = c.name;
    }
    return map;
  }, [casesQuery.data]);

  const rows = React.useMemo<BookmarkRow[]>(() => {
    const all = bookmarksQuery.data ?? [];
    if (filter === "all") return all;
    if (filter === "unlinked") return all.filter((b) => !b.caseId);
    return all.filter((b) => b.caseId === filter);
  }, [bookmarksQuery.data, filter]);

  const updateMut = trpc.research.bookmarks.update.useMutation({
    onSuccess: () => {
      void utils.research.bookmarks.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to update bookmark"),
  });

  const deleteMut = trpc.research.bookmarks.delete.useMutation({
    onSuccess: () => {
      toast.success("Bookmark deleted");
      void utils.research.bookmarks.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to delete bookmark"),
  });

  const handleNotesChange = (bookmarkId: string, notes: string) => {
    updateMut.mutate({ bookmarkId, notes: notes.length ? notes : null });
  };

  const handleDelete = (bookmarkId: string) => {
    if (typeof window !== "undefined") {
      const ok = window.confirm("Delete this bookmark? This cannot be undone.");
      if (!ok) return;
    }
    deleteMut.mutate({ bookmarkId });
  };

  const handleAttachOpen = (bookmarkId: string, currentCaseId: string | null) => {
    setAttaching({ bookmarkId, currentCaseId });
  };

  const handleAttach = (caseId: string | null) => {
    if (!attaching) return;
    updateMut.mutate(
      { bookmarkId: attaching.bookmarkId, caseId },
      {
        onSuccess: () => {
          toast.success(caseId ? "Attached to case" : "Unlinked from case");
        },
      },
    );
    setAttaching(null);
  };

  const isLoading = bookmarksQuery.isLoading;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Bookmarks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved opinions from your research. Attach them to cases or add
            private notes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Filter</label>
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All bookmarks</SelectItem>
              <SelectItem value="unlinked">Unlinked</SelectItem>
              {(casesQuery.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : bookmarksQuery.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load bookmarks: {bookmarksQuery.error.message}
        </div>
      ) : (
        <BookmarksGrid
          rows={rows}
          onNotesChange={handleNotesChange}
          onDelete={handleDelete}
          onAttachToCase={handleAttachOpen}
          caseNameById={caseNameById}
        />
      )}

      {attaching ? (
        <AttachToCaseModal
          open={true}
          onOpenChange={(o) => {
            if (!o) setAttaching(null);
          }}
          currentCaseId={attaching.currentCaseId}
          onAttach={handleAttach}
        />
      ) : null}
    </div>
  );
}
