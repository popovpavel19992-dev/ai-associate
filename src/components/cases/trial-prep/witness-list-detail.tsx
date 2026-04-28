"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useActivityTracker } from "@/lib/activity-tracker";
import { WitnessFormDialog, type WitnessFormValues } from "./witness-form-dialog";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  final: "bg-blue-100 text-blue-800",
  served: "bg-green-100 text-green-800",
  closed: "bg-zinc-100 text-zinc-700",
};

const CATEGORY_LABEL = {
  fact: "Fact Witnesses",
  expert: "Expert Witnesses",
  impeachment: "Impeachment Witnesses",
  rebuttal: "Rebuttal Witnesses",
} as const;

const CATEGORY_ORDER: Array<keyof typeof CATEGORY_LABEL> = [
  "fact",
  "expert",
  "impeachment",
  "rebuttal",
];

type Witness = {
  id: string;
  listId: string;
  witnessOrder: number;
  category: keyof typeof CATEGORY_LABEL;
  partyAffiliation: "plaintiff" | "defendant" | "non_party";
  fullName: string;
  titleOrRole: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  expectedTestimony: string | null;
  exhibitRefs: string[];
  isWillCall: boolean;
};

export function WitnessListDetail({
  caseId,
  listId,
}: {
  caseId: string;
  listId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  useActivityTracker(caseId, "witness_list_edit", { listId });
  const { data, isLoading, refetch } = trpc.witnessLists.getList.useQuery({ listId });

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Witness | null>(null);
  const [showServedDialog, setShowServedDialog] = useState(false);
  const [servedAt, setServedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const invalidate = () => {
    utils.witnessLists.getList.invalidate({ listId });
    utils.witnessLists.listForCase.invalidate({ caseId });
    refetch();
  };

  const addWitness = trpc.witnessLists.addWitness.useMutation({
    onSuccess: () => {
      toast.success("Witness added");
      setAddOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateWitness = trpc.witnessLists.updateWitness.useMutation({
    onSuccess: () => {
      toast.success("Witness updated");
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteWitness = trpc.witnessLists.deleteWitness.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const reorder = trpc.witnessLists.reorderWitnesses.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const finalize = trpc.witnessLists.finalize.useMutation({
    onSuccess: () => {
      toast.success("Finalized");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const markServed = trpc.witnessLists.markServed.useMutation({
    onSuccess: () => {
      toast.success("Marked as served");
      setShowServedDialog(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.witnessLists.delete.useMutation({
    onSuccess: () => {
      utils.witnessLists.listForCase.invalidate({ caseId });
      router.push(`/cases/${caseId}?tab=trial-prep`);
    },
    onError: (e) => toast.error(e.message),
  });
  const draftTestimony = trpc.witnessLists.draftTestimony.useMutation({
    onSuccess: () => {
      toast.success("Draft testimony generated");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }

  const { list, witnesses } = data;
  const isDraft = list.status === "draft";
  const isFinal = list.status === "final";
  const isServed = list.status === "served";

  const grouped: Record<string, Witness[]> = {};
  for (const w of witnesses as Witness[]) {
    const key = w.category;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(w);
  }

  const moveWithinCategory = (cat: keyof typeof CATEGORY_LABEL, idx: number, dir: -1 | 1) => {
    const items = grouped[cat] ?? [];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    // Build the full ordering across categories with one swap inside this group.
    const newCategory = [...items];
    [newCategory[idx], newCategory[target]] = [newCategory[target], newCategory[idx]];
    const ordered: string[] = [];
    for (const c of CATEGORY_ORDER) {
      const list = c === cat ? newCategory : grouped[c] ?? [];
      for (const w of list) ordered.push(w.id);
    }
    reorder.mutate({ listId, orderedIds: ordered });
  };

  const onSubmitAdd = (v: WitnessFormValues) => {
    addWitness.mutate({
      listId,
      category: v.category,
      partyAffiliation: v.partyAffiliation,
      fullName: v.fullName.trim(),
      titleOrRole: v.titleOrRole.trim() || null,
      address: v.address.trim() || null,
      phone: v.phone.trim() || null,
      email: v.email.trim() || null,
      expectedTestimony: v.expectedTestimony.trim() || null,
      exhibitRefs: v.exhibitRefs,
      isWillCall: v.isWillCall,
    });
  };

  const onSubmitEdit = (v: WitnessFormValues) => {
    if (!editing) return;
    updateWitness.mutate({
      witnessId: editing.id,
      category: v.category,
      partyAffiliation: v.partyAffiliation,
      fullName: v.fullName.trim(),
      titleOrRole: v.titleOrRole.trim() || null,
      address: v.address.trim() || null,
      phone: v.phone.trim() || null,
      email: v.email.trim() || null,
      expectedTestimony: v.expectedTestimony.trim() || null,
      exhibitRefs: v.exhibitRefs,
      isWillCall: v.isWillCall,
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
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
              disabled={witnesses.length === 0 || finalize.isPending}
              onClick={() => finalize.mutate({ listId })}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {finalize.isPending ? "Finalizing…" : "Finalize"}
            </button>
          )}
          {(isFinal || isServed) && (
            <a
              href={`/api/witness-lists/${listId}/pdf`}
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
                if (!confirm("Delete this witness list?")) return;
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
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
          >
            + Add Witness
          </button>
        </div>
      )}

      {witnesses.length === 0 && (
        <p className="text-sm text-zinc-500">
          No witnesses yet. Add at least one before finalizing.
        </p>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const items = grouped[cat] ?? [];
        if (items.length === 0) return null;
        return (
          <section key={cat} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
              {CATEGORY_LABEL[cat]}
            </h3>
            <ol className="space-y-3">
              {items.map((w, idx) => {
                const willCall = w.isWillCall ? "Will Call" : "May Call";
                const testimonyShort =
                  !w.expectedTestimony || w.expectedTestimony.trim().length < 60;
                return (
                  <li
                    key={w.id}
                    className="rounded-md border border-zinc-800 bg-zinc-950 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-8 shrink-0 pt-1 text-sm font-mono text-zinc-500">
                        {idx + 1}.
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{w.fullName}</span>
                          <span className="text-xs text-zinc-500">({willCall})</span>
                          <span className="text-xs text-zinc-500">
                            • {w.partyAffiliation.replace("_", " ")}
                          </span>
                        </div>
                        {w.titleOrRole && (
                          <div className="text-xs text-zinc-400">{w.titleOrRole}</div>
                        )}
                        {(w.address || w.phone || w.email) && (
                          <div className="text-xs text-zinc-500">
                            {[w.address, w.phone, w.email].filter(Boolean).join(" • ")}
                          </div>
                        )}
                        {w.expectedTestimony && (
                          <p className="whitespace-pre-wrap text-sm text-zinc-200">
                            {w.expectedTestimony}
                          </p>
                        )}
                        {w.exhibitRefs.length > 0 && (
                          <div className="text-xs text-zinc-400">
                            Exhibits: {w.exhibitRefs.join(", ")}
                          </div>
                        )}
                      </div>
                      {isDraft && (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => moveWithinCategory(cat, idx, -1)}
                            disabled={idx === 0 || reorder.isPending}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                            title="Move up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveWithinCategory(cat, idx, 1)}
                            disabled={idx === items.length - 1 || reorder.isPending}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                            title="Move down"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(w)}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!confirm(`Remove ${w.fullName}?`)) return;
                              deleteWitness.mutate({ witnessId: w.id });
                            }}
                            className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                    {isDraft && testimonyShort && (
                      <div className="mt-2 pl-10">
                        <button
                          type="button"
                          disabled={draftTestimony.isPending}
                          onClick={() =>
                            draftTestimony.mutate({ listId, witnessId: w.id })
                          }
                          className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-200 hover:bg-amber-950 disabled:opacity-50"
                        >
                          {draftTestimony.isPending && draftTestimony.variables?.witnessId === w.id
                            ? "Drafting…"
                            : "Draft testimony with AI"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}

      {addOpen && (
        <WitnessFormDialog
          title="Add witness"
          isPending={addWitness.isPending}
          defaultPartyAffiliation={list.servingParty}
          onClose={() => setAddOpen(false)}
          onSubmit={onSubmitAdd}
        />
      )}

      {editing && (
        <WitnessFormDialog
          title="Edit witness"
          isPending={updateWitness.isPending}
          initial={{
            category: editing.category,
            partyAffiliation: editing.partyAffiliation,
            fullName: editing.fullName,
            titleOrRole: editing.titleOrRole ?? "",
            address: editing.address ?? "",
            phone: editing.phone ?? "",
            email: editing.email ?? "",
            expectedTestimony: editing.expectedTestimony ?? "",
            exhibitRefs: editing.exhibitRefs,
            isWillCall: editing.isWillCall,
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
