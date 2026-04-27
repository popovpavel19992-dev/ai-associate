"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type SubpoenaType = "testimony" | "documents" | "both";
type IssuingParty = "plaintiff" | "defendant";

export function NewSubpoenaDialog({
  caseId,
  onClose,
}: {
  caseId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [subpoenaType, setSubpoenaType] = useState<SubpoenaType>("documents");
  const [issuingParty, setIssuingParty] = useState<IssuingParty>("plaintiff");
  const [recipientName, setRecipientName] = useState("");
  const [recipientRole, setRecipientRole] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [complianceDate, setComplianceDate] = useState("");
  const [complianceLocation, setComplianceLocation] = useState("");
  const [documentsText, setDocumentsText] = useState("");
  const [topicsText, setTopicsText] = useState("");
  const [notes, setNotes] = useState("");

  const showDocs = subpoenaType === "documents" || subpoenaType === "both";
  const showTopics = subpoenaType === "testimony" || subpoenaType === "both";

  const createMut = trpc.subpoenas.create.useMutation({
    onSuccess: async (out) => {
      toast.success(`Subpoena #${out.subpoenaNumber} created`);
      await utils.subpoenas.listForCase.invalidate({ caseId });
      onClose();
      router.push(`/cases/${caseId}/discovery/subpoenas/${out.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const docsAi = trpc.subpoenas.suggestDocuments.useMutation({
    onSuccess: (out) => {
      const items = out.items.filter(Boolean);
      if (items.length === 0) {
        toast.info("No suggestions returned");
        return;
      }
      setDocumentsText((prev) =>
        [prev, items.join("\n")].filter((s) => s.trim().length > 0).join("\n"),
      );
      toast.success(`Added ${items.length} suggestion${items.length === 1 ? "" : "s"}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const topicsAi = trpc.subpoenas.suggestTopics.useMutation({
    onSuccess: (out) => {
      const items = out.items.filter(Boolean);
      if (items.length === 0) {
        toast.info("No suggestions returned");
        return;
      }
      setTopicsText((prev) =>
        [prev, items.join("\n")].filter((s) => s.trim().length > 0).join("\n"),
      );
      toast.success(`Added ${items.length} suggestion${items.length === 1 ? "" : "s"}`);
    },
    onError: (e) => toast.error(e.message),
  });

  function parseLines(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!recipientName.trim()) {
      toast.error("Recipient name is required");
      return;
    }
    createMut.mutate({
      caseId,
      subpoenaType,
      issuingParty,
      recipientName: recipientName.trim(),
      recipientAddress: recipientAddress.trim() || null,
      recipientEmail: recipientEmail.trim() || null,
      recipientPhone: recipientPhone.trim() || null,
      complianceDate: complianceDate || null,
      complianceLocation: complianceLocation.trim() || null,
      documentsRequested: showDocs ? parseLines(documentsText) : [],
      testimonyTopics: showTopics ? parseLines(topicsText) : [],
      notes: notes.trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Subpoena (FRCP 45)</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          {/* Type */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Subpoena Type
            </label>
            <div className="flex gap-3">
              {(["documents", "testimony", "both"] as SubpoenaType[]).map((t) => (
                <label key={t} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={subpoenaType === t}
                    onChange={() => setSubpoenaType(t)}
                  />
                  <span className="capitalize">{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Issuing party */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Issuing Party
            </label>
            <div className="flex gap-3">
              {(["plaintiff", "defendant"] as IssuingParty[]).map((p) => (
                <label key={p} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={issuingParty === p}
                    onChange={() => setIssuingParty(p)}
                  />
                  <span className="capitalize">{p}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Recipient */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Recipient Name *
              </label>
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Recipient Role (free-text, e.g. "former employer", "bank")
              </label>
              <input
                value={recipientRole}
                onChange={(e) => setRecipientRole(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
                placeholder="(used for AI suggestion context)"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Recipient Address
              </label>
              <textarea
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                rows={2}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Email
              </label>
              <input
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Phone
              </label>
              <input
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
          </div>

          {/* Compliance */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Compliance Date
              </label>
              <input
                type="date"
                value={complianceDate}
                onChange={(e) => setComplianceDate(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Compliance Location
              </label>
              <input
                value={complianceLocation}
                onChange={(e) => setComplianceLocation(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
                placeholder="Courtroom or attorney office"
              />
            </div>
          </div>

          {/* Documents */}
          {showDocs ? (
            <div>
              <div className="flex items-center justify-between">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Documents Requested (one per line)
                </label>
                <button
                  type="button"
                  disabled={docsAi.isPending || !recipientName.trim()}
                  onClick={() =>
                    docsAi.mutate({
                      caseId,
                      recipientName: recipientName.trim(),
                      recipientRole: recipientRole.trim() || undefined,
                    })
                  }
                  className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                >
                  {docsAi.isPending ? "Suggesting…" : "Suggest from case facts"}
                </button>
              </div>
              <textarea
                value={documentsText}
                onChange={(e) => setDocumentsText(e.target.value)}
                rows={6}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-xs"
                placeholder={"e.g.\nAll emails between [Recipient] and Plaintiff from 2024-01-01 to present\nAll personnel records for John Doe"}
              />
            </div>
          ) : null}

          {/* Topics */}
          {showTopics ? (
            <div>
              <div className="flex items-center justify-between">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Testimony Topics (one per line)
                </label>
                <button
                  type="button"
                  disabled={topicsAi.isPending || !recipientName.trim()}
                  onClick={() =>
                    topicsAi.mutate({
                      caseId,
                      recipientName: recipientName.trim(),
                      recipientRole: recipientRole.trim() || undefined,
                    })
                  }
                  className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                >
                  {topicsAi.isPending ? "Suggesting…" : "Suggest from case facts"}
                </button>
              </div>
              <textarea
                value={topicsText}
                onChange={(e) => setTopicsText(e.target.value)}
                rows={6}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-xs"
                placeholder={"e.g.\nThe Recipient's knowledge of the underlying transaction\nCommunications with the Plaintiff regarding the contract"}
              />
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMut.isPending}
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {createMut.isPending ? "Creating…" : "Create Draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
