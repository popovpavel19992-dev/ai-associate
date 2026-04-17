"use client";

import * as React from "react";
import Link from "next/link";
import { MoreVertical, Link2, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// TODO(2.2.1): a joined `research.bookmarks.listWithOpinions` endpoint would
// allow us to show case name, court, citation, and snippet on each card.
// Until then we render the raw bookmark row and link out to the opinion viewer.

export interface BookmarkRow {
  id: string;
  opinionId: string;
  caseId: string | null;
  notes: string | null;
  createdAt: Date | string;
}

export interface BookmarksGridProps {
  rows: BookmarkRow[];
  onNotesChange: (bookmarkId: string, notes: string) => void;
  onDelete: (bookmarkId: string) => void;
  onAttachToCase: (bookmarkId: string, currentCaseId: string | null) => void;
  caseNameById?: Record<string, string>;
}

function formatDate(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function BookmarksGrid({
  rows,
  onNotesChange,
  onDelete,
  onAttachToCase,
  caseNameById,
}: BookmarksGridProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No bookmarks yet. Star opinions from search results to add them here.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <BookmarkCard
          key={row.id}
          row={row}
          caseName={row.caseId ? caseNameById?.[row.caseId] : undefined}
          onNotesChange={onNotesChange}
          onDelete={onDelete}
          onAttachToCase={onAttachToCase}
        />
      ))}
    </div>
  );
}

interface BookmarkCardProps {
  row: BookmarkRow;
  caseName: string | undefined;
  onNotesChange: (bookmarkId: string, notes: string) => void;
  onDelete: (bookmarkId: string) => void;
  onAttachToCase: (bookmarkId: string, currentCaseId: string | null) => void;
}

function BookmarkCard({
  row,
  caseName,
  onNotesChange,
  onDelete,
  onAttachToCase,
}: BookmarkCardProps) {
  const initialNotes = row.notes ?? "";
  const [notes, setNotes] = React.useState(initialNotes);

  React.useEffect(() => {
    setNotes(row.notes ?? "");
  }, [row.notes]);

  const handleBlur = () => {
    if (notes !== (row.notes ?? "")) {
      onNotesChange(row.id, notes);
    }
  };

  const caseLabel = row.caseId
    ? caseName ?? row.caseId.slice(0, 8)
    : null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/research/opinions/${row.opinionId}`}
          className="truncate text-sm font-medium text-primary hover:underline"
          title={row.opinionId}
        >
          View opinion
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Bookmark actions"
              />
            }
          >
            <MoreVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onClick={() => onAttachToCase(row.id, row.caseId)}
            >
              <Link2 className="h-4 w-4" />
              Attach to case
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(row.id)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {caseLabel ? (
        <div>
          <Badge variant="outline">Case: {caseLabel}</Badge>
        </div>
      ) : null}

      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add notes..."
        className="min-h-20 text-sm"
      />

      <div className="mt-auto text-xs text-muted-foreground">
        Saved {formatDate(row.createdAt)}
      </div>
    </Card>
  );
}
