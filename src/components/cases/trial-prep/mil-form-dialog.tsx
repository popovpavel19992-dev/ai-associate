"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

const CATEGORY_OPTIONS = [
  { value: "exclude_prior_bad_acts", label: "Prior Bad Acts (FRE 404(b))" },
  { value: "exclude_character", label: "Character Evidence (FRE 404(a))" },
  { value: "daubert", label: "Expert Testimony / Daubert (FRE 702)" },
  { value: "hearsay", label: "Hearsay (FRE 802)" },
  { value: "settlement_negotiations", label: "Settlement Negotiations (FRE 408)" },
  { value: "insurance", label: "Liability Insurance (FRE 411)" },
  { value: "remedial_measures", label: "Subsequent Remedial Measures (FRE 407)" },
  { value: "authentication", label: "Authentication (FRE 901)" },
  { value: "other", label: "Other" },
] as const;

export type MilCategory = (typeof CATEGORY_OPTIONS)[number]["value"];

export interface MilFormValues {
  category: MilCategory;
  freRule: string;
  title: string;
  introduction: string;
  reliefSought: string;
  legalAuthority: string;
  conclusion: string;
  notes: string;
}

export function MilFormDialog({
  title: dialogTitle,
  initial,
  isPending,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: Partial<MilFormValues>;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (v: MilFormValues) => void;
}) {
  const [v, setV] = useState<MilFormValues>({
    category: (initial?.category as MilCategory) ?? "exclude_prior_bad_acts",
    freRule: initial?.freRule ?? "",
    title: initial?.title ?? "",
    introduction: initial?.introduction ?? "",
    reliefSought: initial?.reliefSought ?? "",
    legalAuthority: initial?.legalAuthority ?? "",
    conclusion: initial?.conclusion ?? "",
    notes: initial?.notes ?? "",
  });

  const setField = <K extends keyof MilFormValues>(
    k: K,
    val: MilFormValues[K],
  ) => setV((s) => ({ ...s, [k]: val }));

  const canSubmit =
    v.title.trim().length > 0 &&
    v.introduction.trim().length > 0 &&
    v.reliefSought.trim().length > 0 &&
    v.legalAuthority.trim().length > 0 &&
    v.conclusion.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <h2 className="text-lg font-semibold">{dialogTitle}</h2>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Category
              <select
                value={v.category}
                onChange={(e) => setField("category", e.target.value as MilCategory)}
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
              FRE Rule (optional)
              <input
                type="text"
                value={v.freRule}
                onChange={(e) => setField("freRule", e.target.value)}
                placeholder="e.g. 404(b), 702, 411"
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
              placeholder="Motion in Limine to Exclude…"
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            Introduction
            <textarea
              value={v.introduction}
              onChange={(e) => setField("introduction", e.target.value)}
              rows={5}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            Relief Sought
            <textarea
              value={v.reliefSought}
              onChange={(e) => setField("reliefSought", e.target.value)}
              rows={5}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            Legal Authority
            <textarea
              value={v.legalAuthority}
              onChange={(e) => setField("legalAuthority", e.target.value)}
              rows={8}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Editing any of the four sections of a library-derived MIL flips
              its source to &quot;modified&quot;.
            </span>
          </label>

          <label className="block text-sm">
            Conclusion
            <textarea
              value={v.conclusion}
              onChange={(e) => setField("conclusion", e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
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
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50"
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

export function MilLibraryPickerDialog({
  setId,
  onClose,
  onAdded,
}: {
  setId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [category, setCategory] = useState<"all" | MilCategory>("all");
  const [search, setSearch] = useState("");

  const { data: templates } = trpc.motionsInLimine.listLibraryTemplates.useQuery(
    category === "all" ? {} : { category: category as MilCategory },
  );

  const filtered = (templates ?? []).filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      (t.freRule ?? "").toLowerCase().includes(q)
    );
  });

  const add = trpc.motionsInLimine.addFromTemplate.useMutation({
    onSuccess: () => onAdded(),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <h2 className="text-lg font-semibold">Add MIL from Library</h2>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as "all" | MilCategory)}
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
            placeholder="Search by title or FRE rule…"
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
                        <span className="font-medium">{t.title}</span>
                        {t.freRule && (
                          <span className="rounded-full bg-indigo-900 px-2 py-0.5 text-xs text-indigo-100">
                            FRE {t.freRule}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                        {t.introduction}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={add.isPending}
                      onClick={() => add.mutate({ setId, templateId: t.id })}
                      className="shrink-0 rounded-md bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700 disabled:opacity-50"
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
