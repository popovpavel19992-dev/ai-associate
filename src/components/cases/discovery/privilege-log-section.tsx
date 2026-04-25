"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type PrivilegeBasis =
  | "attorney_client"
  | "work_product"
  | "common_interest"
  | "joint_defense"
  | "other";

const BASIS_OPTIONS: { value: PrivilegeBasis; label: string }[] = [
  { value: "attorney_client", label: "Attorney-Client" },
  { value: "work_product", label: "Work Product" },
  { value: "common_interest", label: "Common Interest" },
  { value: "joint_defense", label: "Joint Defense" },
  { value: "other", label: "Other" },
];

const BASIS_ABBREV: Record<PrivilegeBasis, string> = {
  attorney_client: "AC",
  work_product: "WP",
  common_interest: "CI",
  joint_defense: "JD",
  other: "OT",
};

interface FormState {
  relatedRequestId: string | null;
  entryNumber: number | "";
  documentDate: string;
  documentType: string;
  author: string;
  recipients: string[];
  cc: string[];
  subject: string;
  description: string;
  privilegeBasis: PrivilegeBasis;
  basisExplanation: string;
  withheldBy: "plaintiff" | "defendant";
  batesRange: string;
}

function emptyForm(): FormState {
  return {
    relatedRequestId: null,
    entryNumber: "",
    documentDate: "",
    documentType: "",
    author: "",
    recipients: [""],
    cc: [],
    subject: "",
    description: "",
    privilegeBasis: "attorney_client",
    basisExplanation: "",
    withheldBy: "plaintiff",
    batesRange: "",
  };
}

function truncList(arr: string[] | null | undefined, max = 2): string {
  if (!arr || arr.length === 0) return "—";
  if (arr.length <= max) return arr.join(", ");
  return `${arr.slice(0, max).join(", ")} +${arr.length - max} more`;
}

export function PrivilegeLogSection({ caseId }: { caseId: string }) {
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: entries, isLoading } = trpc.privilegeLog.listForCase.useQuery({ caseId });
  const { data: discoveryRequests } = trpc.discovery.listForCase.useQuery({ caseId });

  const create = trpc.privilegeLog.create.useMutation({
    onSuccess: () => {
      toast.success("Entry added");
      utils.privilegeLog.listForCase.invalidate({ caseId });
      setAdding(false);
      setForm(emptyForm());
    },
    onError: (e) => toast.error(e.message),
  });

  const update = trpc.privilegeLog.update.useMutation({
    onSuccess: () => {
      toast.success("Entry updated");
      utils.privilegeLog.listForCase.invalidate({ caseId });
      setEditingId(null);
      setForm(emptyForm());
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.privilegeLog.delete.useMutation({
    onSuccess: () => {
      toast.success("Entry deleted");
      utils.privilegeLog.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  const sorted = useMemo(
    () => [...(entries ?? [])].sort((a, b) => a.entryNumber - b.entryNumber),
    [entries],
  );

  function startEdit(e: NonNullable<typeof entries>[number]) {
    setAdding(false);
    setEditingId(e.id);
    setForm({
      relatedRequestId: e.relatedRequestId ?? null,
      entryNumber: e.entryNumber,
      documentDate: e.documentDate ? String(e.documentDate).slice(0, 10) : "",
      documentType: e.documentType ?? "",
      author: e.author ?? "",
      recipients: ((e.recipients as string[]) ?? []).length
        ? (e.recipients as string[])
        : [""],
      cc: ((e.cc as string[]) ?? []) || [],
      subject: e.subject ?? "",
      description: e.description ?? "",
      privilegeBasis: e.privilegeBasis as PrivilegeBasis,
      basisExplanation: e.basisExplanation ?? "",
      withheldBy: e.withheldBy as "plaintiff" | "defendant",
      batesRange: e.batesRange ?? "",
    });
  }

  function submit() {
    const payload = {
      relatedRequestId: form.relatedRequestId,
      entryNumber: form.entryNumber === "" ? undefined : Number(form.entryNumber),
      documentDate: form.documentDate || null,
      documentType: form.documentType || null,
      author: form.author || null,
      recipients: form.recipients.filter((r) => r.trim()),
      cc: form.cc.filter((r) => r.trim()),
      subject: form.subject || null,
      description: form.description || null,
      privilegeBasis: form.privilegeBasis,
      basisExplanation: form.basisExplanation || null,
      withheldBy: form.withheldBy,
      batesRange: form.batesRange || null,
    };
    if (editingId) {
      update.mutate({ id: editingId, ...payload });
    } else {
      create.mutate({ caseId, ...payload });
    }
  }

  function setRecipientAt(i: number, v: string, key: "recipients" | "cc") {
    setForm((f) => {
      const next = [...f[key]];
      next[i] = v;
      return { ...f, [key]: next };
    });
  }
  function addRecipient(key: "recipients" | "cc") {
    setForm((f) => ({ ...f, [key]: [...f[key], ""] }));
  }
  function removeRecipient(i: number, key: "recipients" | "cc") {
    setForm((f) => ({ ...f, [key]: f[key].filter((_, idx) => idx !== i) }));
  }

  const showForm = adding || editingId !== null;
  const hasEntries = sorted.length > 0;

  return (
    <section className="space-y-3 border-t border-zinc-800 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Privilege Log</h3>
          <p className="text-xs text-gray-500">
            FRCP 26(b)(5)(A) — track documents withheld from production.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm(emptyForm());
              setAdding((a) => !a);
            }}
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {adding ? "Cancel" : "Add Entry"}
          </button>
          {hasEntries && (
            <Link
              href={`/api/cases/${caseId}/privilege-log/pdf`}
              className="inline-flex items-center rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-900"
            >
              Download PDF
            </Link>
          )}
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {!isLoading && !hasEntries && !showForm && (
        <p className="rounded-md border border-dashed border-zinc-700 p-4 text-sm text-gray-500">
          No privilege log entries yet. Add the first entry to begin tracking
          withheld documents.
        </p>
      )}

      {hasEntries && (
        <div className="overflow-hidden rounded-md border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-xs uppercase text-zinc-400">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Author</th>
                <th className="px-3 py-2 text-left">Recipients</th>
                <th className="px-3 py-2 text-left">Basis</th>
                <th className="px-3 py-2 text-left">Bates</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {sorted.map((e) => {
                const isOpen = expanded.has(e.id);
                return (
                  <Fragment key={e.id}>
                    <tr
                      className="cursor-pointer hover:bg-zinc-900/40"
                      onClick={() => {
                        setExpanded((s) => {
                          const n = new Set(s);
                          if (n.has(e.id)) n.delete(e.id);
                          else n.add(e.id);
                          return n;
                        });
                      }}
                    >
                      <td className="px-3 py-2">{e.entryNumber}</td>
                      <td className="px-3 py-2">
                        {e.documentDate
                          ? String(e.documentDate).slice(0, 10)
                          : "—"}
                      </td>
                      <td className="px-3 py-2">{e.documentType ?? "—"}</td>
                      <td className="px-3 py-2">{e.author ?? "—"}</td>
                      <td className="px-3 py-2">
                        {truncList(e.recipients as string[] | null)}
                      </td>
                      <td className="px-3 py-2">
                        {BASIS_ABBREV[e.privilegeBasis as PrivilegeBasis]}
                      </td>
                      <td className="px-3 py-2">{e.batesRange ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-xs text-gray-500">
                          {isOpen ? "▾" : "▸"}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-zinc-900/30">
                        <td colSpan={8} className="px-4 py-3 text-sm">
                          <div className="space-y-2">
                            {e.subject && (
                              <div>
                                <span className="text-xs font-semibold text-zinc-400">Subject:</span>{" "}
                                {e.subject}
                              </div>
                            )}
                            {e.description && (
                              <div>
                                <span className="text-xs font-semibold text-zinc-400">Description:</span>{" "}
                                {e.description}
                              </div>
                            )}
                            {((e.recipients as string[]) ?? []).length > 0 && (
                              <div>
                                <span className="text-xs font-semibold text-zinc-400">Recipients:</span>{" "}
                                {(e.recipients as string[]).join(", ")}
                              </div>
                            )}
                            {((e.cc as string[]) ?? []).length > 0 && (
                              <div>
                                <span className="text-xs font-semibold text-zinc-400">CC:</span>{" "}
                                {(e.cc as string[]).join(", ")}
                              </div>
                            )}
                            {e.basisExplanation && (
                              <div>
                                <span className="text-xs font-semibold text-zinc-400">Basis explanation:</span>{" "}
                                {e.basisExplanation}
                              </div>
                            )}
                            <div className="text-xs text-zinc-500">
                              Withheld by {e.withheldBy}
                            </div>
                            <div className="flex gap-2 pt-2">
                              <button
                                type="button"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  startEdit(e);
                                }}
                                className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  if (confirm("Delete this entry?")) {
                                    del.mutate({ id: e.id });
                                  }
                                }}
                                className="rounded-md border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-950"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="space-y-3 rounded-md border border-zinc-700 bg-zinc-900/40 p-4">
          <h4 className="text-sm font-semibold">
            {editingId ? "Edit Entry" : "New Privilege Log Entry"}
          </h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-xs">
              Entry # (auto if blank)
              <input
                type="number"
                min={1}
                max={9999}
                value={form.entryNumber}
                onChange={(e) =>
                  setForm({
                    ...form,
                    entryNumber: e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              Document Date
              <input
                type="date"
                value={form.documentDate}
                onChange={(e) => setForm({ ...form, documentDate: e.target.value })}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              Document Type
              <input
                type="text"
                placeholder="email, memo, letter…"
                value={form.documentType}
                onChange={(e) => setForm({ ...form, documentType: e.target.value })}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              Author / Sender
              <input
                type="text"
                value={form.author}
                onChange={(e) => setForm({ ...form, author: e.target.value })}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              Withheld By
              <select
                value={form.withheldBy}
                onChange={(e) =>
                  setForm({
                    ...form,
                    withheldBy: e.target.value as "plaintiff" | "defendant",
                  })
                }
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              >
                <option value="plaintiff">Plaintiff</option>
                <option value="defendant">Defendant</option>
              </select>
            </label>
            <label className="text-xs">
              Privilege Basis
              <select
                value={form.privilegeBasis}
                onChange={(e) =>
                  setForm({
                    ...form,
                    privilegeBasis: e.target.value as PrivilegeBasis,
                  })
                }
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              >
                {BASIS_OPTIONS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs md:col-span-2">
              Related RFP / Discovery Request (optional)
              <select
                value={form.relatedRequestId ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    relatedRequestId: e.target.value || null,
                  })
                }
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              >
                <option value="">— Standalone (none) —</option>
                {(discoveryRequests ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs md:col-span-2">
              Bates Range
              <input
                type="text"
                placeholder="e.g. ABC000123–ABC000125"
                value={form.batesRange}
                onChange={(e) => setForm({ ...form, batesRange: e.target.value })}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold">Recipients</div>
            {form.recipients.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={r}
                  onChange={(e) => setRecipientAt(i, e.target.value, "recipients")}
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeRecipient(i, "recipients")}
                  className="rounded-md border border-zinc-700 px-2 text-xs"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addRecipient("recipients")}
              className="text-xs text-blue-400 hover:underline"
            >
              + Add recipient
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold">CC</div>
            {form.cc.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={r}
                  onChange={(e) => setRecipientAt(i, e.target.value, "cc")}
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeRecipient(i, "cc")}
                  className="rounded-md border border-zinc-700 px-2 text-xs"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addRecipient("cc")}
              className="text-xs text-blue-400 hover:underline"
            >
              + Add CC
            </button>
          </div>

          <label className="block text-xs">
            Subject
            <input
              type="text"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs">
            Description (carefully phrased; do not reveal privileged content)
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs">
            Basis Explanation (optional)
            <textarea
              rows={2}
              value={form.basisExplanation}
              onChange={(e) => setForm({ ...form, basisExplanation: e.target.value })}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setEditingId(null);
                setForm(emptyForm());
              }}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={create.isPending || update.isPending}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {editingId ? "Save Changes" : "Add Entry"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
