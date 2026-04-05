// src/app/(app)/cases/page.tsx
"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

export default function CasesPage() {
  const { data, isLoading } = trpc.cases.list.useQuery();

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
              className="block rounded-md border border-zinc-800 p-3 hover:bg-zinc-900"
            >
              <div className="font-medium">{c.name}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
