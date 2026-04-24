"use client";
import * as React from "react";
import { trpc } from "@/lib/trpc";
import { FilingDetailModal } from "./filing-detail-modal";

const METHOD_LABELS: Record<string, string> = {
  cm_ecf: "CM/ECF",
  mail: "Mail",
  hand_delivery: "Hand delivery",
  email: "Email",
  fax: "Fax",
};

export function FilingsTab({
  caseId,
  highlightId,
}: {
  caseId: string;
  highlightId?: string;
}) {
  const { data: filings, refetch } = trpc.filings.listByCase.useQuery({
    caseId,
  });
  const [openId, setOpenId] = React.useState<string | null>(
    highlightId ?? null,
  );

  React.useEffect(() => {
    if (highlightId) setOpenId(highlightId);
  }, [highlightId]);

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Filings</h2>
      </div>
      {!filings || filings.length === 0 ? (
        <p className="text-sm text-gray-500">
          No filings yet. Submit a filing via a finalized package detail page.
        </p>
      ) : (
        <ul className="divide-y rounded border">
          {filings.map((f) => (
            <li
              key={f.id}
              onClick={() => setOpenId(f.id)}
              className={`cursor-pointer p-3 text-sm hover:bg-gray-50 ${
                f.id === highlightId ? "bg-yellow-50" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{f.confirmationNumber}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    f.status === "closed"
                      ? "bg-green-100 text-green-800"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {f.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {f.court} ·{" "}
                {METHOD_LABELS[f.submissionMethod] ?? f.submissionMethod} ·{" "}
                {new Date(f.submittedAt).toLocaleDateString()}
              </div>
            </li>
          ))}
        </ul>
      )}

      {openId && (
        <FilingDetailModal
          filingId={openId}
          onClose={() => setOpenId(null)}
          onMutated={() => refetch()}
        />
      )}
    </div>
  );
}
