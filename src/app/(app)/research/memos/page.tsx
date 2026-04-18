"use client";

import * as React from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { MemoListCard } from "@/components/research/memo-list-card";
import { Button } from "@/components/ui/button";

export default function MemosListPage() {
  const [page, setPage] = React.useState(1);
  const { data, isLoading } = trpc.research.memo.list.useQuery({ page });

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Memos</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            IRAC research memos generated from your sessions.
          </p>
        </div>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.memos.length ? (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No memos yet.{" "}
            <Link href="/research" className="underline">
              Open a research session
            </Link>{" "}
            to generate your first memo.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {data.memos.map((m) => (
            <li key={m.id}>
              <MemoListCard memo={m} />
            </li>
          ))}
        </ul>
      )}

      {data && data.memos.length === data.pageSize && (
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="outline" onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
