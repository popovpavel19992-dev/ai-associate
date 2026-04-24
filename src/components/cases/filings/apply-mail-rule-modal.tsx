"use client";
import * as React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export interface AffectedDeadline {
  deadlineId: string;
  title: string;
  currentDue: string;
  proposedDue: string;
}

export function ApplyMailRuleModal({
  open,
  filingId,
  caseId,
  affectedDeadlines,
  onClose,
}: {
  open: boolean;
  filingId: string;
  caseId: string;
  affectedDeadlines: AffectedDeadline[];
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const apply = trpc.services.applyMailRule.useMutation({
    onSuccess: async (res) => {
      toast.success(`Shifted ${res.shifted} deadline${res.shifted === 1 ? "" : "s"} (FRCP 6(d))`);
      // Invalidate case deadlines list if available; non-fatal if the query shape differs.
      await utils.deadlines.listForCase
        .invalidate({ caseId })
        .catch(() => undefined);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-md bg-white p-6 space-y-3">
        <h2 className="text-lg font-semibold">Apply FRCP 6(d) mail rule?</h2>
        <p className="text-sm text-gray-600">
          Service by mail adds 3 calendar days to response deadlines. The following deadlines would shift:
        </p>
        <ul className="max-h-64 overflow-y-auto rounded border p-2 text-sm">
          {affectedDeadlines.map((d) => (
            <li key={d.deadlineId} className="border-b py-1 last:border-b-0">
              <span className="font-medium">{d.title}</span>
              <div className="text-xs text-gray-500">
                {d.currentDue} → <span className="font-medium text-gray-900">{d.proposedDue}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm">
            Skip for now
          </button>
          <button
            type="button"
            disabled={apply.isPending}
            onClick={() => apply.mutate({ filingId })}
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {apply.isPending ? "Applying…" : "Apply +3 days"}
          </button>
        </div>
      </div>
    </div>
  );
}
