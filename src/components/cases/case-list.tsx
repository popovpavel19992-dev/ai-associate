"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { CaseCard } from "./case-card";
import { cn } from "@/lib/utils";

export function CaseList() {
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data, isLoading, error } = trpc.cases.list.useQuery(
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
        Failed to load cases. Please try again.
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 py-16 dark:border-zinc-700">
        <p className="text-lg font-medium text-zinc-600 dark:text-zinc-400">
          No cases yet
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          Create your first case to get started with AI-powered analysis.
        </p>
        <Link href="/cases/new" className={cn(buttonVariants(), "mt-6")}>
          <Plus className="mr-2 h-4 w-4" />
          Create Case
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((c) => (
        <CaseCard
          key={c.id}
          id={c.id}
          name={c.name}
          status={c.status}
          caseType={c.overrideCaseType ?? c.detectedCaseType}
          docCount={c.docCount}
          createdAt={c.createdAt}
        />
      ))}

      {data.length === limit && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset((prev) => prev + limit)}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
