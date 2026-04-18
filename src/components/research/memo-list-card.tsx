"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface MemoListCardProps {
  memo: {
    id: string;
    title: string;
    status: "generating" | "ready" | "failed";
    flags: { unverifiedCitations?: string[]; uplViolations?: string[] };
    updatedAt: string | Date;
  };
}

export function MemoListCard({ memo }: MemoListCardProps) {
  const flagCount =
    (memo.flags.unverifiedCitations?.length ?? 0) +
    (memo.flags.uplViolations?.length ?? 0);
  const updated = typeof memo.updatedAt === "string" ? new Date(memo.updatedAt) : memo.updatedAt;
  return (
    <Link
      href={`/research/memos/${memo.id}`}
      className="block rounded-md border p-4 transition hover:border-primary"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{memo.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Updated {formatDistanceToNow(updated, { addSuffix: true })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {memo.status === "generating" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {memo.status === "ready" && <CheckCircle2 className="size-4 text-emerald-500" />}
          {memo.status === "failed" && <AlertCircle className="size-4 text-red-500" />}
          {flagCount > 0 && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
              ⚠ {flagCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
