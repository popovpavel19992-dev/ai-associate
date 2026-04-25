"use client";

import { useState, KeyboardEvent } from "react";

export type WitnessCategory = "fact" | "expert" | "impeachment" | "rebuttal";
export type PartyAffiliation = "plaintiff" | "defendant" | "non_party";

export interface WitnessFormValues {
  category: WitnessCategory;
  partyAffiliation: PartyAffiliation;
  fullName: string;
  titleOrRole: string;
  address: string;
  phone: string;
  email: string;
  expectedTestimony: string;
  exhibitRefs: string[];
  isWillCall: boolean;
}

const EMPTY: WitnessFormValues = {
  category: "fact",
  partyAffiliation: "plaintiff",
  fullName: "",
  titleOrRole: "",
  address: "",
  phone: "",
  email: "",
  expectedTestimony: "",
  exhibitRefs: [],
  isWillCall: true,
};

export function WitnessFormDialog({
  initial,
  defaultPartyAffiliation,
  isPending,
  title,
  onClose,
  onSubmit,
}: {
  initial?: Partial<WitnessFormValues>;
  defaultPartyAffiliation?: PartyAffiliation;
  isPending: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (values: WitnessFormValues) => void;
}) {
  const [values, setValues] = useState<WitnessFormValues>({
    ...EMPTY,
    ...(defaultPartyAffiliation ? { partyAffiliation: defaultPartyAffiliation } : null),
    ...initial,
  });
  const [exhibitDraft, setExhibitDraft] = useState("");

  const set = <K extends keyof WitnessFormValues>(key: K, val: WitnessFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: val }));

  const addExhibit = () => {
    const v = exhibitDraft.trim();
    if (!v) return;
    if (values.exhibitRefs.includes(v)) {
      setExhibitDraft("");
      return;
    }
    set("exhibitRefs", [...values.exhibitRefs, v]);
    setExhibitDraft("");
  };

  const onExhibitKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addExhibit();
    }
  };

  const removeExhibit = (label: string) =>
    set(
      "exhibitRefs",
      values.exhibitRefs.filter((l) => l !== label),
    );

  const submit = () => {
    if (!values.fullName.trim()) return;
    onSubmit(values);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-xl rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <h2 className="text-lg font-semibold">{title}</h2>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Category
              <select
                value={values.category}
                onChange={(e) => set("category", e.target.value as WitnessCategory)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              >
                <option value="fact">Fact</option>
                <option value="expert">Expert</option>
                <option value="impeachment">Impeachment</option>
                <option value="rebuttal">Rebuttal</option>
              </select>
            </label>
            <label className="block text-sm">
              Party affiliation
              <select
                value={values.partyAffiliation}
                onChange={(e) =>
                  set("partyAffiliation", e.target.value as PartyAffiliation)
                }
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              >
                <option value="plaintiff">Plaintiff</option>
                <option value="defendant">Defendant</option>
                <option value="non_party">Non-party</option>
              </select>
            </label>
          </div>

          <label className="block text-sm">
            Full name <span className="text-red-400">*</span>
            <input
              type="text"
              value={values.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            Title / role
            <input
              type="text"
              value={values.titleOrRole}
              onChange={(e) => set("titleOrRole", e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              placeholder="Senior Engineer at Acme Corp"
            />
          </label>

          <label className="block text-sm">
            Address
            <input
              type="text"
              value={values.address}
              onChange={(e) => set("address", e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Phone
              <input
                type="text"
                value={values.phone}
                onChange={(e) => set("phone", e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              Email
              <input
                type="text"
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              />
            </label>
          </div>

          <label className="block text-sm">
            Expected testimony
            <textarea
              value={values.expectedTestimony}
              onChange={(e) => set("expectedTestimony", e.target.value)}
              rows={5}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              placeholder="2-3 paragraph summary of expected testimony…"
            />
          </label>

          <div className="block text-sm">
            <span className="block">Exhibit references</span>
            <div className="mt-1 flex flex-wrap gap-1 rounded-md border border-zinc-700 bg-zinc-900 p-2">
              {values.exhibitRefs.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-xs"
                >
                  {label}
                  <button
                    type="button"
                    onClick={() => removeExhibit(label)}
                    className="text-zinc-400 hover:text-zinc-100"
                    aria-label={`Remove ${label}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={exhibitDraft}
                onChange={(e) => setExhibitDraft(e.target.value)}
                onKeyDown={onExhibitKey}
                onBlur={addExhibit}
                placeholder="A, B, C…"
                className="flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Press Enter or comma to add. Each label appears in the rendered PDF.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.isWillCall}
              onChange={(e) => set("isWillCall", e.target.checked)}
            />
            Will call (uncheck for &quot;may call&quot;)
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
            disabled={isPending || !values.fullName.trim()}
            onClick={submit}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
