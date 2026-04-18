"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export interface AttachToCaseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCaseId: string | null;
  onAttach: (caseId: string | null) => void;
  title?: string;
}

export function AttachToCaseModal({
  open,
  onOpenChange,
  currentCaseId,
  onAttach,
  title = "Attach to case",
}: AttachToCaseModalProps) {
  const [query, setQuery] = React.useState("");
  const { data, isLoading, error } = trpc.cases.list.useQuery(undefined, {
    enabled: open,
  });

  const cases = React.useMemo(() => {
    const rows = data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => c.name.toLowerCase().includes(q));
  }, [data, query]);

  const handlePick = (caseId: string | null) => {
    onAttach(caseId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cases..."
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          {isLoading ? (
            <div className="flex items-center justify-center p-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-destructive">
              Failed to load cases.
            </div>
          ) : cases.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              {data && data.length === 0
                ? "No cases yet."
                : "No cases match your search."}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {cases.map((c) => {
                const isCurrent = c.id === currentCaseId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(c.id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="truncate">{c.name}</span>
                      {isCurrent ? (
                        <Badge variant="outline" className="shrink-0">
                          Current
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          {currentCaseId ? (
            <Button
              variant="outline"
              onClick={() => handlePick(null)}
              className="sm:mr-auto"
            >
              Unlink
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
