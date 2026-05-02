"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { PredictionTargetKind, OpposingCounselPrediction } from "@/server/db/schema/opposing-counsel-predictions";
import { PredictionScorecard } from "./scorecard";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caseId: string;
  targetKind: PredictionTargetKind;
  targetId: string;
  targetTitle: string;
  targetBody: string;
}

type AttorneyChoice = { profileId: string; name: string; firm?: string | null };

type ParsedErr =
  | { kind: "needsAttorney" }
  | { kind: "needsAttorneyChoice"; options: AttorneyChoice[] }
  | null;

function parseErr(message: string): ParsedErr {
  try {
    const obj = JSON.parse(message) as { kind?: string; options?: AttorneyChoice[] };
    if (obj.kind === "needsAttorney") return { kind: "needsAttorney" };
    if (obj.kind === "needsAttorneyChoice")
      return { kind: "needsAttorneyChoice", options: obj.options ?? [] };
    return null;
  } catch {
    return null;
  }
}

export function PredictionDialog(props: Props) {
  const { open, onOpenChange, caseId, targetKind, targetId, targetTitle, targetBody } = props;
  const [profileId, setProfileId] = useState<string | undefined>();
  const [parsed, setParsed] = useState<ParsedErr>(null);
  const [data, setData] = useState<OpposingCounselPrediction | null>(null);

  const predict = trpc.opposingCounsel.predictResponse.useMutation({
    onSuccess: (row) => {
      setParsed(null);
      setData(row as OpposingCounselPrediction);
    },
    onError: (e) => {
      const p = parseErr(e.message);
      if (p) {
        setParsed(p);
      } else {
        toast.error(e.message);
      }
    },
  });

  // reset on close
  useEffect(() => {
    if (!open) {
      setProfileId(undefined);
      setParsed(null);
      setData(null);
      predict.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function run(regenerate?: boolean) {
    predict.mutate({
      caseId,
      targetKind,
      targetId,
      targetTitle,
      targetBody,
      profileId,
      regenerate,
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="predict-dialog-title"
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="predict-dialog-title" className="text-lg font-semibold">
            Predict opposing response
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={predict.isPending}
            aria-label="Close dialog"
            className="text-zinc-400 hover:text-zinc-100 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Initial state */}
        {!data && !predict.isPending && !parsed && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Analyze how opposing counsel is likely to respond to this draft.
              Returns a scorecard with settle probability, response timeline,
              key objections, and recommended prep.
            </p>
            <button
              type="button"
              onClick={() => run(false)}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
            >
              Run prediction (2 credits)
            </button>
          </div>
        )}

        {/* Loading */}
        {predict.isPending && (
          <div className="space-y-3">
            <div className="h-6 w-1/2 animate-pulse rounded bg-zinc-800" />
            <div className="h-32 w-full animate-pulse rounded bg-zinc-800" />
            <p className="text-xs text-zinc-500">Analyzing… ~10 seconds.</p>
            <p className="text-xs text-zinc-500">Closing won&apos;t cancel the prediction.</p>
          </div>
        )}

        {/* Needs attorney */}
        {parsed?.kind === "needsAttorney" && (
          <div className="space-y-3 text-sm">
            <p className="rounded bg-amber-900/40 px-3 py-2 text-amber-200">
              No opposing counsel attached to this case.
            </p>
            <p className="text-zinc-400">
              Add one in the <strong>Opposing Counsel</strong> tab and try again.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Needs choice */}
        {parsed?.kind === "needsAttorneyChoice" && (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-300">
              Multiple opposing counsel attached. Pick one:
            </p>
            <select
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-zinc-100"
              value={profileId ?? ""}
              onChange={(e) => setProfileId(e.target.value || undefined)}
            >
              <option value="">— select attorney —</option>
              {parsed.options.map((c) => (
                <option key={c.profileId} value={c.profileId}>
                  {c.name}
                  {c.firm ? ` · ${c.firm}` : ""}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!profileId}
                onClick={() => {
                  setParsed(null);
                  run(false);
                }}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                Run prediction (2 credits)
              </button>
            </div>
          </div>
        )}

        {/* Result */}
        {data && (
          <div className="space-y-4">
            <PredictionScorecard row={data} />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setData(null);
                  run(true);
                }}
                disabled={predict.isPending}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
              >
                Regenerate (2 credits)
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
