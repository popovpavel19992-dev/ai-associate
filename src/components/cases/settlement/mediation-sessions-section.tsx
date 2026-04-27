"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { NewMediationSessionDialog } from "./new-mediation-session-dialog";

const STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-cyan-100 text-cyan-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-zinc-200 text-zinc-700",
  rescheduled: "bg-amber-100 text-amber-800",
};

const OUTCOME_LABEL: Record<string, string> = {
  pending: "Pending",
  settled: "Settled",
  impasse: "Impasse",
  continued: "Continued",
};

export function MediationSessionsSection({ caseId }: { caseId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const utils = trpc.useUtils();
  const { data: rows, isLoading } =
    trpc.settlement.mediation.listForCase.useQuery({ caseId });

  const statusMut = trpc.settlement.mediation.markStatus.useMutation({
    onSuccess: async () => {
      toast.success("Status updated");
      await utils.settlement.mediation.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  const outcomeMut = trpc.settlement.mediation.markOutcome.useMutation({
    onSuccess: async () => {
      toast.success("Outcome updated");
      await utils.settlement.mediation.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.settlement.mediation.delete.useMutation({
    onSuccess: async () => {
      toast.success("Session deleted");
      await utils.settlement.mediation.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">
          Mediation Sessions
        </h3>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          Schedule Mediation
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (rows ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">No mediation sessions yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
          {(rows ?? []).map((s) => (
            <li key={s.id} className="p-4 hover:bg-zinc-900/40">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  Session #{s.sessionNumber} — {s.mediatorName}
                  {s.mediatorFirm ? `, ${s.mediatorFirm}` : ""}
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    STATUS_BADGE[s.status] ?? "bg-gray-100 text-gray-800"
                  }`}
                >
                  {s.status}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                <span>{new Date(s.scheduledDate).toLocaleString()}</span>
                {s.location ? <span>{s.location}</span> : null}
                <span>Type: {s.sessionType}</span>
                <span>Outcome: {OUTCOME_LABEL[s.outcome] ?? s.outcome}</span>
              </div>
              {s.notes ? (
                <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">
                  {s.notes}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {s.status === "scheduled" && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        statusMut.mutate({
                          sessionId: s.id,
                          status: "completed",
                        })
                      }
                      className="rounded border border-emerald-700 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-900/40"
                    >
                      Mark Completed
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        statusMut.mutate({
                          sessionId: s.id,
                          status: "cancelled",
                        })
                      }
                      className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        statusMut.mutate({
                          sessionId: s.id,
                          status: "rescheduled",
                        })
                      }
                      className="rounded border border-amber-700 px-2 py-0.5 text-xs text-amber-300 hover:bg-amber-900/40"
                    >
                      Reschedule
                    </button>
                  </>
                )}
                {(s.status === "completed" || s.status === "rescheduled") && (
                  <select
                    value={s.outcome}
                    onChange={(e) =>
                      outcomeMut.mutate({
                        sessionId: s.id,
                        outcome: e.target.value as
                          | "pending"
                          | "settled"
                          | "impasse"
                          | "continued",
                      })
                    }
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs"
                  >
                    <option value="pending">Outcome: Pending</option>
                    <option value="settled">Outcome: Settled</option>
                    <option value="impasse">Outcome: Impasse</option>
                    <option value="continued">Outcome: Continued</option>
                  </select>
                )}
                {(s.status === "scheduled" || s.status === "cancelled") && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Delete this session?")) {
                        deleteMut.mutate({ sessionId: s.id });
                      }
                    }}
                    className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {dialogOpen ? (
        <NewMediationSessionDialog
          caseId={caseId}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}
