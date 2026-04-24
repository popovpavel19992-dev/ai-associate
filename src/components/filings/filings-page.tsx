"use client";
import * as React from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { FilingDetailModal } from "@/components/cases/filings/filing-detail-modal";

const METHOD_LABELS: Record<string, string> = {
  cm_ecf: "CM/ECF",
  mail: "Mail",
  hand_delivery: "Hand delivery",
  email: "Email",
  fax: "Fax",
};

export function FilingsPage() {
  const [status, setStatus] = React.useState<"submitted" | "closed" | "all">("submitted");
  const [court, setCourt] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [motionType, setMotionType] = React.useState<string>("");
  const [offset, setOffset] = React.useState(0);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const LIMIT = 25;

  const { data: templates } = trpc.motions.listTemplates.useQuery();
  const motionTypeOptions = React.useMemo(
    () => Array.from(new Map((templates ?? []).map((t) => [t.motionType, t.name])).entries()),
    [templates],
  );

  const { data, refetch } = trpc.filings.listForOrg.useQuery({
    status,
    court: court || undefined,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
    motionType: motionType || undefined,
    limit: LIMIT,
    offset,
  });

  const rows = data?.rows ?? [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Filings</h1>

      <div className="flex flex-wrap items-end gap-3 rounded border p-3">
        <label className="text-sm">
          Status
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as "submitted" | "closed" | "all"); setOffset(0); }}
            className="ml-2 rounded border px-2 py-1"
          >
            <option value="submitted">Submitted</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="text-sm">
          Court
          <input
            value={court}
            onChange={(e) => { setCourt(e.target.value); setOffset(0); }}
            placeholder="S.D.N.Y."
            className="ml-2 rounded border px-2 py-1"
          />
        </label>
        <label className="text-sm">
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }}
            className="ml-2 rounded border px-2 py-1"
          />
        </label>
        <label className="text-sm">
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setOffset(0); }}
            className="ml-2 rounded border px-2 py-1"
          />
        </label>
        <label className="text-sm">
          Motion type
          <select
            value={motionType}
            onChange={(e) => { setMotionType(e.target.value); setOffset(0); }}
            className="ml-2 rounded border px-2 py-1"
          >
            <option value="">Any</option>
            {motionTypeOptions.map(([slug, name]) => (
              <option key={slug} value={slug}>{name}</option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No filings matching these filters.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Case</th>
              <th className="py-2">Confirmation #</th>
              <th className="py-2">Court</th>
              <th className="py-2">Judge</th>
              <th className="py-2">Method</th>
              <th className="py-2">Submitted</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.filing.id}
                onClick={() => setOpenId(r.filing.id)}
                className="cursor-pointer border-b hover:bg-gray-50"
              >
                <td className="py-2">
                  <Link
                    href={`/cases/${r.filing.caseId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-blue-600 underline"
                  >
                    {r.caseName ?? "—"}
                  </Link>
                </td>
                <td className="py-2 font-medium">{r.filing.confirmationNumber}</td>
                <td className="py-2">{r.filing.court}</td>
                <td className="py-2">{r.filing.judgeName ?? "—"}</td>
                <td className="py-2">{METHOD_LABELS[r.filing.submissionMethod] ?? r.filing.submissionMethod}</td>
                <td className="py-2">{new Date(r.filing.submittedAt).toLocaleDateString()}</td>
                <td className="py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      r.filing.status === "closed" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {r.filing.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={rows.length < LIMIT}
          onClick={() => setOffset((o) => o + LIMIT)}
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        >
          Next
        </button>
      </div>

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
