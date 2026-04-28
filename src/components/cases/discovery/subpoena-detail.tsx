"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useActivityTracker } from "@/lib/activity-tracker";

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

const METHOD_LABEL: Record<string, string> = {
  personal: "Personal service",
  mail: "Certified mail",
  email: "Email (with consent)",
  process_server: "Process server",
};

export function SubpoenaDetail({
  caseId,
  subpoenaId,
}: {
  caseId: string;
  subpoenaId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  useActivityTracker(caseId, "subpoena_edit", { subpoenaId });
  const { data: s, isLoading } = trpc.subpoenas.get.useQuery({ subpoenaId });

  const issueMut = trpc.subpoenas.markIssued.useMutation({
    onSuccess: async () => {
      await utils.subpoenas.get.invalidate({ subpoenaId });
      await utils.subpoenas.listForCase.invalidate({ caseId });
      toast.success("Subpoena marked issued");
    },
    onError: (e) => toast.error(e.message),
  });
  const servedMut = trpc.subpoenas.markServed.useMutation({
    onSuccess: async () => {
      await utils.subpoenas.get.invalidate({ subpoenaId });
      await utils.subpoenas.listForCase.invalidate({ caseId });
      toast.success("Subpoena marked served");
    },
    onError: (e) => toast.error(e.message),
  });
  const compliedMut = trpc.subpoenas.markComplied.useMutation({
    onSuccess: async () => {
      await utils.subpoenas.get.invalidate({ subpoenaId });
      toast.success("Marked complied");
    },
    onError: (e) => toast.error(e.message),
  });
  const objectedMut = trpc.subpoenas.markObjected.useMutation({
    onSuccess: async () => {
      await utils.subpoenas.get.invalidate({ subpoenaId });
      toast.success("Marked objected");
    },
    onError: (e) => toast.error(e.message),
  });
  const quashedMut = trpc.subpoenas.markQuashed.useMutation({
    onSuccess: async () => {
      await utils.subpoenas.get.invalidate({ subpoenaId });
      toast.success("Marked quashed");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.subpoenas.delete.useMutation({
    onSuccess: async () => {
      await utils.subpoenas.listForCase.invalidate({ caseId });
      toast.success("Subpoena deleted");
      router.push(`/cases/${caseId}/discovery`);
    },
    onError: (e) => toast.error(e.message),
  });

  const [showServeForm, setShowServeForm] = useState(false);
  const [servedAt, setServedAt] = useState("");
  const [servedByName, setServedByName] = useState("");
  const [servedMethod, setServedMethod] =
    useState<"personal" | "mail" | "email" | "process_server">("personal");

  if (isLoading || !s) {
    return <div className="p-4 text-sm text-gray-500">Loading…</div>;
  }

  const docs = Array.isArray(s.documentsRequested)
    ? (s.documentsRequested as string[])
    : [];
  const topics = Array.isArray(s.testimonyTopics)
    ? (s.testimonyTopics as string[])
    : [];

  const status = s.status;

  return (
    <div className="space-y-6 px-4 py-4">
      <div>
        <Link
          href={`/cases/${caseId}/discovery`}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          ← Back to Discovery
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            Subpoena #{s.subpoenaNumber} — {s.recipientName}
          </h1>
          <p className="text-sm text-zinc-400">
            {TYPE_LABEL[s.subpoenaType] ?? s.subpoenaType} ·{" "}
            {s.issuingParty === "plaintiff" ? "Plaintiff" : "Defendant"}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            STATUS_BADGE[status] ?? "bg-gray-100 text-gray-800"
          }`}
        >
          {status}
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <>
            <button
              type="button"
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                issueMut.mutate({ subpoenaId, dateIssued: today });
              }}
              disabled={issueMut.isPending}
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              Mark Issued (today)
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm("Delete this draft subpoena?")) {
                  deleteMut.mutate({ subpoenaId });
                }
              }}
              disabled={deleteMut.isPending}
              className="rounded-md border border-rose-700 px-3 py-1.5 text-sm text-rose-400 hover:bg-rose-900/30"
            >
              Delete
            </button>
          </>
        ) : null}

        {status === "issued" ? (
          <>
            <a
              href={`/api/subpoenas/${subpoenaId}/pdf`}
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700"
            >
              Download Subpoena PDF
            </a>
            <button
              type="button"
              onClick={() => setShowServeForm((v) => !v)}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              {showServeForm ? "Cancel" : "Mark Served…"}
            </button>
          </>
        ) : null}

        {status === "served" ? (
          <>
            <a
              href={`/api/subpoenas/${subpoenaId}/pdf`}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              Subpoena PDF
            </a>
            <a
              href={`/api/subpoenas/${subpoenaId}/proof-of-service/pdf`}
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700"
            >
              Download Proof of Service
            </a>
            <button
              type="button"
              onClick={() => compliedMut.mutate({ subpoenaId })}
              disabled={compliedMut.isPending}
              className="rounded-md border border-emerald-700 px-3 py-1.5 text-sm text-emerald-400 hover:bg-emerald-900/30"
            >
              Mark Complied
            </button>
            <button
              type="button"
              onClick={() => objectedMut.mutate({ subpoenaId })}
              disabled={objectedMut.isPending}
              className="rounded-md border border-amber-700 px-3 py-1.5 text-sm text-amber-400 hover:bg-amber-900/30"
            >
              Mark Objected
            </button>
            <button
              type="button"
              onClick={() => quashedMut.mutate({ subpoenaId })}
              disabled={quashedMut.isPending}
              className="rounded-md border border-rose-700 px-3 py-1.5 text-sm text-rose-400 hover:bg-rose-900/30"
            >
              Mark Quashed
            </button>
          </>
        ) : null}

        {status === "complied" || status === "objected" || status === "quashed" ? (
          <>
            <a
              href={`/api/subpoenas/${subpoenaId}/pdf`}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              Subpoena PDF
            </a>
            <a
              href={`/api/subpoenas/${subpoenaId}/proof-of-service/pdf`}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              Proof of Service
            </a>
          </>
        ) : null}
      </div>

      {/* Mark-served inline form */}
      {showServeForm && status === "issued" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!servedAt || !servedByName.trim()) {
              toast.error("Date and server name required");
              return;
            }
            servedMut.mutate({
              subpoenaId,
              servedAt: new Date(servedAt).toISOString(),
              servedByName: servedByName.trim(),
              servedMethod,
            });
            setShowServeForm(false);
          }}
          className="space-y-3 rounded-md border border-zinc-700 bg-zinc-900 p-4 text-sm"
        >
          <h3 className="text-sm font-semibold">Record Service</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs uppercase text-zinc-400">
                Served at (date / time)
              </label>
              <input
                type="datetime-local"
                value={servedAt}
                onChange={(e) => setServedAt(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-zinc-400">
                Served by (name)
              </label>
              <input
                value={servedByName}
                onChange={(e) => setServedByName(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs uppercase text-zinc-400">
                Method
              </label>
              <select
                value={servedMethod}
                onChange={(e) =>
                  setServedMethod(e.target.value as typeof servedMethod)
                }
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              >
                {Object.entries(METHOD_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={servedMut.isPending}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            Record Service
          </button>
        </form>
      ) : null}

      {/* Recipient */}
      <section className="rounded-md border border-zinc-800 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Recipient
        </h2>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-zinc-500">Name</dt>
            <dd>{s.recipientName}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Address</dt>
            <dd className="whitespace-pre-line">{s.recipientAddress ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Email</dt>
            <dd>{s.recipientEmail ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Phone</dt>
            <dd>{s.recipientPhone ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {/* Service Details */}
      <section className="rounded-md border border-zinc-800 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Service Details
        </h2>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-zinc-500">Date Issued</dt>
            <dd>{s.dateIssued ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Compliance Date</dt>
            <dd>{s.complianceDate ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-zinc-500">Compliance Location</dt>
            <dd>{s.complianceLocation ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Served At</dt>
            <dd>{s.servedAt ? new Date(s.servedAt).toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Served By</dt>
            <dd>{s.servedByName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Served Method</dt>
            <dd>
              {s.servedMethod
                ? (METHOD_LABEL[s.servedMethod] ?? s.servedMethod)
                : "—"}
            </dd>
          </div>
        </dl>
      </section>

      {/* Topics / Documents */}
      {(s.subpoenaType === "documents" || s.subpoenaType === "both") && (
        <section className="rounded-md border border-zinc-800 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Documents Requested
          </h2>
          {docs.length === 0 ? (
            <p className="text-sm text-zinc-500">(none)</p>
          ) : (
            <ol className="list-decimal space-y-1 pl-6 text-sm">
              {docs.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ol>
          )}
        </section>
      )}
      {(s.subpoenaType === "testimony" || s.subpoenaType === "both") && (
        <section className="rounded-md border border-zinc-800 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Testimony Topics
          </h2>
          {topics.length === 0 ? (
            <p className="text-sm text-zinc-500">(none)</p>
          ) : (
            <ol className="list-decimal space-y-1 pl-6 text-sm">
              {topics.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          )}
        </section>
      )}

      {s.notes ? (
        <section className="rounded-md border border-zinc-800 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Notes
          </h2>
          <p className="whitespace-pre-line text-sm">{s.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
