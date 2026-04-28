"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useActivityTracker } from "@/lib/activity-tracker";
import {
  MilFormDialog,
  MilLibraryPickerDialog,
  type MilFormValues,
  type MilCategory,
} from "./mil-form-dialog";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  final: "bg-blue-100 text-blue-800",
  submitted: "bg-green-100 text-green-800",
  closed: "bg-zinc-100 text-zinc-700",
};

const SOURCE_BADGE: Record<string, string> = {
  library: "bg-emerald-900 text-emerald-100",
  manual: "bg-zinc-800 text-zinc-200",
  modified: "bg-amber-900 text-amber-100",
};

const CATEGORY_LABEL: Record<MilCategory, string> = {
  exclude_character: "Character",
  exclude_prior_bad_acts: "Prior Bad Acts",
  daubert: "Daubert",
  hearsay: "Hearsay",
  settlement_negotiations: "Settlement",
  insurance: "Insurance",
  remedial_measures: "Remedial",
  authentication: "Authentication",
  other: "Other",
};

type Mil = {
  id: string;
  setId: string;
  milOrder: number;
  category: MilCategory;
  freRule: string | null;
  title: string;
  introduction: string;
  reliefSought: string;
  legalAuthority: string;
  conclusion: string;
  source: "library" | "manual" | "modified";
  sourceTemplateId: string | null;
  notes: string | null;
};

export function MilSetDetail({
  caseId,
  setId,
}: {
  caseId: string;
  setId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  useActivityTracker(caseId, "mil_edit", { setId });
  const { data, isLoading, refetch } = trpc.motionsInLimine.getSet.useQuery({ setId });

  const [addOpen, setAddOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editing, setEditing] = useState<Mil | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submittedAt, setSubmittedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const invalidate = () => {
    utils.motionsInLimine.getSet.invalidate({ setId });
    utils.motionsInLimine.listForCase.invalidate({ caseId });
    refetch();
  };

  const addMil = trpc.motionsInLimine.addMil.useMutation({
    onSuccess: () => {
      toast.success("MIL added");
      setAddOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMilM = trpc.motionsInLimine.updateMil.useMutation({
    onSuccess: () => {
      toast.success("MIL updated");
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMilM = trpc.motionsInLimine.deleteMil.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const reorder = trpc.motionsInLimine.reorderMils.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const finalize = trpc.motionsInLimine.finalize.useMutation({
    onSuccess: () => {
      toast.success("Finalized");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const markSubmitted = trpc.motionsInLimine.markSubmitted.useMutation({
    onSuccess: () => {
      toast.success("Marked as submitted");
      setShowSubmitDialog(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.motionsInLimine.delete.useMutation({
    onSuccess: () => {
      utils.motionsInLimine.listForCase.invalidate({ caseId });
      router.push(`/cases/${caseId}?tab=trial-prep`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }

  const { set, mils } = data as { set: any; mils: Mil[] };
  const isDraft = set.status === "draft";
  const isFinal = set.status === "final";
  const isSubmitted = set.status === "submitted";
  const editable = isDraft;

  const move = (mil: Mil, dir: -1 | 1) => {
    const idx = mils.findIndex((x) => x.id === mil.id);
    const target = idx + dir;
    if (target < 0 || target >= mils.length) return;
    const next = [...mils];
    [next[idx], next[target]] = [next[target], next[idx]];
    reorder.mutate({ setId, orderedIds: next.map((e) => e.id) });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSubmitAdd = (v: MilFormValues) => {
    addMil.mutate({
      setId,
      category: v.category,
      freRule: v.freRule.trim() || null,
      title: v.title.trim(),
      introduction: v.introduction,
      reliefSought: v.reliefSought,
      legalAuthority: v.legalAuthority,
      conclusion: v.conclusion,
      notes: v.notes.trim() || null,
    });
  };
  const onSubmitEdit = (v: MilFormValues) => {
    if (!editing) return;
    updateMilM.mutate({
      milId: editing.id,
      category: v.category,
      freRule: v.freRule.trim() || null,
      title: v.title.trim(),
      introduction: v.introduction,
      reliefSought: v.reliefSought,
      legalAuthority: v.legalAuthority,
      conclusion: v.conclusion,
      notes: v.notes.trim() || null,
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
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
                STATUS_BADGE[set.status] ?? "bg-gray-100 text-gray-800"
              }`}
            >
              {set.status}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold">{set.title}</h1>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
            <span>Set {set.setNumber}</span>
            <span>Serving party: {set.servingParty}</span>
            <span>{mils.length} motion{mils.length === 1 ? "" : "s"}</span>
            <span>Created {new Date(set.createdAt).toLocaleDateString()}</span>
            {set.finalizedAt && (
              <span>Finalized {new Date(set.finalizedAt).toLocaleString()}</span>
            )}
            {set.submittedAt && (
              <span>Submitted {new Date(set.submittedAt).toLocaleString()}</span>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
          {isDraft && (
            <button
              type="button"
              disabled={mils.length === 0 || finalize.isPending}
              onClick={() => finalize.mutate({ setId })}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {finalize.isPending ? "Finalizing…" : "Finalize"}
            </button>
          )}
          {(isFinal || isSubmitted) && (
            <a
              href={`/api/mil-sets/${setId}/pdf`}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
            >
              Download PDF
            </a>
          )}
          {isFinal && (
            <button
              type="button"
              onClick={() => setShowSubmitDialog(true)}
              className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
            >
              Mark as Submitted
            </button>
          )}
          {!isSubmitted && (
            <button
              type="button"
              onClick={() => {
                if (!confirm("Delete this Motions in Limine set?")) return;
                del.mutate({ setId });
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white hover:bg-emerald-800"
          >
            + Add from Library
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
          >
            + Add Custom MIL
          </button>
        </div>
      )}

      {!isDraft && (
        <p className="text-xs text-zinc-500">
          Set is {set.status}. MILs are locked.
        </p>
      )}

      {mils.length === 0 && (
        <p className="text-sm text-zinc-500">
          No motions yet. Add at least one before finalizing.
        </p>
      )}

      <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
        {mils.map((m) => {
          const isOpen = expanded.has(m.id);
          return (
            <li key={m.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => toggleExpand(m.id)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <span className="mt-0.5 font-mono text-xs text-zinc-500">
                    #{m.milOrder}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{m.title}</span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </span>
                  {m.freRule && (
                    <span className="shrink-0 rounded-full bg-indigo-900 px-2 py-0.5 text-xs text-indigo-100">
                      FRE {m.freRule}
                    </span>
                  )}
                  <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs capitalize text-zinc-400">
                    {CATEGORY_LABEL[m.category]}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      SOURCE_BADGE[m.source]
                    }`}
                  >
                    {m.source}
                  </span>
                </button>
                {editable && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => move(m, -1)}
                      disabled={m.milOrder === 1 || reorder.isPending}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(m, 1)}
                      disabled={m.milOrder === mils.length || reorder.isPending}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(m)}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(`Remove MIL ${m.milOrder}?`)) return;
                        deleteMilM.mutate({ milId: m.id });
                      }}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
              {isOpen && (
                <div className="mt-3 space-y-3 rounded-md border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-200">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      Introduction
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{m.introduction}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      Relief Sought
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{m.reliefSought}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      Legal Authority
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{m.legalAuthority}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      Conclusion
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{m.conclusion}</p>
                  </div>
                  {m.notes && (
                    <p className="mt-1 text-xs italic text-zinc-500">
                      Note: {m.notes}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {addOpen && (
        <MilFormDialog
          title="Add Motion in Limine"
          isPending={addMil.isPending}
          onClose={() => setAddOpen(false)}
          onSubmit={onSubmitAdd}
        />
      )}

      {editing && (
        <MilFormDialog
          title={`Edit MIL #${editing.milOrder}`}
          isPending={updateMilM.isPending}
          initial={{
            category: editing.category,
            freRule: editing.freRule ?? "",
            title: editing.title,
            introduction: editing.introduction,
            reliefSought: editing.reliefSought,
            legalAuthority: editing.legalAuthority,
            conclusion: editing.conclusion,
            notes: editing.notes ?? "",
          }}
          onClose={() => setEditing(null)}
          onSubmit={onSubmitEdit}
        />
      )}

      {libraryOpen && (
        <MilLibraryPickerDialog
          setId={setId}
          onClose={() => setLibraryOpen(false)}
          onAdded={() => {
            invalidate();
            toast.success("Added from library");
          }}
        />
      )}

      {showSubmitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
            <h2 className="text-lg font-semibold">Mark as submitted</h2>
            <div className="mt-4">
              <label className="block text-sm">
                Submitted at
                <input
                  type="date"
                  value={submittedAt}
                  onChange={(e) => setSubmittedAt(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSubmitDialog(false)}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={markSubmitted.isPending}
                onClick={() => {
                  const iso = new Date(`${submittedAt}T12:00:00`).toISOString();
                  markSubmitted.mutate({ setId, submittedAt: iso });
                }}
                className="rounded-md bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {markSubmitted.isPending ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
