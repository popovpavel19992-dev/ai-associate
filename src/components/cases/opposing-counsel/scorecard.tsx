"use client";

import type { OpposingCounselPrediction } from "@/server/db/schema/opposing-counsel-predictions";

const dot = (c: string | null | undefined) =>
  c === "high" ? "●●●" : c === "med" ? "●●○" : c === "low" ? "●○○" : "";

type Item = { point: string; confidence?: string | null };
type Source = { id: string; title: string };

export function PredictionScorecard({ row }: { row: OpposingCounselPrediction }) {
  const objections = (row.keyObjections ?? []) as Item[];
  const prep = (row.recommendedPrep ?? []) as Item[];
  const sources = (row.sourcesJson ?? []) as Source[];

  const settleLow = row.settleProbLow != null ? Math.round(Number(row.settleProbLow) * 100) : null;
  const settleHigh = row.settleProbHigh != null ? Math.round(Number(row.settleProbHigh) * 100) : null;

  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs uppercase tracking-wide text-zinc-400">
        Predicted response · confidence: {row.confidenceOverall ?? "—"}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="text-zinc-400">Likely response</div>
        <div className="text-zinc-100">
          {row.likelyResponse}{" "}
          <span className="text-violet-400" aria-label="confidence">
            {dot(row.confidenceOverall)}
          </span>
        </div>
        <div className="text-zinc-400">Settle probability</div>
        <div className="text-zinc-100">
          {settleLow != null && settleHigh != null ? `${settleLow}–${settleHigh}%` : "—"}
        </div>
        <div className="text-zinc-400">Response timeline</div>
        <div className="text-zinc-100">
          {row.estResponseDaysLow != null && row.estResponseDaysHigh != null
            ? `${row.estResponseDaysLow}–${row.estResponseDaysHigh} days`
            : "—"}
        </div>
        <div className="text-zinc-400">Aggressiveness</div>
        <div className="text-zinc-100">
          {row.aggressiveness != null ? `${row.aggressiveness}/10` : "—"}
        </div>
      </div>
      <Section title="Key objections" items={objections} />
      <Section title="Recommended prep" items={prep} />
      <details className="rounded border border-zinc-800 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Reasoning
        </summary>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">
          {row.reasoningMd}
        </pre>
      </details>
      <details className="rounded border border-zinc-800 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Sources ({sources.length})
        </summary>
        {sources.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-xs text-zinc-300">
            {sources.map((s) => (
              <li key={s.id}>{s.title}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">No sources cited.</p>
        )}
      </details>
    </div>
  );
}

function Section({ title, items }: { title: string; items: Item[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </div>
      <ul className="mt-1 list-disc pl-5 text-zinc-200">
        {items.map((it, i) => (
          <li key={i}>
            {it.point}{" "}
            {it.confidence ? (
              <span className="text-violet-400" aria-label="confidence">
                {dot(it.confidence)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
