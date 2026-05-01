"use client";
import { AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { RecommendationCard } from "./recommendation-card";

const CATEGORIES = ["procedural", "discovery", "substantive", "client"] as const;
const LABEL: Record<(typeof CATEGORIES)[number], string> = {
  procedural: "Procedural",
  discovery: "Discovery",
  substantive: "Substantive",
  client: "Client",
};

export function RecommendationsPanel({ caseId }: { caseId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.caseStrategy.getLatest.useQuery({ caseId });
  const refresh = trpc.caseStrategy.refresh.useMutation({
    onSuccess: () => {
      toast.success("Generating new strategy…");
      utils.caseStrategy.getLatest.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (data?.run?.status !== "pending") return;
    const t = setInterval(
      () => utils.caseStrategy.getLatest.invalidate({ caseId }),
      2500,
    );
    return () => clearInterval(t);
  }, [data?.run?.status, caseId, utils]);

  const recs = data?.recommendations ?? [];
  const grouped = CATEGORIES.map((cat) => ({
    cat,
    items: recs.filter((r) => r.category === cat),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-amber-200">
            AI-generated suggestions
          </p>
          <p className="text-xs text-amber-200/80">
            These recommendations are AI-generated and not legal advice.
            Independently verify each suggestion before acting.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-zinc-500" />
        </div>
      ) : !data?.run ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="mb-4 text-zinc-400">
            No strategy assessment yet for this case.
          </p>
          <Button
            onClick={() => refresh.mutate({ caseId })}
            disabled={refresh.isPending}
          >
            {refresh.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Generate strategy (10 credits)
          </Button>
        </div>
      ) : data.run.status === "pending" ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center">
          <Loader2 className="mx-auto mb-2 size-5 animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-400">Reviewing case context…</p>
        </div>
      ) : data.run.status === "failed" ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-6">
          <p className="text-sm text-red-300">
            {data.run.errorMessage ?? "Strategy generation failed."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => refresh.mutate({ caseId })}
          >
            Retry
          </Button>
        </div>
      ) : (
        <>
          {grouped.map(({ cat, items }) =>
            items.length === 0 ? null : (
              <section key={cat} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {LABEL[cat]}
                </h3>
                <div className="space-y-2">
                  {items.map((r) => (
                    <RecommendationCard
                      key={r.id}
                      caseId={caseId}
                      rec={{
                        id: r.id,
                        category: r.category as
                          | "procedural"
                          | "discovery"
                          | "substantive"
                          | "client",
                        priority: r.priority,
                        title: r.title,
                        rationale: r.rationale,
                        citations: (r.citations ?? []) as Array<{
                          kind:
                            | "document"
                            | "deadline"
                            | "filing"
                            | "motion"
                            | "message";
                          id: string;
                          excerpt?: string;
                        }>,
                      }}
                      onDismissed={() =>
                        utils.caseStrategy.getLatest.invalidate({ caseId })
                      }
                    />
                  ))}
                </div>
              </section>
            ),
          )}
          {recs.length === 0 && (
            <p className="text-sm text-zinc-500">
              No active recommendations. Refresh for new suggestions.
            </p>
          )}
          <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
            <p className="text-xs text-zinc-500">
              Last refresh:{" "}
              {new Date(
                data.run.finishedAt ?? data.run.startedAt,
              ).toLocaleString()}
            </p>
            <Button
              size="sm"
              onClick={() => refresh.mutate({ caseId })}
              disabled={refresh.isPending}
            >
              {refresh.isPending && (
                <Loader2 className="mr-2 size-3 animate-spin" />
              )}
              <RefreshCw className="mr-1.5 size-3" /> Refresh (10 cr)
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
