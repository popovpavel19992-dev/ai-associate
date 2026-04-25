"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

const CATEGORY_OPTIONS = [
  { value: "preliminary", label: "Preliminary" },
  { value: "substantive", label: "Substantive" },
  { value: "damages", label: "Damages" },
  { value: "concluding", label: "Concluding" },
] as const;

const PARTY_POSITION_OPTIONS = [
  { value: "plaintiff_proposed", label: "Proposed by Plaintiff" },
  { value: "defendant_proposed", label: "Proposed by Defendant" },
  { value: "agreed", label: "Agreed by Both" },
  { value: "court_ordered", label: "Court-Ordered" },
] as const;

export type Category = (typeof CATEGORY_OPTIONS)[number]["value"];
export type PartyPosition = (typeof PARTY_POSITION_OPTIONS)[number]["value"];

export interface JuryInstructionFormValues {
  category: Category;
  instructionNumber: string;
  title: string;
  body: string;
  partyPosition: PartyPosition;
  notes: string;
}

export function JuryInstructionFormDialog({
  title: dialogTitle,
  initial,
  isPending,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: Partial<JuryInstructionFormValues>;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (v: JuryInstructionFormValues) => void;
}) {
  const [v, setV] = useState<JuryInstructionFormValues>({
    category: (initial?.category as Category) ?? "preliminary",
    instructionNumber: initial?.instructionNumber ?? "",
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    partyPosition:
      (initial?.partyPosition as PartyPosition) ?? "plaintiff_proposed",
    notes: initial?.notes ?? "",
  });

  const setField = <K extends keyof JuryInstructionFormValues>(
    k: K,
    val: JuryInstructionFormValues[K],
  ) => setV((s) => ({ ...s, [k]: val }));

  const canSubmit =
    v.instructionNumber.trim().length > 0 &&
    v.title.trim().length > 0 &&
    v.body.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <h2 className="text-lg font-semibold">{dialogTitle}</h2>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Category
              <select
                value={v.category}
                onChange={(e) => setField("category", e.target.value as Category)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Instruction Number
              <input
                type="text"
                value={v.instructionNumber}
                onChange={(e) => setField("instructionNumber", e.target.value)}
                placeholder="e.g. 1.1, 5.3"
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm font-mono"
              />
            </label>
          </div>

          <label className="block text-sm">
            Title
            <input
              type="text"
              value={v.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="Duty of the Jury"
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            Body
            <textarea
              value={v.body}
              onChange={(e) => setField("body", e.target.value)}
              rows={12}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              placeholder="Members of the jury, …"
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Use blank lines between paragraphs. Editing a library-derived
              instruction here will flip its source to &quot;modified&quot;.
            </span>
          </label>

          <label className="block text-sm">
            Party Position
            <select
              value={v.partyPosition}
              onChange={(e) => setField("partyPosition", e.target.value as PartyPosition)}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            >
              {PARTY_POSITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            Notes (optional, internal)
            <textarea
              value={v.notes}
              onChange={(e) => setField("notes", e.target.value)}
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
            disabled={!canSubmit || isPending}
            onClick={() => onSubmit(v)}
            className="rounded-md bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const CATEGORY_FILTERS = [
  { value: "all", label: "All" },
  ...CATEGORY_OPTIONS,
] as const;

export function LibraryPickerDialog({
  setId,
  onClose,
  onAdded,
}: {
  setId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [category, setCategory] = useState<"all" | Category>("all");
  const [search, setSearch] = useState("");

  const { data: templates } = trpc.juryInstructions.listLibraryTemplates.useQuery(
    category === "all" ? {} : { category: category as Category },
  );

  const filtered = (templates ?? []).filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.instructionNumber.toLowerCase().includes(q) ||
      t.title.toLowerCase().includes(q)
    );
  });

  const add = trpc.juryInstructions.addFromTemplate.useMutation({
    onSuccess: () => onAdded(),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <h2 className="text-lg font-semibold">Add from Library</h2>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as "all" | Category)}
            className="rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
          >
            {CATEGORY_FILTERS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number or title…"
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
          />
        </div>

        <div className="mt-4 flex-1 overflow-y-auto rounded-md border border-zinc-800">
          {filtered.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">No templates match.</p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {filtered.map((t) => (
                <li key={t.id} className="p-3 hover:bg-zinc-900/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-amber-400">
                          {t.instructionNumber}
                        </span>
                        <span className="font-medium">{t.title}</span>
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs capitalize text-zinc-400">
                          {t.category}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                        {t.body}
                      </p>
                      {t.sourceAuthority && (
                        <p className="mt-1 text-xs italic text-zinc-600">
                          {t.sourceAuthority}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={add.isPending}
                      onClick={() => add.mutate({ setId, templateId: t.id })}
                      className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
