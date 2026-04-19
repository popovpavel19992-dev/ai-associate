// src/app/(app)/cases/page.tsx
"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

export default function CasesPage() {
  const { data, isLoading } = trpc.cases.list.useQuery();
  const { data: unreadData } = trpc.caseMessages.unreadByCase.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const unreadSet = new Set((unreadData?.byCase ?? []).map((u) => u.caseId));

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Cases</h1>
      <ul className="space-y-2">
        {(data ?? []).map((c) => (
          <li key={c.id}>
            <Link
              href={`/cases/${c.id}`}
              className="relative block rounded-md border border-zinc-800 p-3 hover:bg-zinc-900"
            >
              <div className="font-medium">{c.name}</div>
              {unreadSet.has(c.id) && (
                <span
                  className="absolute right-2 top-2 size-2 rounded-full bg-red-500"
                  aria-label="Unread messages"
                />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
