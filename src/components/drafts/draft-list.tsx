"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { DraftCard } from "./draft-card";
import { cn } from "@/lib/utils";

export function DraftList() {
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data, isLoading, error } = trpc.drafts.list.useQuery(
    { limit, offset },
    { refetchInterval: 30_000 },
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Failed to load drafts. Please try again.
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 py-16 dark:border-zinc-700">
        <p className="text-lg font-medium text-zinc-600 dark:text-zinc-400">
          No drafts yet
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          Generate a contract draft to get started.
        </p>
        <Link href="/drafts/new" className={cn(buttonVariants(), "mt-6")}>
          <Plus className="mr-2 h-4 w-4" />
          New Draft
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((d) => (
        <DraftCard key={d.id} draft={d} />
      ))}

      <div className="flex justify-center gap-2 pt-2">
        {offset > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
          >
            Previous
          </Button>
        )}
        {data.length === limit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset((prev) => prev + limit)}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
