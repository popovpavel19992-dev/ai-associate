"use client";

import { use, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComparisonView } from "@/components/contracts/comparison-view";
import { CompareSelector } from "@/components/contracts/compare-selector";

export default function ContractComparePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const comparisonId = searchParams.get("comparisonId");

  const handleComparisonCreated = useCallback(
    (newComparisonId: string) => {
      router.push(`/contracts/${id}/compare?comparisonId=${newComparisonId}`);
    },
    [router, id],
  );

  if (!comparisonId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6">
          <Link
            href={`/contracts/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to contract
          </Link>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Compare Contract</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground">
              Select a contract to compare against.
            </p>
            <CompareSelector
              contractId={id}
              onComparisonCreated={handleComparisonCreated}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ComparisonLoader
      contractId={id}
      comparisonId={comparisonId}
    />
  );
}

function ComparisonLoader({
  contractId,
  comparisonId,
}: {
  contractId: string;
  comparisonId: string;
}) {
  const { data, isLoading, error } = trpc.comparisons.getById.useQuery(
    { comparisonId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "processing" ? 5000 : false;
      },
    },
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <AlertTriangle className="size-6 text-red-500" />
            <p className="text-sm text-red-500">{error.message}</p>
            <Link href={`/contracts/${contractId}`}>
              <Button variant="outline" size="sm">Back to contract</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  if (data.status === "processing") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Comparing contracts... This may take a moment.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.status === "failed") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6">
          <Link
            href={`/contracts/${contractId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to contract
          </Link>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <AlertTriangle className="size-6 text-red-500" />
            <p className="text-sm font-medium text-red-500">Comparison Failed</p>
            <p className="text-sm text-muted-foreground">
              One or both contracts could not be processed. Please ensure both contracts
              have been successfully analyzed before comparing.
            </p>
            <Link href={`/contracts/${contractId}`}>
              <Button variant="outline" size="sm">Back to contract</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/contracts/${contractId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to contract
        </Link>
      </div>
      <h1 className="mb-6 text-lg font-medium">
        {data.contractAName ?? "Contract A"} vs {data.contractBName ?? "Contract B"}
      </h1>
      <ComparisonView
        contractAName={data.contractAName}
        contractBName={data.contractBName}
        summary={data.summary as Record<string, unknown> | null}
        clauseDiffs={data.clauseDiffs.map((d) => ({
          id: d.id,
          title: d.title,
          diffType: d.diffType,
          impact: d.impact,
          description: d.description,
          recommendation: d.recommendation,
          sortOrder: d.sortOrder,
        }))}
      />
    </div>
  );
}
