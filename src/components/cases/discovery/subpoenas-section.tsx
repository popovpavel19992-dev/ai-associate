"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { NewSubpoenaDialog } from "./new-subpoena-dialog";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  issued: "bg-cyan-100 text-cyan-800",
  served: "bg-emerald-100 text-emerald-800",
  complied: "bg-zinc-200 text-zinc-800",
  objected: "bg-amber-100 text-amber-800",
  quashed: "bg-rose-100 text-rose-800",
};

const TYPE_LABEL: Record<string, string> = {
  testimony: "Testimony",
  documents: "Documents",
  both: "Documents + Testimony",
};

export function SubpoenasSection({ caseId }: { caseId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: rows, isLoading } = trpc.subpoenas.listForCase.useQuery({ caseId });

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Subpoenas (FRCP 45)</h3>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700"
        >
          New Subpoena
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (rows ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">No subpoenas yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
          {(rows ?? []).map((s) => (
            <li key={s.id} className="hover:bg-zinc-900/40">
              <Link
                href={`/cases/${caseId}/discovery/subpoenas/${s.id}`}
                className="block p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    Subpoena #{s.subpoenaNumber} — {s.recipientName}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_BADGE[s.status] ?? "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                  <span>{TYPE_LABEL[s.subpoenaType] ?? s.subpoenaType}</span>
                  <span>
                    Issuing:{" "}
                    {s.issuingParty === "plaintiff" ? "Plaintiff" : "Defendant"}
                  </span>
                  {s.complianceDate ? (
                    <span>Compliance {s.complianceDate}</span>
                  ) : null}
                  <span>
                    Created {new Date(s.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {dialogOpen ? (
        <NewSubpoenaDialog caseId={caseId} onClose={() => setDialogOpen(false)} />
      ) : null}
    </section>
  );
}
