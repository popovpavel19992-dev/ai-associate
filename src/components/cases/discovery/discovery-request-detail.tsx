"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useActivityTracker } from "@/lib/activity-tracker";
import type { DiscoveryQuestion } from "@/server/db/schema/case-discovery-requests";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  final: "bg-blue-100 text-blue-800",
  served: "bg-green-100 text-green-800",
  closed: "bg-zinc-100 text-zinc-700",
};

const SOFT_CAP = 25;
const UI_HARD_LIMIT = 50;

type EditableQuestion = {
  text: string;
  source?: "library" | "ai" | "manual";
  // Stable client-side id for React keys + reorder.
  _key: string;
};

function toEditable(qs: DiscoveryQuestion[]): EditableQuestion[] {
  return qs.map((q, i) => ({
    text: q.text,
    source: q.source,
    _key: `q-${i}-${Math.random().toString(36).slice(2, 8)}`,
  }));
}

function questionsEqual(a: EditableQuestion[], b: DiscoveryQuestion[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text) return false;
    if ((a[i].source ?? null) !== (b[i].source ?? null)) return false;
  }
  return true;
}

export function DiscoveryRequestDetail({
  caseId,
  requestId,
}: {
  caseId: string;
  requestId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();

  useActivityTracker(caseId, "discovery_request_edit", { requestId });

  const { data: req, isLoading, refetch } = trpc.discovery.get.useQuery({ requestId });

  const isDraft = req?.status === "draft";
  const isFinal = req?.status === "final";
  const isServed = req?.status === "served";

  const [editable, setEditable] = useState<EditableQuestion[] | null>(null);
  const [titleDraft, setTitleDraft] = useState<string>("");
  const [titleEdited, setTitleEdited] = useState(false);

  // Initialize local editing state once we have data.
  useEffect(() => {
    if (!req) return;
    if (editable === null) {
      setEditable(toEditable((req.questions ?? []) as DiscoveryQuestion[]));
      setTitleDraft(req.title);
    }
  }, [req, editable]);

  const update = trpc.discovery.update.useMutation({
    onSuccess: () => {
      toast.success("Saved");
      utils.discovery.get.invalidate({ requestId });
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const finalize = trpc.discovery.finalize.useMutation({
    onSuccess: () => {
      toast.success("Finalized");
      refetch();
      utils.discovery.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });
  const markServed = trpc.discovery.markServed.useMutation({
    onSuccess: () => {
      toast.success("Marked as served");
      setShowServedDialog(false);
      refetch();
      utils.discovery.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.discovery.delete.useMutation({
    onSuccess: () => {
      utils.discovery.listForCase.invalidate({ caseId });
      router.push(`/cases/${caseId}?tab=discovery`);
    },
    onError: (e) => toast.error(e.message),
  });

  const [showServedDialog, setShowServedDialog] = useState(false);
  const [servedAt, setServedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const dirty = useMemo(() => {
    if (!req || editable === null) return false;
    if (titleDraft !== req.title) return true;
    return !questionsEqual(editable, (req.questions ?? []) as DiscoveryQuestion[]);
  }, [req, editable, titleDraft]);

  if (isLoading || !req || editable === null) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }

  const isInterrogatory = req.requestType === "interrogatories";
  const isRfp = req.requestType === "rfp";
  const isRfa = req.requestType === "rfa";
  const count = editable.length;
  // 25-cap only applies to interrogatories (FRCP 33). RFPs (FRCP 34) and
  // RFAs (FRCP 36) have no federal numerical cap.
  const overSoftCap = isInterrogatory && count > SOFT_CAP;
  const atSoftCap = isInterrogatory && count >= SOFT_CAP;
  const itemNounSingular = isRfp ? "Request" : isRfa ? "Admission" : "Interrogatory";
  const itemNounPlural = isRfp ? "Requests" : isRfa ? "Admissions" : "Questions";
  const itemHeaderLabel = isRfp
    ? "REQUEST FOR PRODUCTION NO."
    : isRfa
      ? "REQUEST FOR ADMISSION NO."
      : "INTERROGATORY NO.";

  const updateQuestion = (idx: number, text: string) => {
    setEditable((prev) =>
      prev ? prev.map((q, i) => (i === idx ? { ...q, text } : q)) : prev,
    );
  };

  const addQuestion = () => {
    if (count >= UI_HARD_LIMIT) {
      toast.error(`UI limit of ${UI_HARD_LIMIT} questions`);
      return;
    }
    setEditable((prev) =>
      prev
        ? [
            ...prev,
            {
              text: "",
              source: "manual",
              _key: `q-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            },
          ]
        : prev,
    );
  };

  const deleteQuestion = (idx: number) => {
    setEditable((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev));
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    setEditable((prev) => {
      if (!prev) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const onSave = () => {
    const cleaned = editable
      .map((q) => ({ text: q.text.trim(), source: q.source }))
      .filter((q) => q.text.length > 0);
    update.mutate({
      requestId,
      title: titleEdited || titleDraft !== req.title ? titleDraft : undefined,
      questions: cleaned,
    });
  };

  const onFinalize = () => {
    if (overSoftCap) {
      toast.error(
        `Federal cap exceeded: ${count} interrogatories (max ${SOFT_CAP})`,
      );
      return;
    }
    if (dirty) {
      toast.error("Save your changes before finalizing");
      return;
    }
    finalize.mutate({ requestId });
  };

  const onMarkServed = () => {
    const iso = new Date(`${servedAt}T12:00:00`).toISOString();
    markServed.mutate({ requestId, servedAt: iso });
  };

  const onDelete = () => {
    if (!confirm("Delete this discovery request?")) return;
    del.mutate({ requestId });
  };

  const sourceBadge = (s?: string) => {
    if (!s) return null;
    const cls =
      s === "library"
        ? "bg-purple-100 text-purple-800"
        : s === "ai"
          ? "bg-amber-100 text-amber-800"
          : "bg-zinc-100 text-zinc-700";
    return (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
        {s}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/cases/${caseId}?tab=discovery`}
              className="text-sm text-zinc-400 hover:text-zinc-100"
            >
              ← Discovery
            </Link>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                STATUS_BADGE[req.status] ?? "bg-gray-100 text-gray-800"
              }`}
            >
              {req.status}
            </span>
          </div>
          {isDraft ? (
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => {
                setTitleEdited(true);
                setTitleDraft(e.target.value);
              }}
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xl font-bold"
            />
          ) : (
            <h1 className="mt-2 text-2xl font-bold">{req.title}</h1>
          )}
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
            <span>Set {req.setNumber}</span>
            <span>Serving party: {req.servingParty}</span>
            <span>Created {new Date(req.createdAt).toLocaleDateString()}</span>
            {req.finalizedAt && (
              <span>Finalized {new Date(req.finalizedAt).toLocaleString()}</span>
            )}
            {req.servedAt && (
              <span>Served {new Date(req.servedAt).toLocaleString()}</span>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
          {isDraft && (
            <>
              <button
                type="button"
                disabled={!dirty || update.isPending}
                onClick={onSave}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50"
              >
                {update.isPending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={overSoftCap || finalize.isPending || dirty}
                onClick={onFinalize}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {finalize.isPending ? "Finalizing…" : "Finalize"}
              </button>
            </>
          )}
          {(isFinal || isServed) && (
            <a
              href={`/api/discovery/${requestId}/pdf`}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
            >
              Download PDF
            </a>
          )}
          {isFinal && (
            <button
              type="button"
              onClick={() => setShowServedDialog(true)}
              className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
            >
              Mark as Served
            </button>
          )}
          {!isServed && (
            <button
              type="button"
              onClick={onDelete}
              disabled={del.isPending}
              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </header>

      {atSoftCap && (
        <div
          className={`rounded-md p-3 text-sm ${
            overSoftCap
              ? "bg-red-50 text-red-800"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {overSoftCap
            ? `You have ${count} interrogatories. Federal cap is ${SOFT_CAP}. Remove ${count - SOFT_CAP} before finalizing.`
            : `You're at the federal cap of ${SOFT_CAP} interrogatories. Adding more will block finalization.`}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {itemNounPlural} ({count})
          </h2>
        </div>

        {editable.length === 0 && !isDraft && (
          <p className="text-sm text-zinc-500">No {itemNounPlural.toLowerCase()}.</p>
        )}

        <ol className="space-y-3">
          {editable.map((q, idx) => (
            <li
              key={q._key}
              className="rounded-md border border-zinc-800 bg-zinc-950 p-3"
            >
              <div className="flex items-start gap-2">
                <div className="w-8 shrink-0 pt-2 text-sm font-mono text-zinc-500">
                  {idx + 1}.
                </div>
                <div className="flex-1">
                  <div className="mb-1 text-[10px] font-semibold tracking-wide text-zinc-500">
                    {itemHeaderLabel} {idx + 1}
                  </div>
                  {isDraft ? (
                    <textarea
                      value={q.text}
                      onChange={(e) => updateQuestion(idx, e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{q.text}</p>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    {sourceBadge(q.source)}
                  </div>
                </div>
                {isDraft && (
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => moveQuestion(idx, -1)}
                      disabled={idx === 0}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-900 disabled:opacity-30"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveQuestion(idx, 1)}
                      disabled={idx === editable.length - 1}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-900 disabled:opacity-30"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteQuestion(idx)}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>

        {isDraft && (
          <button
            type="button"
            onClick={addQuestion}
            disabled={count >= UI_HARD_LIMIT}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50"
          >
            + Add {itemNounSingular}
          </button>
        )}
      </section>

      {showServedDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
            <h2 className="text-lg font-semibold">Mark as served</h2>
            <div className="mt-4">
              <label className="block text-sm">
                Served at
                <input
                  type="date"
                  value={servedAt}
                  onChange={(e) => setServedAt(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowServedDialog(false)}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={markServed.isPending}
                onClick={onMarkServed}
                className="rounded-md bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {markServed.isPending ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
