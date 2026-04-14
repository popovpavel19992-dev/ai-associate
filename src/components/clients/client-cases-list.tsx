// src/components/clients/client-cases-list.tsx
"use client";

import Link from "next/link";
import { Briefcase } from "lucide-react";
import { trpc } from "@/lib/trpc";

export function ClientCasesList({ clientId }: { clientId: string }) {
  const { data, isLoading } = trpc.clients.getCases.useQuery({ clientId });
  if (isLoading) return <p className="text-xs text-zinc-500">Loading…</p>;
  const cases = data?.cases ?? [];
  return (
    <section className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">Cases</h3>
      {cases.length === 0 ? (
        <p className="text-xs text-zinc-500">No cases yet.</p>
      ) : (
        <ul className="space-y-1">
          {cases.map((c) => (
            <li key={c.id}>
              <Link href={`/cases/${c.id}`} className="flex items-center gap-2 rounded p-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <Briefcase className="h-3 w-3 text-zinc-400" />
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
