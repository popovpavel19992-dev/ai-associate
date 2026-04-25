"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { NewWitnessListDialog } from "./new-witness-list-dialog";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  final: "bg-blue-100 text-blue-800",
  served: "bg-green-100 text-green-800",
  closed: "bg-zinc-100 text-zinc-700",
};

export function TrialPrepTab({ caseId }: { caseId: string }) {
  const [showNew, setShowNew] = useState(false);
  const { data: lists, isLoading } = trpc.witnessLists.listForCase.useQuery({ caseId });

  const grouped = (lists ?? []).reduce<Record<string, NonNullable<typeof lists>>>(
    (acc, l) => {
      const key = l.servingParty;
      if (!acc[key]) acc[key] = [] as unknown as NonNullable<typeof lists>;
      (acc[key] as unknown as typeof l[]).push(l);
      return acc;
    },
    {} as Record<string, NonNullable<typeof lists>>,
  );

  const sectionLabel = (k: string) =>
    k === "plaintiff" ? "Plaintiff's Witness Lists" : "Defendant's Witness Lists";

  return (
    <div className="space-y-6 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Trial Prep</h2>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New Witness List
        </button>
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-300">Witness Lists</h3>

        {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

        {!isLoading && (lists ?? []).length === 0 && (
          <p className="text-sm text-zinc-500">
            No witness lists yet. Create one to start identifying trial witnesses.
          </p>
        )}

        {(["plaintiff", "defendant"] as const).map((party) => {
          const items = (grouped[party] ?? []) as unknown as NonNullable<typeof lists>;
          if (items.length === 0) return null;
          const sorted = [...items].sort((a, b) => a.listNumber - b.listNumber);
          return (
            <div key={party} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {sectionLabel(party)}
              </h4>
              <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
                {sorted.map((l) => (
                  <li key={l.id} className="hover:bg-zinc-900/40">
                    <Link
                      href={`/cases/${caseId}/trial-prep/witness-lists/${l.id}`}
                      className="block p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{l.title}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            STATUS_BADGE[l.status] ?? "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {l.status}
                        </span>
                      </div>
                      <div className="mt-1 flex gap-3 text-xs text-gray-500">
                        <span>List {l.listNumber}</span>
                        <span>
                          {l.witnessCount} witness{l.witnessCount === 1 ? "" : "es"}
                        </span>
                        <span>Created {new Date(l.createdAt).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {showNew && (
        <NewWitnessListDialog caseId={caseId} onClose={() => setShowNew(false)} />
      )}
    </div>
  );
}
