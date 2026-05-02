"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type OfferType =
  | "opening_demand"
  | "opening_offer"
  | "counter_offer"
  | "final_offer"
  | "walkaway";
type FromParty = "plaintiff" | "defendant";

const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  opening_demand: "Opening Demand",
  opening_offer: "Opening Offer",
  counter_offer: "Counter Offer",
  final_offer: "Final Offer",
  walkaway: "Walkaway",
};

export function NewSettlementOfferDialog({
  caseId,
  onClose,
  prefillAmountCents,
  prefillFromParty,
  prefillOfferType,
}: {
  caseId: string;
  onClose: () => void;
  prefillAmountCents?: number;
  prefillFromParty?: FromParty;
  prefillOfferType?: OfferType;
}) {
  const utils = trpc.useUtils();
  const [amountStr, setAmountStr] = useState(
    prefillAmountCents != null ? (prefillAmountCents / 100).toFixed(2) : "",
  );
  const [currency, setCurrency] = useState("USD");
  const [offerType, setOfferType] = useState<OfferType>(
    prefillOfferType ?? "counter_offer",
  );
  const [fromParty, setFromParty] = useState<FromParty>(
    prefillFromParty ?? "defendant",
  );
  const [terms, setTerms] = useState("");
  const [conditions, setConditions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");

  const createMut = trpc.settlement.offers.create.useMutation({
    onSuccess: async (out) => {
      toast.success(`Offer #${out.offerNumber} recorded`);
      await utils.settlement.offers.listForCase.invalidate({ caseId });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountFloat = parseFloat(amountStr);
    if (!Number.isFinite(amountFloat) || amountFloat < 0) {
      toast.error("Amount must be a non-negative number");
      return;
    }
    const amountCents = Math.round(amountFloat * 100);
    createMut.mutate({
      caseId,
      amountCents,
      currency: currency.trim().toUpperCase() || "USD",
      offerType,
      fromParty,
      terms: terms.trim() || null,
      conditions: conditions.trim() || null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      notes: notes.trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Settlement Offer</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-1">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Amount *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="50000.00"
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Currency
              </label>
              <input
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 uppercase"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Offer Type
              </label>
              <select
                value={offerType}
                onChange={(e) => setOfferType(e.target.value as OfferType)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              >
                {(
                  Object.keys(OFFER_TYPE_LABELS) as OfferType[]
                ).map((k) => (
                  <option key={k} value={k}>
                    {OFFER_TYPE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                From Party
              </label>
              <select
                value={fromParty}
                onChange={(e) => setFromParty(e.target.value as FromParty)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              >
                <option value="plaintiff">Plaintiff</option>
                <option value="defendant">Defendant</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Expires At
            </label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Non-monetary Terms
            </label>
            <textarea
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={3}
              placeholder="NDAs, mutual releases, structured payments..."
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Conditions
            </label>
            <textarea
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              rows={3}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
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
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {createMut.isPending ? "Saving…" : "Record Offer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
