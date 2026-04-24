"use client";
import * as React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Role = "opposing_counsel" | "co_defendant" | "co_plaintiff" | "pro_se" | "third_party" | "witness" | "other";

const ROLE_LABELS: Record<Role, string> = {
  opposing_counsel: "Opposing Counsel",
  co_defendant: "Co-Defendant",
  co_plaintiff: "Co-Plaintiff",
  pro_se: "Pro Se Party",
  third_party: "Third Party",
  witness: "Witness",
  other: "Other",
};

export function PartiesManagerModal({
  open,
  caseId,
  onClose,
}: {
  open: boolean;
  caseId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: parties } = trpc.parties.listByCase.useQuery({ caseId }, { enabled: open });

  const del = trpc.parties.delete.useMutation({
    onSuccess: async () => {
      toast.success("Party removed");
      await utils.parties.listByCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-md bg-white p-6 space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Case parties</h2>
          <button onClick={onClose} className="rounded border px-2 py-1 text-sm">Close</button>
        </header>
        <p className="text-xs text-gray-500">
          Registry of parties used for service records across all filings on this case.
        </p>

        {parties && parties.length === 0 && (
          <p className="text-sm text-gray-500">No parties yet. Add parties from the "Add service" modal.</p>
        )}

        <ul className="divide-y rounded border">
          {(parties ?? []).map((p) => (
            <li key={p.id} className="flex items-start justify-between p-3 text-sm">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-600">{ROLE_LABELS[p.role as Role] ?? p.role}</div>
                {p.email && <div className="text-xs text-gray-500">{p.email}</div>}
                {p.address && <div className="text-xs text-gray-500">{p.address}</div>}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Remove party "${p.name}"? This fails if any services reference them.`)) {
                    del.mutate({ partyId: p.id });
                  }
                }}
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
