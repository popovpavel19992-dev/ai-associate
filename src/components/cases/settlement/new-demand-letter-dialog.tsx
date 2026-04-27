"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type LetterType =
  | "initial_demand"
  | "pre_litigation"
  | "pre_trial"
  | "response_to_demand";

const LETTER_TYPE_LABELS: Record<LetterType, string> = {
  initial_demand: "Initial Demand",
  pre_litigation: "Pre-Litigation",
  pre_trial: "Pre-Trial",
  response_to_demand: "Response to Demand",
};

export function NewDemandLetterDialog({
  caseId,
  onClose,
}: {
  caseId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [letterType, setLetterType] = useState<LetterType>("initial_demand");
  const [recipientName, setRecipientName] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [demandAmountStr, setDemandAmountStr] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [keyFacts, setKeyFacts] = useState("");
  const [legalBasis, setLegalBasis] = useState("");
  const [demandTerms, setDemandTerms] = useState("");
  const [letterBody, setLetterBody] = useState("");

  const createMut = trpc.settlement.demandLetters.create.useMutation({
    onSuccess: async (out) => {
      toast.success(`Demand letter #${out.letterNumber} created (draft)`);
      await utils.settlement.demandLetters.listForCase.invalidate({ caseId });
      onClose();
      router.push(`/cases/${caseId}/settlement/demand-letters/${out.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!recipientName.trim()) {
      toast.error("Recipient name is required");
      return;
    }
    let demandAmountCents: number | null = null;
    if (demandAmountStr.trim().length > 0) {
      const f = parseFloat(demandAmountStr);
      if (!Number.isFinite(f) || f < 0) {
        toast.error("Demand amount must be non-negative");
        return;
      }
      demandAmountCents = Math.round(f * 100);
    }
    createMut.mutate({
      caseId,
      letterType,
      recipientName: recipientName.trim(),
      recipientAddress: recipientAddress.trim() || null,
      recipientEmail: recipientEmail.trim() || null,
      demandAmountCents,
      currency: currency.trim().toUpperCase() || "USD",
      deadlineDate: deadlineDate || null,
      keyFacts: keyFacts.trim() || null,
      legalBasis: legalBasis.trim() || null,
      demandTerms: demandTerms.trim() || null,
      letterBody: letterBody.trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Demand Letter</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Letter Type
              </label>
              <select
                value={letterType}
                onChange={(e) => setLetterType(e.target.value as LetterType)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              >
                {(Object.keys(LETTER_TYPE_LABELS) as LetterType[]).map((k) => (
                  <option key={k} value={k}>
                    {LETTER_TYPE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Deadline
              </label>
              <input
                type="date"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
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
                Recipient Email
              </label>
              <input
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Demand Amount
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={demandAmountStr}
                  onChange={(e) => setDemandAmountStr(e.target.value)}
                  placeholder="50000.00"
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
                />
                <input
                  value={currency}
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 uppercase"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Key Facts (used in PDF if no full body provided)
            </label>
            <textarea
              value={keyFacts}
              onChange={(e) => setKeyFacts(e.target.value)}
              rows={4}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Legal Basis
            </label>
            <textarea
              value={legalBasis}
              onChange={(e) => setLegalBasis(e.target.value)}
              rows={3}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Demand Terms
            </label>
            <textarea
              value={demandTerms}
              onChange={(e) => setDemandTerms(e.target.value)}
              rows={3}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Full Letter Body (overrides structured sections in PDF)
            </label>
            <textarea
              value={letterBody}
              onChange={(e) => setLetterBody(e.target.value)}
              rows={6}
              placeholder="Optional. If filled, replaces all structured sections (intro, facts, legal basis, demand, closing) with this exact text."
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-xs"
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
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {createMut.isPending ? "Creating…" : "Create Draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
