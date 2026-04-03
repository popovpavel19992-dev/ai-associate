"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ReportView } from "@/components/reports/report-view";

export default function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const utils = trpc.useUtils();

  const { data: caseData, isLoading } = trpc.cases.getById.useQuery(
    { caseId: id },
    { refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "processing" ? 5000 : false;
    }},
  );

  const reanalyze = trpc.cases.analyze.useMutation({
    onSuccess: () => {
      utils.cases.getById.invalidate({ caseId: id });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!caseData) {
    notFound();
  }

  const caseType =
    caseData.overrideCaseType ?? caseData.detectedCaseType ?? "general";

  return (
    <div className="h-[calc(100vh-4rem)]">
      <ReportView
        caseId={caseData.id}
        caseName={caseData.name}
        caseType={caseType}
        status={caseData.status}
        caseBrief={caseData.caseBrief}
        documents={caseData.documents}
        analyses={caseData.analyses}
        selectedSections={caseData.selectedSections}
        onReanalyze={
          caseData.sectionsLocked
            ? () => reanalyze.mutate({ caseId: id })
            : undefined
        }
        isReanalyzing={reanalyze.isPending}
      />
    </div>
  );
}
