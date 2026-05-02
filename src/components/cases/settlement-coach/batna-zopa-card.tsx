"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { SensitivityPanel } from "./sensitivity-panel";
import { ComponentsEditor, type Component } from "./components-editor";

const dot = (c?: string | null) =>
  c === "high" ? "●●●" : c === "med" ? "●●○" : c === "low" ? "●○○" : "";

function formatUsd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function Skel() {
  return <div className="h-64 w-full animate-pulse rounded bg-zinc-800" />;
}

export function BatnaZopaCard({
  caseId,
  caseSummary,
  betaEnabled,
}: {
  caseId: string;
  caseSummary: string;
  betaEnabled: boolean;
}) {
  const utils = trpc.useUtils();
  const [editorOpen, setEditorOpen] = useState(false);
  const q = trpc.settlementCoach.getBatna.useQuery(
    { caseId },
    { enabled: betaEnabled },
  );
  const compute = trpc.settlementCoach.computeBatna.useMutation({
    onSuccess: async () => {
      toast.success("BATNA computed");
      await utils.settlementCoach.getBatna.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!betaEnabled) return null;
  const row = q.data;

  if (!row && !q.isLoading) {
    return (
      <div className="rounded-lg border border-zinc-700 p-4">
        <div className="mb-2 text-sm font-semibold">Settlement strategy</div>
        <p className="mb-3 text-sm text-zinc-500">
          Compute BATNA / ZOPA to enable counter-offer recommendations.
        </p>
        <Button
          disabled={compute.isPending || !caseSummary}
          onClick={() => compute.mutate({ caseId, caseSummary })}
        >
          {compute.isPending
            ? "Analyzing…"
            : "Compute BATNA / ZOPA (3 credits)"}
        </Button>
      </div>
    );
  }
  if (q.isLoading || compute.isPending) return <Skel />;
  if (!row) return null;

  const components = (row.damagesComponents as Component[] | null) ?? [];
  const sensitivity = (row.sensitivityJson as Array<{
    winProb: number;
    batnaLowCents: number;
    batnaLikelyCents: number;
    batnaHighCents: number;
  }> | null) ?? [];
  const likelyWp =
    row.winProbLikely != null ? Number(row.winProbLikely) : null;

  return (
    <div className="space-y-3 rounded-lg border border-zinc-700 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">
          Settlement strategy{" "}
          <span className="text-zinc-400">{dot(row.confidenceOverall)}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={compute.isPending}
          onClick={() =>
            compute.mutate({ caseId, caseSummary, regenerate: true })
          }
        >
          Recompute (3cr)
        </Button>
      </div>

      <div className="text-sm">
        <div>
          <span className="font-semibold">BATNA</span>{" "}
          {formatUsd(row.batnaLowCents)} – {formatUsd(row.batnaHighCents)} (likely{" "}
          {formatUsd(row.batnaLikelyCents)})
        </div>
        <div className="mt-1">
          <span className="font-semibold">ZOPA</span>{" "}
          {row.zopaExists ? (
            <>
              {formatUsd(row.zopaLowCents)} – {formatUsd(row.zopaHighCents)}
            </>
          ) : (
            <span className="text-amber-500">
              no settlement zone — trial likely unless one side moves
              significantly
            </span>
          )}
        </div>
      </div>

      <div className="text-sm">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold">Damage components</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditorOpen(true)}
          >
            Edit components
          </Button>
        </div>
        {components.length === 0 ? (
          <p className="text-zinc-500">—</p>
        ) : (
          <ul>
            {components.map((c, i) => (
              <li key={i} className="grid grid-cols-2 py-0.5">
                <span>{c.label || "(unlabeled)"}</span>
                <span className="text-zinc-500">
                  {formatUsd(c.lowCents)} – {formatUsd(c.highCents)}{" "}
                  <span className="text-xs">(source: {c.source})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SensitivityPanel rows={sensitivity} likelyWinProb={likelyWp} />

      {row.reasoningMd && (
        <details>
          <summary className="cursor-pointer text-sm">Reasoning</summary>
          <article className="prose prose-sm whitespace-pre-wrap dark:prose-invert">
            {row.reasoningMd}
          </article>
        </details>
      )}

      <ComponentsEditor
        key={row.id}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        caseId={caseId}
        caseSummary={caseSummary}
        initial={components}
      />
    </div>
  );
}
