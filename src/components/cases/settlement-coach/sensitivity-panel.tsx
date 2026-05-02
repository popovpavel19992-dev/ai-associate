"use client";

interface Row {
  winProb: number;
  batnaLowCents: number;
  batnaLikelyCents: number;
  batnaHighCents: number;
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function SensitivityPanel({
  rows,
  likelyWinProb,
}: {
  rows: Row[] | null | undefined;
  likelyWinProb: number | null;
}) {
  if (!rows?.length) return null;
  return (
    <div>
      <div className="mb-1 text-sm font-semibold">
        Sensitivity — BATNA at win probability
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => {
            const isLikely =
              likelyWinProb != null &&
              Math.abs(r.winProb - likelyWinProb) < 0.08;
            return (
              <tr
                key={r.winProb}
                className={isLikely ? "bg-zinc-800/60" : ""}
              >
                <td className="py-1 pr-4 text-zinc-500">
                  {Math.round(r.winProb * 100)}%
                </td>
                <td>
                  {formatUsd(r.batnaLowCents ?? 0)} – {formatUsd(r.batnaHighCents ?? 0)}
                  {isLikely ? "    ← AI estimate" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
