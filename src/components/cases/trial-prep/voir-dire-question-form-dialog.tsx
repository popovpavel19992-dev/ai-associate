"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

const CATEGORY_OPTIONS = [
  { value: "background", label: "Background" },
  { value: "employment", label: "Employment" },
  { value: "prior_jury_experience", label: "Prior Jury Experience" },
  { value: "attitudes_bias", label: "Attitudes & Bias" },
  { value: "case_specific", label: "Case-Specific" },
  { value: "follow_up", label: "Follow-up" },
] as const;

const PANEL_TARGET_OPTIONS = [
  { value: "all", label: "All jurors" },
  { value: "individual", label: "Individual juror" },
] as const;

export type Category = (typeof CATEGORY_OPTIONS)[number]["value"];
export type PanelTarget = (typeof PANEL_TARGET_OPTIONS)[number]["value"];

export interface VoirDireQuestionFormValues {
  category: Category;
  text: string;
  followUpPrompt: string;
  isForCause: boolean;
  jurorPanelTarget: PanelTarget;
  notes: string;
}

export function VoirDireQuestionFormDialog({
  title: dialogTitle,
  initial,
  isPending,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: Partial<VoirDireQuestionFormValues>;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (v: VoirDireQuestionFormValues) => void;
}) {
  const [v, setV] = useState<VoirDireQuestionFormValues>({
    category: (initial?.category as Category) ?? "background",
    text: initial?.text ?? "",
    followUpPrompt: initial?.followUpPrompt ?? "",
    isForCause: initial?.isForCause ?? false,
    jurorPanelTarget: (initial?.jurorPanelTarget as PanelTarget) ?? "all",
    notes: initial?.notes ?? "",
  });

  const setField = <K extends keyof VoirDireQuestionFormValues>(
    k: K,
    val: VoirDireQuestionFormValues[K],
  ) => setV((s) => ({ ...s, [k]: val }));

  const canSubmit = v.text.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <h2 className="text-lg font-semibold">{dialogTitle}</h2>

        <div className="mt-4 space-y-4">
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
            Question text
            <textarea
              value={v.text}
              onChange={(e) => setField("text", e.target.value)}
              rows={4}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              placeholder="Have you ever served on a jury before?"
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Editing a library-derived question here will flip its source to
              &quot;modified&quot; if the text changes.
            </span>
          </label>

          <label className="block text-sm">
            Follow-up prompt (optional)
            <textarea
              value={v.followUpPrompt}
              onChange={(e) => setField("followUpPrompt", e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              placeholder="Despite that experience, could you set it aside…"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Panel target
              <select
                value={v.jurorPanelTarget}
                onChange={(e) =>
                  setField("jurorPanelTarget", e.target.value as PanelTarget)
                }
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              >
                {PANEL_TARGET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.isForCause}
                onChange={(e) => setField("isForCause", e.target.checked)}
              />
              <span>For-cause challenge question</span>
            </label>
          </div>

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
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"
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

export function VoirDireLibraryPickerDialog({
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

  const { data: templates } = trpc.voirDire.listLibraryTemplates.useQuery(
    category === "all" ? {} : { category: category as Category },
  );

  const filtered = (templates ?? []).filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.text.toLowerCase().includes(q);
  });

  const add = trpc.voirDire.addFromTemplate.useMutation({
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
            placeholder="Search question text…"
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
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 capitalize text-zinc-400">
                          {t.category.replaceAll("_", " ")}
                        </span>
                        {t.isForCause && (
                          <span className="rounded-full bg-rose-900 px-2 py-0.5 text-rose-100">
                            For Cause
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-zinc-100">{t.text}</p>
                      {t.followUpPrompt && (
                        <p className="mt-1 text-xs italic text-zinc-500">
                          Follow-up: {t.followUpPrompt}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={add.isPending}
                      onClick={() => add.mutate({ setId, templateId: t.id })}
                      className="shrink-0 rounded-md bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
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
