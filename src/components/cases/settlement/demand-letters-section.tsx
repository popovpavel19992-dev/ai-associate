"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "./format";
import { NewDemandLetterDialog } from "./new-demand-letter-dialog";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  sent: "bg-emerald-100 text-emerald-800",
  responded: "bg-cyan-100 text-cyan-800",
  no_response: "bg-zinc-200 text-zinc-700",
  rescinded: "bg-rose-100 text-rose-800",
};

const TYPE_LABEL: Record<string, string> = {
  initial_demand: "Initial Demand",
  pre_litigation: "Pre-Litigation",
  pre_trial: "Pre-Trial",
  response_to_demand: "Response to Demand",
};

export function DemandLettersSection({ caseId }: { caseId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: rows, isLoading } =
    trpc.settlement.demandLetters.listForCase.useQuery({ caseId });

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Demand Letters</h3>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
        >
          New Demand Letter
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (rows ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">No demand letters yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
          {(rows ?? []).map((l) => (
            <li key={l.id} className="hover:bg-zinc-900/40">
              <Link
                href={`/cases/${caseId}/settlement/demand-letters/${l.id}`}
                className="block p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    Letter #{l.letterNumber} — {l.recipientName}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_BADGE[l.status] ?? "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {l.status}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                  <span>{TYPE_LABEL[l.letterType] ?? l.letterType}</span>
                  {l.demandAmountCents !== null &&
                  l.demandAmountCents !== undefined ? (
                    <span>
                      {formatCurrency(l.demandAmountCents, l.currency)}
                    </span>
                  ) : null}
                  {l.deadlineDate ? <span>Deadline {l.deadlineDate}</span> : null}
                  {l.sentMethod ? <span>Sent via {l.sentMethod}</span> : null}
                  <span>
                    Created {new Date(l.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {dialogOpen ? (
        <NewDemandLetterDialog
          caseId={caseId}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}
