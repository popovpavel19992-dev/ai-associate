"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { OpposingCounselPosture } from "@/server/db/schema/opposing-counsel-postures";

const dot = (c: string | null | undefined) =>
  c === "high" ? "●●●" : c === "med" ? "●●○" : c === "low" ? "●○○" : "";

type Motion = { label: string; pct: number; confidence?: string | null };

export function PostureCard({
  caseId,
  profileId,
  attorneyName,
}: {
  caseId: string;
  profileId: string;
  attorneyName?: string;
}) {
  const [row, setRow] = useState<OpposingCounselPosture | null>(null);

  const m = trpc.opposingCounsel.getPosture.useMutation({
    onSuccess: (r) => setRow(r as OpposingCounselPosture),
    onError: (e) => toast.error(e.message),
  });

  const motions = (row?.typicalMotions ?? []) as Motion[];
  const settleLow = row?.settleLow != null ? Math.round(Number(row.settleLow) * 100) : null;
  const settleHigh =
    row?.settleHigh != null ? Math.round(Number(row.settleHigh) * 100) : null;

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">
          Posture readout{attorneyName ? ` — ${attorneyName}` : ""}
        </h3>
        <button
          type="button"
          onClick={() =>
            m.mutate({ caseId, profileId, regenerate: !!row })
          }
          disabled={m.isPending}
          className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {m.isPending
            ? "Generating…"
            : row
              ? "Regenerate (2 credits)"
              : "Generate posture readout (2 credits)"}
        </button>
      </div>

      {!row && !m.isPending && (
        <p className="text-xs text-zinc-500">
          Generates a general profile of this attorney&apos;s posture (aggressiveness,
          typical motions, settle range). Cached per case-state.
        </p>
      )}

      {row && (
        <div className="space-y-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-zinc-400">
            confidence: {row.confidenceOverall ?? "—"}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div className="text-zinc-400">Aggressiveness</div>
            <div className="text-zinc-100">
              {row.aggressiveness != null ? `${row.aggressiveness}/10` : "—"}{" "}
              <span className="text-violet-400">
                {dot(row.confidenceOverall)}
              </span>
            </div>
            <div className="text-zinc-400">Settle posture</div>
            <div className="text-zinc-100">
              {settleLow != null && settleHigh != null
                ? `${settleLow}–${settleHigh}%`
                : "—"}
            </div>
          </div>
          {motions.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Typical motions
              </div>
              <ul className="mt-1 list-disc pl-5 text-zinc-200">
                {motions.map((mot, i) => (
                  <li key={i}>
                    {mot.label} ({Math.round(mot.pct * 100)}%){" "}
                    <span className="text-violet-400">{dot(mot.confidence)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="rounded border border-zinc-800 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Reasoning
            </summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">
              {row.reasoningMd}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
