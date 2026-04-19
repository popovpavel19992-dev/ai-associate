// src/app/(app)/research/collections/page.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CollectionListCard } from "@/components/research/collection-list-card";
import { CreateCollectionDialog } from "@/components/research/create-collection-dialog";

type Tab = "mine" | "shared";

export default function CollectionsListPage() {
  const [tab, setTab] = React.useState<Tab>("mine");
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const { data, isLoading } = trpc.research.collections.list.useQuery({ scope: tab, page });

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Collections</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Organize opinions, statutes, memos, and sessions into named buckets.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New collection</Button>
      </header>

      <div className="mb-4 flex gap-1.5">
        <Button variant={tab === "mine" ? "default" : "outline"} size="sm" onClick={() => { setTab("mine"); setPage(1); }}>
          Mine
        </Button>
        <Button variant={tab === "shared" ? "default" : "outline"} size="sm" onClick={() => { setTab("shared"); setPage(1); }}>
          Shared with me
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.collections.length ? (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {tab === "mine"
              ? 'No collections yet. Click "+ New collection" or use "Add to collection" on any opinion/statute/memo.'
              : "No collections shared with you yet."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {data.collections.map((c) => (
            <li key={c.id}>
              <CollectionListCard collection={c} />
            </li>
          ))}
        </ul>
      )}

      {data && data.collections.length === data.pageSize && (
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="outline" onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      <CreateCollectionDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
