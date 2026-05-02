"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const dot = (c?: string | null) =>
  c === "high" ? "●●●" : c === "med" ? "●●○" : c === "low" ? "●○○" : "";

const formatUsd = (cents: number | null | undefined) => {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
};

interface Variant {
  tag: string;
  counterCents: number;
  rationaleMd: string;
  riskMd: string;
  confidence: string;
  clamped: boolean;
}

type ParsedErr = { kind: "needsBatna" } | null;

function parseErr(message: string): ParsedErr {
  try {
    const obj = JSON.parse(message) as { kind?: string };
    if (obj.kind === "needsBatna") return { kind: "needsBatna" };
    return null;
  } catch {
    return null;
  }
}

export function CounterDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caseId: string;
  offerId: string;
  offerAmountCents: number;
  onUseVariant?: (counterCents: number) => void;
}) {
  const [parsed, setParsed] = useState<ParsedErr>(null);
  const recommend = trpc.settlementCoach.recommendCounter.useMutation({
    onError: (e) => {
      const p = parseErr(e.message);
      if (p) {
        setParsed(p);
      } else {
        toast.error(e.message);
      }
    },
    onSuccess: () => {
      setParsed(null);
    },
  });

  // reset when closed
  useEffect(() => {
    if (!props.open) {
      setParsed(null);
      recommend.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const closeDisabled = recommend.isPending;
  const data = recommend.data;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (!closeDisabled) props.onOpenChange(v);
      }}
    >
      <DialogContent
        role="dialog"
        aria-modal="true"
        aria-labelledby="counter-dialog-title"
        className="max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle id="counter-dialog-title">
            Counter to {formatUsd(props.offerAmountCents)} offer
          </DialogTitle>
        </DialogHeader>

        {!data && !recommend.isPending && !parsed && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">
              Generates 3 counter-offer variants (aggressive / standard /
              conciliatory) bounded by your BATNA. Run BATNA first if you
              haven&apos;t.
            </p>
            <Button
              onClick={() =>
                recommend.mutate({
                  caseId: props.caseId,
                  offerId: props.offerId,
                })
              }
            >
              Run recommender (2 credits)
            </Button>
          </div>
        )}

        {parsed?.kind === "needsBatna" && (
          <div className="space-y-3 text-sm">
            <p className="rounded bg-amber-900/40 px-3 py-2 text-amber-200">
              Compute BATNA first (3 credits) in the Settlement strategy card
              above, then come back.
            </p>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={() => props.onOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </div>
        )}

        {recommend.isPending && (
          <div className="space-y-2">
            <div className="h-32 w-full animate-pulse rounded bg-zinc-800" />
            <p className="text-xs text-zinc-500">
              Closing won&apos;t cancel the recommendation.
            </p>
          </div>
        )}

        {data && (
          <div className="space-y-3">
            {((data.variantsJson as Variant[] | null) ?? []).map((v) => (
              <div
                key={v.tag}
                className="rounded border border-zinc-700 p-3"
              >
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-sm uppercase tracking-wide">
                    {v.tag}{" "}
                    <span className="ml-1 text-zinc-400">
                      {dot(v.confidence)}
                    </span>
                  </div>
                  <div className="text-lg font-semibold">
                    {formatUsd(v.counterCents)}
                  </div>
                </div>
                <div className="text-sm">
                  <div className="mb-1">
                    <span className="font-semibold">Rationale:</span>{" "}
                    {v.rationaleMd}
                  </div>
                  <div>
                    <span className="font-semibold">Risk:</span> {v.riskMd}
                  </div>
                  {v.clamped && (
                    <div className="mt-1 text-xs text-amber-500">
                      ⚠ clamped to bounds
                    </div>
                  )}
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      props.onUseVariant?.(v.counterCents);
                      props.onOpenChange(false);
                    }}
                  >
                    Use this →
                  </Button>
                </div>
              </div>
            ))}
            {data.reasoningMd && (
              <details>
                <summary className="cursor-pointer text-sm">
                  Reasoning
                </summary>
                <article className="prose prose-sm whitespace-pre-wrap dark:prose-invert">
                  {data.reasoningMd}
                </article>
              </details>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={recommend.isPending}
                onClick={() =>
                  recommend.mutate({
                    caseId: props.caseId,
                    offerId: props.offerId,
                    regenerate: true,
                  })
                }
              >
                Regenerate (2cr)
              </Button>
              <Button
                onClick={() => props.onOpenChange(false)}
                disabled={closeDisabled}
                aria-label="Close dialog"
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
