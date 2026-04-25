"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

export type ExhibitFormValues = {
  description: string;
  docType:
    | "document"
    | "photo"
    | "video"
    | "audio"
    | "physical"
    | "demonstrative"
    | "electronic";
  exhibitDate: string; // YYYY-MM-DD or ""
  sponsoringWitnessId: string | null;
  sponsoringWitnessName: string;
  batesRange: string;
  sourceDocumentId: string | null;
  notes: string;
};

const DOC_TYPES: ExhibitFormValues["docType"][] = [
  "document",
  "photo",
  "video",
  "audio",
  "physical",
  "demonstrative",
  "electronic",
];

const EMPTY: ExhibitFormValues = {
  description: "",
  docType: "document",
  exhibitDate: "",
  sponsoringWitnessId: null,
  sponsoringWitnessName: "",
  batesRange: "",
  sourceDocumentId: null,
  notes: "",
};

export function ExhibitFormDialog({
  title,
  caseId,
  initial,
  isPending,
  onClose,
  onSubmit,
}: {
  title: string;
  caseId: string;
  initial?: Partial<ExhibitFormValues>;
  isPending?: boolean;
  onClose: () => void;
  onSubmit: (v: ExhibitFormValues) => void;
}) {
  const [v, setV] = useState<ExhibitFormValues>({ ...EMPTY, ...initial });
  useEffect(() => {
    setV({ ...EMPTY, ...initial });
  }, [initial]);

  const { data: witnessOptions } = trpc.exhibitLists.witnessesForCase.useQuery({
    caseId,
  });
  const { data: documents } = trpc.documents.listByCase.useQuery({ caseId });

  const update = <K extends keyof ExhibitFormValues>(k: K, val: ExhibitFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <h2 className="text-lg font-semibold">{title}</h2>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-2 block text-sm">
            Description *
            <textarea
              value={v.description}
              onChange={(e) => update("description", e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              placeholder="Plaintiff's medical records from Mercy Hospital, dated 2025-06-12"
            />
          </label>

          <label className="block text-sm">
            Doc type
            <select
              value={v.docType}
              onChange={(e) =>
                update("docType", e.target.value as ExhibitFormValues["docType"])
              }
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm capitalize"
            >
              {DOC_TYPES.map((d) => (
                <option key={d} value={d} className="capitalize">
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            Date
            <input
              type="date"
              value={v.exhibitDate}
              onChange={(e) => update("exhibitDate", e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            Sponsoring witness
            <select
              value={v.sponsoringWitnessId ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                update("sponsoringWitnessId", id);
                if (id) {
                  const w = (witnessOptions ?? []).find((o) => o.id === id);
                  if (w) update("sponsoringWitnessName", w.fullName);
                }
              }}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            >
              <option value="">— None / free text —</option>
              {(witnessOptions ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            Sponsoring witness (free text)
            <input
              type="text"
              value={v.sponsoringWitnessName}
              onChange={(e) => update("sponsoringWitnessName", e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              placeholder="Used when no witness FK is selected"
            />
          </label>

          <label className="block text-sm">
            Bates range
            <input
              type="text"
              value={v.batesRange}
              onChange={(e) => update("batesRange", e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              placeholder="PLTF-000123 — PLTF-000150"
            />
          </label>

          <label className="block text-sm">
            Source document (optional)
            <select
              value={v.sourceDocumentId ?? ""}
              onChange={(e) => update("sourceDocumentId", e.target.value || null)}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            >
              <option value="">— None —</option>
              {(documents ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </label>

          <label className="col-span-2 block text-sm">
            Notes
            <textarea
              value={v.notes}
              onChange={(e) => update("notes", e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending || !v.description.trim()}
            onClick={() => onSubmit(v)}
            className="rounded-md bg-purple-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
