"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "./format";
import { NewSettlementOfferDialog } from "./new-settlement-offer-dialog";
import { CounterRecommenderButton } from "@/components/cases/settlement-coach/counter-recommender-button";

const RESPONSE_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  accepted: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  expired: "bg-zinc-200 text-zinc-700",
  withdrawn: "bg-zinc-200 text-zinc-700",
};

const TYPE_LABEL: Record<string, string> = {
  opening_demand: "Opening Demand",
  opening_offer: "Opening Offer",
  counter_offer: "Counter Offer",
  final_offer: "Final Offer",
  walkaway: "Walkaway",
};

export function SettlementOffersSection({
  caseId,
  betaEnabled = false,
}: {
  caseId: string;
  betaEnabled?: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefillAmountCents, setPrefillAmountCents] = useState<
    number | undefined
  >(undefined);
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.settlement.offers.listForCase.useQuery({
    caseId,
  });

  const respondMut = trpc.settlement.offers.recordResponse.useMutation({
    onSuccess: async () => {
      toast.success("Response recorded");
      await utils.settlement.offers.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.settlement.offers.delete.useMutation({
    onSuccess: async () => {
      toast.success("Offer deleted");
      await utils.settlement.offers.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  function respond(
    offerId: string,
    response: "accepted" | "rejected" | "withdrawn",
  ) {
    respondMut.mutate({ offerId, response });
  }

  function openNewOfferDialog(amountCents?: number) {
    setPrefillAmountCents(amountCents);
    setDialogOpen(true);
  }

  function closeNewOfferDialog() {
    setDialogOpen(false);
    setPrefillAmountCents(undefined);
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">
          Settlement Offers
        </h3>
        <button
          type="button"
          onClick={() => openNewOfferDialog()}
          className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
        >
          New Offer
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (rows ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">No settlement offers yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
          {(rows ?? []).map((o) => (
            <li key={o.id} className="p-4 hover:bg-zinc-900/40">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  Offer #{o.offerNumber} —{" "}
                  {formatCurrency(o.amountCents, o.currency)} (
                  {TYPE_LABEL[o.offerType] ?? o.offerType})
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    RESPONSE_BADGE[o.response] ?? "bg-gray-100 text-gray-800"
                  }`}
                >
                  {o.response}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                <span>From: {o.fromParty === "plaintiff" ? "Plaintiff" : "Defendant"}</span>
                <span>
                  Offered {new Date(o.offeredAt).toLocaleDateString()}
                </span>
                {o.expiresAt ? (
                  <span>
                    Expires {new Date(o.expiresAt).toLocaleDateString()}
                  </span>
                ) : null}
                {o.responseDate ? (
                  <span>
                    Responded {new Date(o.responseDate).toLocaleDateString()}
                  </span>
                ) : null}
              </div>
              {o.terms ? (
                <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">
                  Terms: {o.terms}
                </p>
              ) : null}
              {o.response === "pending" && (
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    onClick={() => respond(o.id, "accepted")}
                    className="rounded border border-emerald-700 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-900/40"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(o.id, "rejected")}
                    className="rounded border border-rose-700 px-2 py-0.5 text-xs text-rose-300 hover:bg-rose-900/40"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(o.id, "withdrawn")}
                    className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Withdraw
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Delete this offer?")) {
                        deleteMut.mutate({ offerId: o.id });
                      }
                    }}
                    className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    Delete
                  </button>
                  {o.fromParty === "defendant" && (
                    <CounterRecommenderButton
                      caseId={caseId}
                      offerId={o.id}
                      offerAmountCents={o.amountCents}
                      betaEnabled={betaEnabled}
                      onUseVariant={(counterCents) =>
                        openNewOfferDialog(counterCents)
                      }
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialogOpen ? (
        <NewSettlementOfferDialog
          caseId={caseId}
          onClose={closeNewOfferDialog}
          prefillAmountCents={prefillAmountCents}
          prefillFromParty="plaintiff"
          prefillOfferType="counter_offer"
        />
      ) : null}
    </section>
  );
}
