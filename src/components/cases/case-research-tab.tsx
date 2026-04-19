"use client";

import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buttonVariants } from "@/components/ui/button-variants";
import { Separator } from "@/components/ui/separator";
import { MemoListCard } from "@/components/research/memo-list-card";

interface CaseResearchTabProps {
  caseId: string;
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}\u2026`;
}

export function CaseResearchTab({ caseId }: CaseResearchTabProps) {
  const { data: sessions = [], isLoading: sessionsLoading } =
    trpc.research.sessions.list.useQuery({ caseId });
  const { data: bookmarks = [], isLoading: bookmarksLoading } =
    trpc.research.bookmarks.list.useQuery({ caseId });
  const memosForCase = trpc.research.memo.list.useQuery({ caseId }).data?.memos ?? [];

  return (
    <div className="space-y-8 px-4 py-4">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">
            Research sessions
          </h3>
        </div>

        {sessionsLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            Loading sessions...
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No research for this case yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/research/sessions/${s.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm transition-colors hover:bg-zinc-900"
                >
                  <span className="truncate font-medium text-zinc-100">
                    {s.title}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {formatDate(s.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="pt-1">
          <Link
            href={`/research?caseId=${caseId}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Plus className="mr-1.5 size-4" />
            New research for this case
          </Link>
        </div>
      </section>

      <Separator className="bg-zinc-800" />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-100">
          Bookmarked opinions
        </h3>

        {bookmarksLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            Loading bookmarks...
          </div>
        ) : bookmarks.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No bookmarks linked to this case yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {bookmarks.map((b) => (
              <Link
                key={b.id}
                href={`/research/opinions/${b.opinionId}`}
                className="block rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              >
                <p className="line-clamp-3 text-zinc-100">
                  {b.notes ? truncate(b.notes) : <span className="italic text-zinc-500">No notes</span>}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                  <span className="font-mono">{b.opinionId.slice(0, 8)}</span>
                  <span>{formatDate(b.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {memosForCase.length > 0 && (
        <>
          <Separator className="bg-zinc-800" />
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-zinc-100">
              Memos ({memosForCase.length})
            </h3>
            <ul className="mt-2 grid gap-2">
              {memosForCase.map((m) => (
                <li key={m.id}>
                  <MemoListCard memo={m} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
