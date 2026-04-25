"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  ExhibitFormDialog,
  type ExhibitFormValues,
} from "./exhibit-form-dialog";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  final: "bg-blue-100 text-blue-800",
  served: "bg-green-100 text-green-800",
  closed: "bg-zinc-100 text-zinc-700",
};

const ADMISSION_OPTIONS: Array<{
  value:
    | "proposed"
    | "pre_admitted"
    | "admitted"
    | "not_admitted"
    | "withdrawn"
    | "objected";
  label: string;
}> = [
  { value: "proposed", label: "Proposed" },
  { value: "pre_admitted", label: "Pre-Admitted" },
  { value: "admitted", label: "Admitted" },
  { value: "not_admitted", label: "Not Admitted" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "objected", label: "Objected" },
];

type Exhibit = {
  id: string;
  listId: string;
  exhibitOrder: number;
  exhibitLabel: string;
  description: string;
  docType:
    | "document"
    | "photo"
    | "video"
    | "audio"
    | "physical"
    | "demonstrative"
    | "electronic";
  exhibitDate: string | null;
  sponsoringWitnessId: string | null;
  sponsoringWitnessName: string | null;
  admissionStatus:
    | "proposed"
    | "pre_admitted"
    | "admitted"
    | "not_admitted"
    | "withdrawn"
    | "objected";
  batesRange: string | null;
  sourceDocumentId: string | null;
  notes: string | null;
};

function formValuesToInput(v: ExhibitFormValues) {
  return {
    description: v.description.trim(),
    docType: v.docType,
    exhibitDate: v.exhibitDate || null,
    sponsoringWitnessId: v.sponsoringWitnessId,
    sponsoringWitnessName: v.sponsoringWitnessName.trim() || null,
    batesRange: v.batesRange.trim() || null,
    sourceDocumentId: v.sourceDocumentId,
    notes: v.notes.trim() || null,
  };
}

export function ExhibitListDetail({
  caseId,
  listId,
}: {
  caseId: string;
  listId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.exhibitLists.getList.useQuery({ listId });

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Exhibit | null>(null);
  const [showServedDialog, setShowServedDialog] = useState(false);
  const [servedAt, setServedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const invalidate = () => {
    utils.exhibitLists.getList.invalidate({ listId });
    utils.exhibitLists.listForCase.invalidate({ caseId });
    refetch();
  };

  const addExhibit = trpc.exhibitLists.addExhibit.useMutation({
    onSuccess: () => {
      toast.success("Exhibit added");
      setAddOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateExhibit = trpc.exhibitLists.updateExhibit.useMutation({
    onSuccess: () => {
      toast.success("Exhibit updated");
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateStatus = trpc.exhibitLists.updateAdmissionStatus.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const deleteExhibit = trpc.exhibitLists.deleteExhibit.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const reorder = trpc.exhibitLists.reorderExhibits.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const finalize = trpc.exhibitLists.finalize.useMutation({
    onSuccess: () => {
      toast.success("Finalized");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const markServed = trpc.exhibitLists.markServed.useMutation({
    onSuccess: () => {
      toast.success("Marked as served");
      setShowServedDialog(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.exhibitLists.delete.useMutation({
    onSuccess: () => {
      utils.exhibitLists.listForCase.invalidate({ caseId });
      router.push(`/cases/${caseId}?tab=trial-prep`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }

  const { list, exhibits } = data as { list: any; exhibits: Exhibit[] };
  const isDraft = list.status === "draft";
  const isFinal = list.status === "final";
  const isServed = list.status === "served";
  const editable = isDraft;

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= exhibits.length) return;
    const next = [...exhibits];
    [next[idx], next[target]] = [next[target], next[idx]];
    reorder.mutate({ listId, orderedIds: next.map((e) => e.id) });
  };

  const onSubmitAdd = (v: ExhibitFormValues) => {
    addExhibit.mutate({ listId, ...formValuesToInput(v) });
  };
  const onSubmitEdit = (v: ExhibitFormValues) => {
    if (!editing) return;
    const { ...patch } = formValuesToInput(v);
    updateExhibit.mutate({ exhibitId: editing.id, ...patch });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/cases/${caseId}?tab=trial-prep`}
              className="text-sm text-zinc-400 hover:text-zinc-100"
            >
              ← Trial Prep
            </Link>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                STATUS_BADGE[list.status] ?? "bg-gray-100 text-gray-800"
              }`}
            >
              {list.status}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold">{list.title}</h1>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
            <span>List {list.listNumber}</span>
            <span>Serving party: {list.servingParty}</span>
            <span>
              Auto-label prefix:{" "}
              <span className="font-mono">
                {list.servingParty === "plaintiff" ? "P-" : "D-"}
              </span>
            </span>
            <span>Created {new Date(list.createdAt).toLocaleDateString()}</span>
            {list.finalizedAt && (
              <span>Finalized {new Date(list.finalizedAt).toLocaleString()}</span>
            )}
            {list.servedAt && (
              <span>Served {new Date(list.servedAt).toLocaleString()}</span>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
          {isDraft && (
            <button
              type="button"
              disabled={exhibits.length === 0 || finalize.isPending}
              onClick={() => finalize.mutate({ listId })}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {finalize.isPending ? "Finalizing…" : "Finalize"}
            </button>
          )}
          {(isFinal || isServed) && (
            <a
              href={`/api/exhibit-lists/${listId}/pdf`}
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
              onClick={() => {
                if (!confirm("Delete this exhibit list?")) return;
                del.mutate({ listId });
              }}
              disabled={del.isPending}
              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </header>

      {isDraft && (
        <div>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-md bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700"
          >
            + Add Exhibit
          </button>
        </div>
      )}

      {!isDraft && (
        <p className="text-xs text-zinc-500">
          List is {list.status}. Most fields are locked; admission status remains
          editable for live trial tracking.
        </p>
      )}

      {exhibits.length === 0 && (
        <p className="text-sm text-zinc-500">
          No exhibits yet. Add at least one before finalizing.
        </p>
      )}

      {exhibits.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-zinc-800">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Label</th>
                <th className="px-2 py-2 text-left">Description</th>
                <th className="px-2 py-2 text-left">Date</th>
                <th className="px-2 py-2 text-left">Witness</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Bates</th>
                <th className="px-2 py-2 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {exhibits.map((e, idx) => (
                <tr key={e.id} className="align-top">
                  <td className="px-2 py-2 font-mono text-xs text-zinc-500">
                    {idx + 1}
                  </td>
                  <td className="px-2 py-2 font-mono">{e.exhibitLabel}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium">{e.description}</div>
                    <div className="text-xs text-zinc-500 capitalize">
                      {e.docType}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs">{e.exhibitDate ?? ""}</td>
                  <td className="px-2 py-2 text-xs">
                    {e.sponsoringWitnessName ?? ""}
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={e.admissionStatus}
                      disabled={updateStatus.isPending}
                      onChange={(ev) =>
                        updateStatus.mutate({
                          exhibitId: e.id,
                          admissionStatus: ev.target
                            .value as Exhibit["admissionStatus"],
                        })
                      }
                      className="rounded-md border border-zinc-700 bg-zinc-900 p-1 text-xs"
                    >
                      {ADMISSION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-xs">{e.batesRange ?? ""}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      {editable && (
                        <>
                          <button
                            type="button"
                            onClick={() => move(idx, -1)}
                            disabled={idx === 0 || reorder.isPending}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                            title="Move up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => move(idx, 1)}
                            disabled={idx === exhibits.length - 1 || reorder.isPending}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                            title="Move down"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(e)}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!confirm(`Remove ${e.exhibitLabel}?`)) return;
                              deleteExhibit.mutate({ exhibitId: e.id });
                            }}
                            className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <ExhibitFormDialog
          title="Add exhibit"
          caseId={caseId}
          isPending={addExhibit.isPending}
          onClose={() => setAddOpen(false)}
          onSubmit={onSubmitAdd}
        />
      )}

      {editing && (
        <ExhibitFormDialog
          title={`Edit exhibit ${editing.exhibitLabel}`}
          caseId={caseId}
          isPending={updateExhibit.isPending}
          initial={{
            description: editing.description,
            docType: editing.docType,
            exhibitDate: editing.exhibitDate ?? "",
            sponsoringWitnessId: editing.sponsoringWitnessId,
            sponsoringWitnessName: editing.sponsoringWitnessName ?? "",
            batesRange: editing.batesRange ?? "",
            sourceDocumentId: editing.sourceDocumentId,
            notes: editing.notes ?? "",
          }}
          onClose={() => setEditing(null)}
          onSubmit={onSubmitEdit}
        />
      )}

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
                onClick={() => {
                  const iso = new Date(`${servedAt}T12:00:00`).toISOString();
                  markServed.mutate({ listId, servedAt: iso });
                }}
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
