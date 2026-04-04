"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import { Loader2, ArrowLeft, AlertCircle, Play } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useRealtimeContract } from "@/hooks/use-realtime-contract";
import { ContractViewer } from "@/components/contracts/contract-viewer";
import { ContractAnalysis } from "@/components/contracts/contract-analysis";
import { CompareSelector } from "@/components/contracts/compare-selector";
import Link from "next/link";

export default function ContractReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.contracts.getById.useQuery(
    { contractId: id },
  );

  const { status } = useRealtimeContract(id, data?.status ?? "draft");

  const analyze = trpc.contracts.analyze.useMutation({
    onSuccess: () => {
      utils.contracts.getById.invalidate({ contractId: id });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    if (error?.data?.code === "NOT_FOUND") {
      notFound();
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">
          {error?.message ?? "Failed to load contract."}
        </p>
        <Button variant="outline" onClick={() => utils.contracts.getById.invalidate({ contractId: id })}>
          Retry
        </Button>
      </div>
    );
  }

  const isProcessing = status === "extracting" || status === "analyzing" || status === "uploading";
  const isFailed = status === "failed";
  const isDraft = status === "draft";
  const isReady = status === "ready";

  if (isProcessing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm font-medium capitalize">{status}...</p>
        <p className="text-xs text-muted-foreground">
          This may take a few moments. The page will update automatically.
        </p>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Analysis failed. Please try again.</p>
        <Button
          onClick={() => analyze.mutate({ contractId: id })}
          disabled={analyze.isPending}
        >
          {analyze.isPending && <Loader2 className="size-4 animate-spin" data-icon="inline-start" />}
          Retry Analysis
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/contracts">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" data-icon="inline-start" />
              Back
            </Button>
          </Link>
          <h1 className="text-sm font-semibold">{data.name}</h1>
          {data.linkedCaseName && (
            <span className="text-xs text-muted-foreground">
              Linked to: {data.linkedCaseName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDraft && (
            <Button
              size="sm"
              onClick={() => analyze.mutate({ contractId: id })}
              disabled={analyze.isPending}
            >
              {analyze.isPending ? (
                <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
              ) : (
                <Play className="size-4" data-icon="inline-start" />
              )}
              Analyze
            </Button>
          )}
          {isReady && (
            <CompareSelector
              contractId={id}
              onComparisonCreated={(comparisonId) =>
                router.push(`/contracts/${id}/compare?comparisonId=${comparisonId}`)
              }
            />
          )}
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Contract Viewer */}
        <div className="w-[35%] overflow-hidden">
          <ContractViewer
            clauses={data.clauses}
            contractName={data.name}
            filename={data.filename}
            selectedClauseId={selectedClauseId}
            onSelectClause={setSelectedClauseId}
          />
        </div>

        {/* Center panel: Analysis */}
        <div className="flex-1 overflow-hidden border-r">
          <ContractAnalysis
            contract={{
              analysisSections: data.analysisSections,
              riskScore: data.riskScore,
              clauses: data.clauses,
            }}
            selectedClauseId={selectedClauseId}
            onSelectClause={setSelectedClauseId}
          />
        </div>

        {/* Right panel: Chat placeholder */}
        <div className="flex w-[25%] items-center justify-center border-l">
          <p className="text-sm text-muted-foreground">Chat coming soon</p>
        </div>
      </div>
    </div>
  );
}
