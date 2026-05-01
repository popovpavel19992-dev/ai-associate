"use client";
import { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Loader2,
  FileQuestion,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type Status =
  | "good_law"
  | "caution"
  | "overruled"
  | "unverified"
  | "not_found"
  | "pending"
  | "malformed";

const STATUS_META: Record<
  Status,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  good_law: { icon: CheckCircle2, color: "text-emerald-500", label: "Good law" },
  caution: { icon: AlertTriangle, color: "text-amber-500", label: "Caution" },
  overruled: { icon: XCircle, color: "text-red-500", label: "Overruled" },
  unverified: { icon: HelpCircle, color: "text-zinc-500", label: "Unverified" },
  not_found: { icon: FileQuestion, color: "text-zinc-500", label: "Not in cache" },
  pending: { icon: Loader2, color: "text-zinc-400", label: "Resolving…" },
  malformed: { icon: AlertTriangle, color: "text-amber-600", label: "Malformed" },
};

interface Props {
  motionId: string;
  motionUpdatedAt: string | Date | null;
}

export function CiteCheckPanel({ motionId, motionUpdatedAt }: Props) {
  const utils = trpc.useUtils();
  const [showResults, setShowResults] = useState(false);

  const { data } = trpc.motionCiteCheck.get.useQuery(
    { motionId },
    {
      refetchInterval: (query) => {
        const r = query.state.data?.result;
        return r && r.pendingCites > 0 ? 5000 : false;
      },
    },
  );

  const run = trpc.motionCiteCheck.run.useMutation({
    onSuccess: () => {
      setShowResults(true);
      utils.motionCiteCheck.get.invalidate({ motionId });
    },
    onError: (e) => toast.error(e.message),
  });

  const result = data?.result ?? null;
  const stale =
    result &&
    motionUpdatedAt &&
    new Date(motionUpdatedAt).getTime() > new Date(result.runAt).getTime();

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-zinc-100">Citation check</h3>
          {result ? (
            <p className="text-xs text-zinc-500">
              Last run: {new Date(result.runAt).toLocaleString()} —{" "}
              {result.totalCites} cites, {result.creditsCharged} credits
              {result.pendingCites > 0 && ` (${result.pendingCites} pending)`}
            </p>
          ) : (
            <p className="text-xs text-zinc-500">
              Verify all citations are still good law (~1 credit per new citation)
            </p>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => run.mutate({ motionId })}
          disabled={run.isPending}
        >
          {run.isPending ? (
            <Loader2 className="mr-1.5 size-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 size-3" />
          )}
          {result ? "Run again" : "Cite-check"}
        </Button>
      </div>

      {stale && (
        <div className="rounded-md border border-amber-900/40 bg-amber-950/20 p-2 text-xs text-amber-200">
          Motion edited since last check. Re-run for fresh treatment.
        </div>
      )}

      {result && (showResults || result.totalCites > 0) && (
        <div className="space-y-1">
          {result.citations.map((c, i) => {
            const meta = STATUS_META[c.status as Status];
            const Icon = meta.icon;
            return (
              <div
                key={`${c.citeKey}-${i}`}
                className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-950 p-2 text-sm"
                title={c.summary ?? meta.label}
              >
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${meta.color} ${
                    c.status === "pending" ? "animate-spin" : ""
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-zinc-200">{c.raw}</p>
                  {c.summary && (
                    <p className="truncate text-xs text-zinc-500">{c.summary}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-zinc-500">{meta.label}</span>
              </div>
            );
          })}
          {result.totalCites === 0 && (
            <p className="text-sm text-zinc-500">No citations found in this motion.</p>
          )}
        </div>
      )}
    </div>
  );
}
